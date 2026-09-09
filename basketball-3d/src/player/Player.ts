import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { PhysicsWorld } from '@/physics/PhysicsWorld';
import { PhysicsMaterials } from '@/physics/MaterialProperties';
import { CollisionGroup, interactionGroups } from '@/physics/CollisionLayers';
import { CourtDimensions as CD } from '@/basketball/CourtDimensions';
import { clamp } from '@/utils/MathUtils';

const GRAVITY = -9.81;
const GROUNDED_STICK_VELOCITY = -0.6;
const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);

interface PlayerRig {
  root: THREE.Group;
  torsoPivot: THREE.Group;
  legs: { left: THREE.Group; right: THREE.Group };
  arms: { left: THREE.Group; right: THREE.Group };
}

const HIP_HEIGHT = 0.95;
const SHOULDER_HEIGHT = 1.55;
const LEG_LENGTH = HIP_HEIGHT;
const ARM_LENGTH = 0.5;

/**
 * Builds a low-poly procedural humanoid as a set of hinge pivots (hip and
 * shoulder joints) rather than flat static meshes, so PlayerAnimation can
 * swing limbs for a walk cycle by rotating the pivots. Placeholder
 * geometry only - see spec section 3: this is deliberately isolated so a
 * later GLTF-based PlayerModel can be swapped in without PlayerController
 * or any gameplay system changing (a real skeletal rig replaces these
 * pivots one-for-one with bones).
 */
function buildProceduralBody(jerseyColor: number): PlayerRig {
  const root = new THREE.Group();

  const skin = new THREE.MeshStandardMaterial({ color: 0xd8a878, roughness: 0.8 });
  const jersey = new THREE.MeshStandardMaterial({ color: jerseyColor, roughness: 0.75 });
  const shorts = new THREE.MeshStandardMaterial({ color: 0x14161f, roughness: 0.8 });
  const shoes = new THREE.MeshStandardMaterial({ color: 0xf4f0e6, roughness: 0.6 });

  const makeLimb = (
    side: -1 | 1,
    jointHeight: number,
    length: number,
    radius: number,
    material: THREE.Material,
    foot: boolean,
  ): THREE.Group => {
    const pivot = new THREE.Group();
    pivot.position.set(side * (foot ? 0.12 : 0.28), jointHeight, 0);

    const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(radius, length - radius * 2, 4, 8), material);
    mesh.position.y = -length / 2;
    mesh.castShadow = true;
    pivot.add(mesh);

    if (foot) {
      const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.09, 0.24), shoes);
      shoe.position.set(0, -length - 0.02, 0.03);
      shoe.castShadow = true;
      pivot.add(shoe);
    }

    return pivot;
  };

  const legs = {
    left: makeLimb(-1, HIP_HEIGHT, LEG_LENGTH, 0.1, shorts, true),
    right: makeLimb(1, HIP_HEIGHT, LEG_LENGTH, 0.1, shorts, true),
  };
  const arms = {
    left: makeLimb(-1, SHOULDER_HEIGHT - 0.05, ARM_LENGTH, 0.055, skin, false),
    right: makeLimb(1, SHOULDER_HEIGHT - 0.05, ARM_LENGTH, 0.055, skin, false),
  };
  root.add(legs.left, legs.right, arms.left, arms.right);

  const torsoPivot = new THREE.Group();
  torsoPivot.position.set(0, (HIP_HEIGHT + SHOULDER_HEIGHT) / 2, 0);
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.21, SHOULDER_HEIGHT - HIP_HEIGHT - 0.15, 4, 8), jersey);
  torso.castShadow = true;
  torsoPivot.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), skin);
  head.position.set(0, SHOULDER_HEIGHT + 0.2 - torsoPivot.position.y, 0);
  head.castShadow = true;
  torsoPivot.add(head);

  root.add(torsoPivot);

  return { root, torsoPivot, legs, arms };
}

/** Tunables for the procedural walk-cycle animation. */
const WALK_STRIDE_LENGTH = 1.6; // meters of travel per full gait cycle
const WALK_LEG_AMPLITUDE = 0.55; // radians
const WALK_ARM_AMPLITUDE_RATIO = 0.8;
const WALK_BOB_AMPLITUDE = 0.025; // meters
const WALK_RAMP_SPEED = 0.3; // m/s at which swing amplitude reaches full strength
const IDLE_SWAY_SPEED = 0.7; // rad/s

export class Player {
  readonly visualRoot: THREE.Group;
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  private readonly rig: PlayerRig;
  private readonly characterController: RAPIER.KinematicCharacterController;
  private verticalVelocity = 0;
  private walkPhase = 0;
  private idleTime = 0;
  isGrounded = true;

  constructor(
    scene: THREE.Scene,
    physics: PhysicsWorld,
    spawn: THREE.Vector3,
    jerseyColor = 0x1d4fa8,
  ) {
    this.rig = buildProceduralBody(jerseyColor);
    this.visualRoot = this.rig.root;
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

    // Defensive clamp: Rapier's character controller has occasionally
    // returned a wildly oversized correction (multi-meter teleports) under
    // this project's headless/software-rendered test environment, which
    // runs so far below 60fps that a single rAF frame can burst through
    // many queued fixed steps at once. A single physics step can never
    // legitimately move the player more than a small fraction of a meter,
    // so anything past that is treated as a bad result and dropped rather
    // than applied.
    const distSq = corrected.x * corrected.x + corrected.y * corrected.y + corrected.z * corrected.z;
    const isSane = Number.isFinite(distSq) && distSq < 1;
    const current = this.body.translation();
    this.body.setNextKinematicTranslation({
      x: current.x + (isSane ? corrected.x : 0),
      y: current.y + (isSane ? corrected.y : 0),
      z: current.z + (isSane ? corrected.z : 0),
    });
    if (!isSane) {
      this.verticalVelocity = 0;
    }

    if (this.isGrounded && this.verticalVelocity < 0) {
      this.verticalVelocity = 0;
    }
  }

  setFacing(yaw: number): void {
    this.visualRoot.rotation.y = yaw;
  }

  /**
   * Procedural walk cycle: swings the hip/shoulder pivots on a phase that
   * advances with distance traveled (not raw time), so leg turnover speed
   * naturally scales with movement speed instead of just amplitude. Call
   * once per rendered frame - this is purely visual and never touches
   * physics.
   */
  updateWalkCycle(speed: number, dt: number): void {
    const swingStrength = clamp(speed / WALK_RAMP_SPEED, 0, 1);

    if (speed > 0.01) {
      this.walkPhase += ((speed / WALK_STRIDE_LENGTH) * Math.PI * 2) * dt;
      this.idleTime = 0;
    } else {
      this.idleTime += dt;
    }

    const swing = Math.sin(this.walkPhase) * WALK_LEG_AMPLITUDE * swingStrength;
    this.rig.legs.left.rotation.x = swing;
    this.rig.legs.right.rotation.x = -swing;
    this.rig.arms.left.rotation.x = -swing * WALK_ARM_AMPLITUDE_RATIO;
    this.rig.arms.right.rotation.x = swing * WALK_ARM_AMPLITUDE_RATIO;

    const bob = Math.abs(Math.sin(this.walkPhase * 2)) * WALK_BOB_AMPLITUDE * swingStrength;
    // subtle idle breathing sway so the character doesn't look frozen when standing still
    const idleSway = (1 - swingStrength) * Math.sin(this.idleTime * IDLE_SWAY_SPEED) * 0.01;
    this.rig.torsoPivot.position.y = (SHOULDER_HEIGHT + HIP_HEIGHT) / 2 + idleSway;
    // called after syncFromPhysics each frame, so this offsets that frame's ground-truth foot height
    this.visualRoot.position.y += bob;
  }

  /**
   * Procedural shoulder IK (spec section 26): while dribbling, the ball
   * must read as being in the player's hand, not floating near it. This
   * rotates the dribbling-side arm pivot so the arm points at the ball's
   * actual physics position every frame, overriding whatever the walk
   * cycle set that arm to this frame. Call after updateWalkCycle.
   */
  pointArmAtBall(hand: 1 | -1, ballWorldPos: THREE.Vector3): void {
    const pivot = hand === 1 ? this.rig.arms.right : this.rig.arms.left;
    const yaw = this.facingYaw;

    const localPivotPos = pivot.position.clone().applyAxisAngle(UP, yaw);
    const worldShoulder = this.visualRoot.position.clone().add(localPivotPos);

    const dirWorld = ballWorldPos.clone().sub(worldShoulder);
    if (dirWorld.lengthSq() < 1e-6) return;
    dirWorld.normalize();

    const dirLocal = dirWorld.applyAxisAngle(UP, -yaw);
    pivot.quaternion.setFromUnitVectors(DOWN, dirLocal);
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

  /** Court-surface height directly under the player's capsule. */
  get groundY(): number {
    const { capsuleHeight, capsuleRadius } = CD.player;
    return this.position.y - capsuleHeight / 2 - capsuleRadius;
  }

  get facingYaw(): number {
    return this.visualRoot.rotation.y;
  }

  get facingDirection(): THREE.Vector3 {
    return new THREE.Vector3(Math.sin(this.facingYaw), 0, Math.cos(this.facingYaw));
  }

  /**
   * World-space point near the player's hand, for ball attachment.
   * `heightAboveGround` picks the anchor: dribbling sits around the
   * waist, a shot's gather/set-point sits around the chest.
   */
  getHandPosition(out: THREE.Vector3, side: 1 | -1, heightAboveGround: number): THREE.Vector3 {
    const p = this.position;
    const yaw = this.facingYaw;
    const localOffset = new THREE.Vector3(side * 0.32, 0, 0.22);
    localOffset.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    return out.set(p.x + localOffset.x, this.groundY + heightAboveGround, p.z + localOffset.z);
  }
}
