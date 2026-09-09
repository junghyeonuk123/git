import * as THREE from 'three';
import type { PhysicsWorld } from '@/physics/PhysicsWorld';
import { PhysicsMaterials } from '@/physics/MaterialProperties';
import { CollisionGroup, interactionGroups } from '@/physics/CollisionLayers';
import { CourtDimensions as CD } from './CourtDimensions';

const FLOOR_THICKNESS = 0.2;
/** Texels per meter for the painted-line canvas texture. */
const TEXTURE_DENSITY = 64;

function woodColor(lightnessJitter: number): string {
  return `hsl(29, 47%, ${(46 + lightnessJitter).toFixed(1)}%)`;
}

/**
 * Paints strip hardwood the way a real NBA floor is actually laid - long
 * boards running the length of the court, each strip a slightly different
 * shade with wavy grain and sparse randomized end-seams - instead of one
 * flat fill color. This runs once at load (into a canvas the size of the
 * whole court), never per frame, so the per-band randomness and per-seam
 * stroke() calls cost nothing at runtime.
 */
function drawHardwood(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const base = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.65);
  base.addColorStop(0, 'hsl(30, 49%, 50%)');
  base.addColorStop(1, 'hsl(28, 44%, 38%)');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, w, h);

  const bandPx = 0.55 * TEXTURE_DENSITY;
  const bandCount = Math.ceil(h / bandPx);

  for (let i = 0; i < bandCount; i++) {
    const y = i * bandPx;
    const bandH = Math.min(bandPx, h - y);

    ctx.fillStyle = woodColor((Math.random() - 0.5) * 10);
    ctx.fillRect(0, y, w, bandH);

    // wavy grain streaks, a couple per board strip
    ctx.globalAlpha = 0.05;
    ctx.lineWidth = 1;
    for (let g = 0; g < 3; g++) {
      const gy = y + Math.random() * bandH;
      ctx.strokeStyle = Math.random() > 0.5 ? '#2c1a0c' : '#f2dfc0';
      ctx.beginPath();
      ctx.moveTo(0, gy);
      const segments = 10;
      for (let s = 1; s <= segments; s++) {
        ctx.lineTo((w / segments) * s, gy + (Math.random() - 0.5) * bandH * 0.3);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // individual board end-seams at randomized spacing
    const seamPx = (2.2 + Math.random() * 0.8) * TEXTURE_DENSITY;
    ctx.strokeStyle = 'rgba(30, 18, 8, 0.35)';
    ctx.lineWidth = 1.5;
    for (let x = Math.random() * seamPx; x < w; x += seamPx) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + bandH);
      ctx.stroke();
    }

    // faint seam between adjacent strips
    ctx.strokeStyle = 'rgba(20, 12, 5, 0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
}

/**
 * Procedurally draws the court's hardwood + painted lines onto a canvas
 * texture. Keeps line rendering crisp without hundreds of THREE.Line
 * segments.
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

  drawHardwood(ctx, w, h);

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
  texture.anisotropy = 8;
  return texture;
}

export class Court {
  readonly mesh: THREE.Mesh;

  constructor(scene: THREE.Scene, physics: PhysicsWorld) {
    const texture = buildCourtTexture();
    const geometry = new THREE.PlaneGeometry(CD.length + CD.apron * 2, CD.width + CD.apron * 2);
    // MeshPhysicalMaterial's clearcoat gives the thin glossy lacquer layer
    // a real polished hardwood floor has - a soft, direct-light specular
    // sheen rather than a flat matte fill - without needing an environment
    // map (spec section 21: cheapest method that still reads as reflective,
    // not a flat game-prototype floor).
    const material = new THREE.MeshPhysicalMaterial({
      map: texture,
      roughness: 0.55,
      metalness: 0.0,
      clearcoat: 0.35,
      clearcoatRoughness: 0.25,
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
