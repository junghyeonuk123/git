import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from '@/physics/PhysicsWorld';
import { PhysicsMaterials } from '@/physics/MaterialProperties';
import { CollisionGroup, interactionGroups } from '@/physics/CollisionLayers';
import { CourtDimensions as CD } from '@/basketball/CourtDimensions';

const GRAVITY = -9.81;
const GROUNDED_STICK_VELOCITY = -0.6;

/**
 * Builds a low-poly procedural humanoid. Placeholder geometry only - see
 * spec section 3: this is deliberately isolated behind `visualRoot` so a
 * later GLTF-based PlayerModel can be swapped in without PlayerController
 * or any gameplay system changing.
 */
function buildProceduralBody(jerseyColor: number): THREE.Group {
  const root = new THREE.Group();

  const skin = new THREE.MeshStandardMaterial({ color: 0xd8a878, roughness: 0.8 });
  const jersey = new THREE.MeshStandardMaterial({ color: jerseyColor, roughness: 0.75 });
  const shorts = new THREE.MeshStandardMaterial({ color: 0x14161f, roughness: 0.8 });
  const shoes = new THREE.MeshStandardMaterial({ color: 0xf4f0e6, roughness: 0.6 });

  const hipHeight = 0.95;
  const shoulderHeight = 1.55;

  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, hipHeight - 0.12, 4, 8), shorts);
    leg.position.set(side * 0.12, hipHeight / 2, 0);
    leg.castShadow = true;
    root.add(leg);

    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.09, 0.24), shoes);
    shoe.position.set(side * 0.12, 0.045, 0.03);
    shoe.castShadow = true;
    root.add(shoe);

    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.42, 4, 8), skin);
    arm.position.set(side * 0.28, shoulderHeight - 0.32, 0);
    arm.castShadow = true;
    root.add(arm);
  }

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.21, shoulderHeight - hipHeight - 0.15, 4, 8), jersey);
  torso.position.set(0, (hipHeight + shoulderHeight) / 2, 0);
  torso.castShadow = true;
  root.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), skin);
  head.position.set(0, shoulderHeight + 0.2, 0);
  head.castShadow = true;
  root.add(head);

  return root;
}

export class Player {
  readonly visualRoot: THREE.Group;
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  private readonly characterController: RAPIER.KinematicCharacterController;
  private verticalVelocity = 0;
  isGrounded = true;

  constructor(
    scene: THREE.Scene,
    physics: PhysicsWorld,
    spawn: THREE.Vector3,
    jerseyColor = 0x1d4fa8,
  ) {
    this.visualRoot = buildProceduralBody(jerseyColor);
    scene.add(this.visualRoot);

    const { capsuleRadius, capsuleHeight } = CD.player;
    const halfHeight = capsuleHeight / 2;
    // capsule center sits at half the total height off the ground
    const bodyDesc = physics.RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
      spawn.x,
      halfHeight + capsuleRadius,
      spawn.z,
    );
    this.body = physics.world.createRigidBody(bodyDesc);

    const colliderDesc = physics.RAPIER.ColliderDesc.capsule(halfHeight, capsuleRadius)
      .setRestitution(PhysicsMaterials.player.restitution)
      .setFriction(PhysicsMaterials.player.friction)
      .setCollisionGroups(interactionGroups(CollisionGroup.Player, CollisionGroup.Court));
    this.collider = physics.world.createCollider(colliderDesc, this.body);

    this.characterController = physics.world.createCharacterController(0.02);
    this.characterController.setUp({ x: 0, y: 1, z: 0 });
    this.characterController.setMaxSlopeClimbAngle((45 * Math.PI) / 180);
    this.characterController.setMinSlopeSlideAngle((35 * Math.PI) / 180);
    this.characterController.enableAutostep(0.25, 0.15, true);
    this.characterController.enableSnapToGround(0.25);
  }

  /** Applies one fixed physics step of horizontal displacement + gravity. */
  applyMovement(horizontalDisplacement: THREE.Vector2, dt: number): void {
    if (this.isGrounded && this.verticalVelocity < 0) {
      this.verticalVelocity = GROUNDED_STICK_VELOCITY;
    }
    this.verticalVelocity += GRAVITY * dt;

    const desired = { x: horizontalDisplacement.x, y: this.verticalVelocity * dt, z: horizontalDisplacement.y };
    this.characterController.computeColliderMovement(this.collider, desired);
    const corrected = this.characterController.computedMovement();
    this.isGrounded = this.characterController.computedGrounded();

    const current = this.body.translation();
    this.body.setNextKinematicTranslation({
      x: current.x + corrected.x,
      y: current.y + corrected.y,
      z: current.z + corrected.z,
    });

    if (this.isGrounded && this.verticalVelocity < 0) {
      this.verticalVelocity = 0;
    }
  }

  setFacing(yaw: number): void {
    this.visualRoot.rotation.y = yaw;
  }

  /** Copy the physics transform onto the render group. Call after each physics step. */
  syncFromPhysics(): void {
    const t = this.body.translation();
    const { capsuleHeight, capsuleRadius } = CD.player;
    // visual root origin is at the feet; body translation is the capsule center
    this.visualRoot.position.set(t.x, t.y - capsuleHeight / 2 - capsuleRadius, t.z);
  }

  get position(): THREE.Vector3 {
    const t = this.body.translation();
    return new THREE.Vector3(t.x, t.y, t.z);
  }

  /** World-space point roughly at the shooting/dribbling hand, for ball attachment. */
  getHandPosition(out: THREE.Vector3, side: 1 | -1 = 1): THREE.Vector3 {
    const p = this.position;
    const yaw = this.visualRoot.rotation.y;
    const localOffset = new THREE.Vector3(side * 0.32, -0.35, 0.22);
    localOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    return out.set(p.x + localOffset.x, p.y + localOffset.y, p.z + localOffset.z);
  }
}
