import * as THREE from 'three';
import type { PhysicsWorld } from '@/physics/PhysicsWorld';
import { PhysicsMaterials } from '@/physics/MaterialProperties';
import { CollisionGroup, interactionGroups } from '@/physics/CollisionLayers';
import { CourtDimensions as CD } from './CourtDimensions';

const FLOOR_THICKNESS = 0.2;
/** Texels per meter for the painted-line canvas texture. */
const TEXTURE_DENSITY = 64;

/**
 * Procedurally draws the court's painted lines onto a canvas texture.
 * Keeps line rendering crisp without hundreds of THREE.Line segments, and
 * gives Phase B (visual upgrade) a single place to swap in a wood-grain
 * base layer underneath the same line pass.
 */
function buildCourtTexture(): THREE.CanvasTexture {
  const w = Math.round((CD.length + CD.apron * 2) * TEXTURE_DENSITY);
  const h = Math.round((CD.width + CD.apron * 2) * TEXTURE_DENSITY);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  // world (meters, origin at court center) -> texture pixels
  const toPx = (x: number, z: number): [number, number] => [
    (x + CD.length / 2 + CD.apron) * TEXTURE_DENSITY,
    (z + CD.width / 2 + CD.apron) * TEXTURE_DENSITY,
  ];

  // wood base with subtle plank striping
  ctx.fillStyle = '#b5793f';
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 0.06;
  ctx.strokeStyle = '#3a2410';
  ctx.lineWidth = 2;
  const plankWidth = 0.18 * TEXTURE_DENSITY;
  for (let x = 0; x < w; x += plankWidth) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const lineWidth = Math.max(2, 0.05 * TEXTURE_DENSITY);
  ctx.strokeStyle = '#f4f0e6';
  ctx.lineWidth = lineWidth;

  const strokeRect = (x0: number, z0: number, x1: number, z1: number) => {
    const [px0, pz0] = toPx(x0, z0);
    const [px1, pz1] = toPx(x1, z1);
    ctx.strokeRect(Math.min(px0, px1), Math.min(pz0, pz1), Math.abs(px1 - px0), Math.abs(pz1 - pz0));
  };
  const strokeCircle = (x: number, z: number, r: number, start = 0, end = Math.PI * 2) => {
    const [px, pz] = toPx(x, z);
    ctx.beginPath();
    ctx.arc(px, pz, r * TEXTURE_DENSITY, start, end);
    ctx.stroke();
  };
  const strokeLine = (x0: number, z0: number, x1: number, z1: number) => {
    const [px0, pz0] = toPx(x0, z0);
    const [px1, pz1] = toPx(x1, z1);
    ctx.beginPath();
    ctx.moveTo(px0, pz0);
    ctx.lineTo(px1, pz1);
    ctx.stroke();
  };

  // boundary
  strokeRect(-CD.length / 2, -CD.width / 2, CD.length / 2, CD.width / 2);
  // halfcourt line + center circle
  strokeLine(0, -CD.width / 2, 0, CD.width / 2);
  strokeCircle(0, 0, CD.centerCircleRadius);

  // both ends: paint, free-throw circle, three-point line
  for (const side of [-1, 1] as const) {
    const baselineX = side * (CD.length / 2);
    const rimX = baselineX - side * CD.hoop.backboardDistanceFromBaseline;
    const ftLineX = baselineX - side * CD.freeThrowLineDistance;

    strokeRect(baselineX, -CD.paint.width / 2, baselineX - side * CD.paint.length, CD.paint.width / 2);
    strokeCircle(ftLineX, 0, CD.paint.width / 2, 0, Math.PI * 2);

    // three point arc, clipped to stay in front of the baseline
    const [cx, cz] = toPx(rimX, 0);
    const r = CD.threePoint.arcDistance * TEXTURE_DENSITY;
    ctx.beginPath();
    if (side === 1) {
      ctx.arc(cx, cz, r, Math.PI * 0.5, Math.PI * 1.5);
    } else {
      ctx.arc(cx, cz, r, -Math.PI * 0.5, Math.PI * 0.5);
    }
    ctx.stroke();
    const cornerZ = CD.threePoint.cornerDistance;
    strokeLine(baselineX, cornerZ * -1, baselineX - side * CD.threePoint.cornerLineLength, cornerZ * -1);
    strokeLine(baselineX, cornerZ, baselineX - side * CD.threePoint.cornerLineLength, cornerZ);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export class Court {
  readonly mesh: THREE.Mesh;

  constructor(scene: THREE.Scene, physics: PhysicsWorld) {
    const texture = buildCourtTexture();
    const geometry = new THREE.PlaneGeometry(CD.length + CD.apron * 2, CD.width + CD.apron * 2);
    const material = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.65,
      metalness: 0.0,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);

    const bodyDesc = physics.RAPIER.RigidBodyDesc.fixed().setTranslation(0, -FLOOR_THICKNESS / 2, 0);
    const body = physics.world.createRigidBody(bodyDesc);
    const colliderDesc = physics.RAPIER.ColliderDesc.cuboid(
      (CD.length + CD.apron * 2) / 2,
      FLOOR_THICKNESS / 2,
      (CD.width + CD.apron * 2) / 2,
    )
      .setRestitution(PhysicsMaterials.court.restitution)
      .setFriction(PhysicsMaterials.court.friction)
      .setCollisionGroups(interactionGroups(CollisionGroup.Court, CollisionGroup.Ball | CollisionGroup.Player));
    physics.world.createCollider(colliderDesc, body);
  }
}
