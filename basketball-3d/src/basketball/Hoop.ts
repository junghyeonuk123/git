import * as THREE from 'three';
import type { PhysicsWorld } from '@/physics/PhysicsWorld';
import { PhysicsMaterials } from '@/physics/MaterialProperties';
import { CollisionGroup, interactionGroups } from '@/physics/CollisionLayers';
import { CourtDimensions as CD } from './CourtDimensions';
import { Backboard } from './Backboard';
import { Net } from './Net';

/**
 * One basket assembly: rim + support structure, plus the composed
 * Backboard and Net for that end of the court.
 *
 * The rim is the physically interesting part (spec section 6): it is
 * NOT a simplified cylinder-cap collider, it's a real trimesh built from
 * the same torus geometry that gets rendered, baked so its axis is
 * vertical. A shot can therefore catch the front iron, the inside of
 * the ring, or the back iron and deflect differently depending on
 * exactly where it lands - the engine decides that, not scripted logic.
 */
export class Hoop {
  readonly rimCenter: THREE.Vector3;
  /** Point on the backboard face above the rim - the classic bank-shot aim point. */
  readonly bankSpot: THREE.Vector3;
  readonly backboard: Backboard;
  readonly net: Net;

  constructor(scene: THREE.Scene, physics: PhysicsWorld, side: 1 | -1) {
    const { rimRadius, rimTubeRadius, rimHeight, rimDistanceFromBackboard, backboardDistanceFromBaseline, poleSetback } =
      CD.hoop;

    const backboardX = side * (CD.length / 2 - backboardDistanceFromBaseline);
    const rimX = backboardX - side * rimDistanceFromBackboard;
    this.rimCenter = new THREE.Vector3(rimX, rimHeight, 0);
    this.bankSpot = new THREE.Vector3(backboardX, rimHeight + 0.18, 0);

    // --- rim: torus baked with a vertical axis so mesh & trimesh collider match exactly
    const torusGeometry = new THREE.TorusGeometry(rimRadius, rimTubeRadius, 12, 48);
    torusGeometry.rotateX(Math.PI / 2);

    const rimMaterial = new THREE.MeshStandardMaterial({ color: 0xe8621a, roughness: 0.35, metalness: 0.7 });
    const rimMesh = new THREE.Mesh(torusGeometry, rimMaterial);
    rimMesh.position.copy(this.rimCenter);
    rimMesh.castShadow = true;
    rimMesh.receiveShadow = true;
    scene.add(rimMesh);

    const positionAttr = torusGeometry.getAttribute('position');
    const vertices = new Float32Array(positionAttr.array);
    const indexAttr = torusGeometry.getIndex();
    const indices = indexAttr ? Uint32Array.from(indexAttr.array) : new Uint32Array();

    const rimBodyDesc = physics.RAPIER.RigidBodyDesc.fixed().setTranslation(
      this.rimCenter.x,
      this.rimCenter.y,
      this.rimCenter.z,
    );
    const rimBody = physics.world.createRigidBody(rimBodyDesc);
    const rimColliderDesc = physics.RAPIER.ColliderDesc.trimesh(vertices, indices)
      .setRestitution(PhysicsMaterials.rim.restitution)
      .setFriction(PhysicsMaterials.rim.friction)
      .setCollisionGroups(interactionGroups(CollisionGroup.Rim, CollisionGroup.Ball));
    physics.world.createCollider(rimColliderDesc, rimBody);

    // --- support structure (cosmetic only for now)
    const poleMaterial = new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.5, metalness: 0.6 });
    const poleX = backboardX + side * poleSetback; // further from center court than the backboard, i.e. behind it
    const poleHeight = rimHeight + 0.9;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, poleHeight, 12), poleMaterial);
    pole.position.set(poleX, poleHeight / 2, 0);
    pole.castShadow = true;
    scene.add(pole);

    const armLength = Math.abs(poleX - backboardX);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(armLength, 0.12, 0.12), poleMaterial);
    arm.position.set((poleX + backboardX) / 2, poleHeight - 0.1, 0);
    arm.castShadow = true;
    scene.add(arm);

    this.backboard = new Backboard(scene, physics, side);
    this.net = new Net(scene, this.rimCenter);
  }
}
