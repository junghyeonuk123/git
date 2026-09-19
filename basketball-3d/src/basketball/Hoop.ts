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
  /** For shot-clock rule 7-Section IV-3-1: detecting whether a missed shot actually touched the rim. */
  readonly rimCollider: import('@dimforge/rapier3d-compat').Collider;
  /** For rule 8-Section II-1: touching the basket's support structure is a dead-ball out-of-bounds, not a legal bounce. The column and the cantilever arm both count. */
  readonly supportColliders: readonly import('@dimforge/rapier3d-compat').Collider[];

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
    this.rimCollider = physics.world.createCollider(rimColliderDesc, rimBody);

    // --- support structure
    const poleMaterial = new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.5, metalness: 0.6 });
    // Behind the backboard, and far enough behind it to clear the
    // baseline entirely - see CourtDimensions' poleSetback.
    const poleX = backboardX + side * poleSetback;
    const poleHeight = rimHeight + 0.9;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, poleHeight, 12), poleMaterial);
    pole.position.set(poleX, poleHeight / 2, 0);
    pole.castShadow = true;
    scene.add(pole);

    // Touching the support structure is a dead ball (Rule 8-Section
    // II-1), so the column is a real collider, not just scenery. It used
    // to double as a physical wall sealing off the illegal space behind
    // the backboard - it could, because it stood only 1ft 8in behind the
    // board. It cannot do that from 8ft back, and it should not: a ball
    // that gets behind the board simply lands in the apron and is called
    // out of bounds there, which is what the rule actually says happens.
    const poleBodyDesc = physics.RAPIER.RigidBodyDesc.fixed().setTranslation(poleX, poleHeight / 2, 0);
    const poleBody = physics.world.createRigidBody(poleBodyDesc);
    const poleColliderDesc = physics.RAPIER.ColliderDesc.cylinder(poleHeight / 2, 0.12)
      .setRestitution(PhysicsMaterials.structure.restitution)
      .setFriction(PhysicsMaterials.structure.friction)
      .setCollisionGroups(interactionGroups(CollisionGroup.Backboard, CollisionGroup.Ball));
    const poleCollider = physics.world.createCollider(poleColliderDesc, poleBody);

    // safety padding wrap around the base, like a real arena stanchion pad
    const padMaterial = new THREE.MeshStandardMaterial({ color: 0x8f1c1c, roughness: 0.85 });
    const padHeight = 2.1;
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, padHeight, 16), padMaterial);
    pad.position.set(poleX, padHeight / 2, 0);
    pad.castShadow = true;
    scene.add(pad);

    // The cantilever arm carrying the board out over the court. At 8ft
    // it is now a real structural span rather than a stub, so it gets a
    // collider of its own - it is as much "the basket support" as the
    // column is, and a ball dropping in behind the board can reach it.
    const armLength = Math.abs(poleX - backboardX);
    const armX = (poleX + backboardX) / 2;
    const armY = poleHeight - 0.1;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(armLength, 0.14, 0.16), poleMaterial);
    arm.position.set(armX, armY, 0);
    arm.castShadow = true;
    scene.add(arm);

    const armBodyDesc = physics.RAPIER.RigidBodyDesc.fixed().setTranslation(armX, armY, 0);
    const armBody = physics.world.createRigidBody(armBodyDesc);
    const armColliderDesc = physics.RAPIER.ColliderDesc.cuboid(armLength / 2, 0.07, 0.08)
      .setRestitution(PhysicsMaterials.structure.restitution)
      .setFriction(PhysicsMaterials.structure.friction)
      .setCollisionGroups(interactionGroups(CollisionGroup.Backboard, CollisionGroup.Ball));
    const armCollider = physics.world.createCollider(armColliderDesc, armBody);
    this.supportColliders = [poleCollider, armCollider];

    // Diagonal brace from the column up to the underside of the arm.
    // Purely visual, and it sits inside the span the arm collider
    // already covers - an 8ft cantilever with nothing bracing it reads
    // as a beam floating in the air.
    const braceFromX = poleX - side * 0.1;
    const braceToX = backboardX + side * (armLength * 0.45);
    const braceFromY = poleHeight * 0.45;
    const braceLength = Math.hypot(braceToX - braceFromX, armY - braceFromY);
    const brace = new THREE.Mesh(new THREE.BoxGeometry(braceLength, 0.1, 0.1), poleMaterial);
    brace.position.set((braceFromX + braceToX) / 2, (braceFromY + armY) / 2, 0);
    brace.rotation.z = Math.atan2(armY - braceFromY, braceToX - braceFromX);
    brace.castShadow = true;
    scene.add(brace);

    // rim-to-backboard support bracket, so the rim doesn't visually float
    // in front of the board with nothing physically connecting them
    const bracketLength = rimDistanceFromBackboard;
    const bracket = new THREE.Mesh(new THREE.BoxGeometry(bracketLength, 0.05, 0.14), poleMaterial);
    bracket.position.set((backboardX + rimX) / 2, rimHeight + 0.03, 0);
    bracket.castShadow = true;
    scene.add(bracket);

    this.backboard = new Backboard(scene, physics, side);
    this.net = new Net(scene, this.rimCenter);
  }
}
