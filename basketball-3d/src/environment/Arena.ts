import * as THREE from 'three';
import { CourtDimensions as CD } from '@/basketball/CourtDimensions';

const FT = 0.3048;

/** Half-extent of the playable floor including its apron, in each axis. */
const FLOOR_HALF_X = CD.length / 2 + CD.apron;
const FLOOR_HALF_Z = CD.width / 2 + CD.apron;

const WALKWAY = 2.5; // concourse gap between the floor's edge and the first row
const ROW_COUNT = 7;
const ROW_DEPTH = 1.05;
const ROW_HEIGHT = 0.5;
const ARENA_HALF_X = FLOOR_HALF_X + 6;
const ARENA_HALF_Z = FLOOR_HALF_Z + 6;
const WALL_HEIGHT = 6;

function buildSeatRowTexture(): THREE.CanvasTexture {
  const w = 256;
  const h = 64;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#1c2636';
  ctx.fillRect(0, 0, w, h);
  const seatColors = ['#2a3a52', '#324769', '#2a3a52', '#1e2c40'];
  const seatWidth = 14;
  let i = 0;
  for (let x = 0; x < w; x += seatWidth) {
    ctx.fillStyle = seatColors[i % seatColors.length]!;
    ctx.fillRect(x + 1, h * 0.25, seatWidth - 2, h * 0.65);
    i++;
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

/**
 * A stylized arena shell around the court (spec section 17): stepped
 * bleacher risers on three sides, enclosing back walls, a hanging
 * scoreboard + lighting truss, and courtside benches/scorer's table. All
 * of it is cosmetic-only geometry (no physics colliders) - nothing here
 * is ever meant to be collided with, per spec section 17's "doesn't need
 * to be photorealistic, needs to create the PERCEPTION of a venue."
 *
 * Deliberately open on the near side (negative Z, where the fixed
 * broadcast camera sits - see CameraController): a stand built there
 * would sit inside the camera's own pan/zoom range and risk clipping
 * through it. Real broadcast framing rarely shows the stand right next
 * to the camera anyway, so a three-sided bowl reads correctly.
 */
export class Arena {
  constructor(scene: THREE.Scene) {
    const seatTexture = buildSeatRowTexture();
    const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x141a24, roughness: 0.9 });
    const trussMaterial = new THREE.MeshStandardMaterial({ color: 0x20242c, roughness: 0.5, metalness: 0.6 });
    const benchMaterial = new THREE.MeshStandardMaterial({ color: 0x23293a, roughness: 0.7 });

    this.buildStand(scene, seatTexture, wallMaterial, 'far');
    this.buildStand(scene, seatTexture, wallMaterial, 'baselinePos');
    this.buildStand(scene, seatTexture, wallMaterial, 'baselineNeg');
    this.buildTunnel(scene, wallMaterial);
    this.buildScoreboardAndTruss(scene, trussMaterial);
    this.buildCourtsideFurniture(scene, benchMaterial);
  }

  /** One tiered stand: `far` runs along +Z, the two baseline stands run along +/-X. */
  private buildStand(
    scene: THREE.Scene,
    seatTexture: THREE.CanvasTexture,
    wallMaterial: THREE.Material,
    which: 'far' | 'baselinePos' | 'baselineNeg',
  ): void {
    const group = new THREE.Group();

    const along = which === 'far' ? ARENA_HALF_X * 2 : ARENA_HALF_Z * 2;
    const innerEdge = which === 'far' ? FLOOR_HALF_Z + WALKWAY : FLOOR_HALF_X + WALKWAY;
    const sign = which === 'baselineNeg' ? -1 : 1;

    // Every stand needs a different repeat count for the same seat-row
    // texture (they're different lengths), and Texture.repeat is a
    // property of the texture itself, not the material - sharing one
    // Texture instance across stands would make each stand's repeat
    // setting clobber the others'. Clone once per stand instead.
    const stripTexture = seatTexture.clone();
    stripTexture.needsUpdate = true;
    stripTexture.repeat.set(along / 3, 1);

    for (let r = 0; r < ROW_COUNT; r++) {
      const rowMat = new THREE.MeshStandardMaterial({ map: stripTexture, roughness: 0.85 });
      const rowHeight = ROW_HEIGHT * (r + 1);
      const rowMesh = new THREE.Mesh(new THREE.BoxGeometry(along, rowHeight, ROW_DEPTH), rowMat);
      const offset = innerEdge + r * ROW_DEPTH + ROW_DEPTH / 2;
      if (which === 'far') {
        rowMesh.position.set(0, rowHeight / 2, offset);
      } else {
        rowMesh.position.set(sign * offset, rowHeight / 2, 0);
        rowMesh.rotation.y = Math.PI / 2;
      }
      rowMesh.receiveShadow = true;
      group.add(rowMesh);
    }

    // enclosing back wall behind the top row
    const wallSpan = along;
    const backOffset = innerEdge + ROW_COUNT * ROW_DEPTH;
    const wall = new THREE.Mesh(new THREE.BoxGeometry(wallSpan, WALL_HEIGHT, 0.3), wallMaterial);
    if (which === 'far') {
      wall.position.set(0, ROW_COUNT * ROW_HEIGHT + WALL_HEIGHT / 2, backOffset);
    } else {
      wall.position.set(sign * backOffset, ROW_COUNT * ROW_HEIGHT + WALL_HEIGHT / 2, 0);
      wall.rotation.y = Math.PI / 2;
    }
    group.add(wall);

    scene.add(group);
  }

  /** A dark tunnel opening cut into the +X baseline wall - a locker-room entrance. */
  private buildTunnel(scene: THREE.Scene, wallMaterial: THREE.Material): void {
    const tunnelWidth = 3.2;
    const tunnelHeight = 3.4;
    const x = FLOOR_HALF_X + WALKWAY + ROW_COUNT * ROW_DEPTH;

    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.4, tunnelHeight, tunnelWidth), new THREE.MeshStandardMaterial({ color: 0x05070a, roughness: 1 }));
    mouth.position.set(x - 0.05, tunnelHeight / 2, 0);
    scene.add(mouth);

    const depth = new THREE.Mesh(
      new THREE.BoxGeometry(2.5, tunnelHeight * 0.92, tunnelWidth * 0.85),
      new THREE.MeshStandardMaterial({ color: 0x08090c, roughness: 1 }),
    );
    depth.position.set(x + 1.2, (tunnelHeight * 0.92) / 2, 0);
    scene.add(depth);

    // a dim warm light glowing at the tunnel's far end
    const glow = new THREE.PointLight(0xffb066, 8, 6, 2);
    glow.position.set(x + 2.3, 1.6, 0);
    scene.add(glow);

    void wallMaterial;
  }

  private buildScoreboardAndTruss(scene: THREE.Scene, trussMaterial: THREE.Material): void {
    const trussY = 9.8;
    const beamGeo = new THREE.BoxGeometry(0.12, 0.12, FLOOR_HALF_Z * 1.7);
    const crossGeo = new THREE.BoxGeometry(FLOOR_HALF_X * 1.7, 0.12, 0.12);
    for (const x of [-FLOOR_HALF_X * 0.6, 0, FLOOR_HALF_X * 0.6]) {
      const beam = new THREE.Mesh(beamGeo, trussMaterial);
      beam.position.set(x, trussY, 0);
      scene.add(beam);
    }
    for (const z of [-FLOOR_HALF_Z * 0.6, 0, FLOOR_HALF_Z * 0.6]) {
      const beam = new THREE.Mesh(crossGeo, trussMaterial);
      beam.position.set(0, trussY, z);
      scene.add(beam);
    }

    // hanging center scoreboard - cosmetic prop, not wired to live score
    // (the DOM HUD is the actual score readout); an emissive LED-style
    // canvas panel on each of its four faces
    const boardTexture = buildScoreboardTexture();
    const boardMaterial = new THREE.MeshStandardMaterial({
      map: boardTexture,
      emissive: 0x1a1408,
      emissiveMap: boardTexture,
      emissiveIntensity: 0.6,
      roughness: 0.6,
    });
    const housingMaterial = new THREE.MeshStandardMaterial({ color: 0x15181f, roughness: 0.5, metalness: 0.5 });
    const board = new THREE.Group();
    const core = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 1.6), housingMaterial);
    board.add(core);
    for (const rot of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      const face = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.1), boardMaterial);
      face.position.set(Math.sin(rot) * 0.81, 0, Math.cos(rot) * 0.81);
      face.rotation.y = rot;
      board.add(face);
    }
    board.position.set(0, trussY - 1.4, 0);
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1.4, 6), trussMaterial);
    cable.position.set(0, trussY - 0.7, 0);
    scene.add(cable);
    scene.add(board);
  }

  private buildCourtsideFurniture(scene: THREE.Scene, benchMaterial: THREE.Material): void {
    // team benches along the open (camera-side) sideline, tucked outside the court apron
    const benchZ = -(FLOOR_HALF_Z + 0.6);
    for (const side of [-1, 1] as const) {
      const bench = new THREE.Mesh(new THREE.BoxGeometry(5 * FT, 0.9, 1.3 * FT), benchMaterial);
      bench.position.set(side * (CD.length * 0.18), 0.45, benchZ);
      bench.castShadow = true;
      scene.add(bench);
    }

    // scorer's table at center, courtside
    const table = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.75, 0.7), benchMaterial);
    table.position.set(0, 0.375, benchZ - 1.2);
    table.castShadow = true;
    scene.add(table);
  }
}

function buildScoreboardTexture(): THREE.CanvasTexture {
  const w = 256;
  const h = 192;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#05070a';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#3a4048';
  ctx.lineWidth = 4;
  ctx.strokeRect(4, 4, w - 8, h - 8);
  ctx.fillStyle = '#e8621a';
  ctx.font = 'bold 26px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('HOME', w * 0.28, 48);
  ctx.fillText('AWAY', w * 0.72, 48);
  ctx.fillStyle = '#f4f6fb';
  ctx.font = 'bold 46px monospace';
  ctx.fillText('00', w * 0.28, 100);
  ctx.fillText('00', w * 0.72, 100);
  ctx.fillStyle = '#5b6472';
  ctx.font = 'bold 18px monospace';
  ctx.fillText('Q1  12:00', w * 0.5, 150);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
