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

/** A two-segment limb: `upper` is the hip/shoulder pivot, `lower` (its child) is the knee/elbow pivot. */
interface LimbChain {
  upper: THREE.Group;
  lower: THREE.Group;
}

interface PlayerRig {
  root: THREE.Group;
  torsoPivot: THREE.Group;
  legs: { left: LimbChain; right: LimbChain };
  arms: { left: LimbChain; right: LimbChain };
}

const HIP_HEIGHT = 0.95;
const SHOULDER_HEIGHT = 1.55;
const THIGH_LENGTH = 0.52;
const SHIN_LENGTH = HIP_HEIGHT - THIGH_LENGTH;
const UPPER_ARM_LENGTH = 0.27;
const FOREARM_LENGTH = 0.23;
const ARM_LENGTH = UPPER_ARM_LENGTH + FOREARM_LENGTH;

/**
 * Builds a low-poly procedural humanoid as a chain of hinge pivots (hip/knee,
 * shoulder/elbow) rather than flat single-segment limbs, so the silhouette
 * actually reads as a basketball player - distinct thighs/shins, forearms,
 * and hands - instead of a rigid capsule stick figure. Still placeholder
 * geometry, not a skinned mesh (see spec section 3: isolated behind this
 * function so a later GLTF-based PlayerModel can replace it one-for-one
 * without PlayerController or any gameplay system changing), but every
 * joint here is a real pivot an animation can drive.
 */
function buildProceduralBody(jerseyColor: number): PlayerRig {
  const root = new THREE.Group();

  const skin = new THREE.MeshStandardMaterial({ color: 0xd8a878, roughness: 0.75 });
  const jersey = new THREE.MeshStandardMaterial({ color: jerseyColor, roughness: 0.7 });
  const jerseyTrim = new THREE.MeshStandardMaterial({ color: 0xf4f6fb, roughness: 0.55 });
  const shorts = new THREE.MeshStandardMaterial({ color: 0x14161f, roughness: 0.78 });
  const shortsTrim = new THREE.MeshStandardMaterial({ color: jerseyColor, roughness: 0.7 });
  const socks = new THREE.MeshStandardMaterial({ color: 0xf4f6fb, roughness: 0.72 });
  const shoes = new THREE.MeshStandardMaterial({ color: 0x1c1e24, roughness: 0.45, metalness: 0.08 });
  const shoeSole = new THREE.MeshStandardMaterial({ color: 0xf0ece0, roughness: 0.55 });
  const hair = new THREE.MeshStandardMaterial({ color: 0x1a130f, roughness: 0.85 });

  const makeLeg = (side: -1 | 1): LimbChain => {
    const hip = new THREE.Group();
    hip.position.set(side * 0.11, HIP_HEIGHT, 0);

    const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, THIGH_LENGTH - 0.2, 4, 8), skin);
    thigh.position.y = -THIGH_LENGTH / 2;
    thigh.castShadow = true;
    hip.add(thigh);

    const knee = new THREE.Group();
    knee.position.y = -THIGH_LENGTH;
    hip.add(knee);

    const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.075, SHIN_LENGTH - 0.15, 4, 8), socks);
    shin.position.y = -SHIN_LENGTH / 2;
    shin.castShadow = true;
    knee.add(shin);

    const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.26), shoes);
    shoe.position.set(0, -SHIN_LENGTH - 0.03, 0.04);
    shoe.castShadow = true;
    knee.add(shoe);

    const sole = new THREE.Mesh(new THREE.BoxGeometry(0.125, 0.02, 0.27), shoeSole);
    sole.position.set(0, -SHIN_LENGTH - 0.07, 0.04);
    knee.add(sole);

    return { upper: hip, lower: knee };
  };

  const makeArm = (side: -1 | 1): LimbChain => {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.26, SHOULDER_HEIGHT - 0.05, 0);

    const upperArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.048, UPPER_ARM_LENGTH - 0.096, 4, 8), skin);
    upperArm.position.y = -UPPER_ARM_LENGTH / 2;
    upperArm.castShadow = true;
    shoulder.add(upperArm);

    const elbow = new THREE.Group();
    elbow.position.y = -UPPER_ARM_LENGTH;
    shoulder.add(elbow);

    const forearm = new THREE.Mesh(new THREE.CapsuleGeometry(0.042, FOREARM_LENGTH - 0.084, 4, 8), skin);
    forearm.position.y = -FOREARM_LENGTH / 2;
    forearm.castShadow = true;
    elbow.add(forearm);

    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), skin);
    hand.position.y = -FOREARM_LENGTH - 0.02;
    hand.castShadow = true;
    elbow.add(hand);

    return { upper: shoulder, lower: elbow };
  };

  const legs = { left: makeLeg(-1), right: makeLeg(1) };
  const arms = { left: makeArm(-1), right: makeArm(1) };
  root.add(legs.left.upper, legs.right.upper, arms.left.upper, arms.right.upper);

  const torsoPivot = new THREE.Group();
  torsoPivot.position.set(0, (HIP_HEIGHT + SHOULDER_HEIGHT) / 2, 0);

  // The shorts stay fixed to the torso rather than swinging with the thigh -
  // real shorts hang from the hips, they don't rotate with the leg - which
  // reads far better than one solid leg-to-waist capsule.
  const pelvisY = HIP_HEIGHT - torsoPivot.position.y + 0.06;
  const pelvis = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 0.12, 4, 8), shorts);
  pelvis.position.y = pelvisY;
  pelvis.castShadow = true;
  torsoPivot.add(pelvis);

  const shortsStripe = new THREE.Mesh(new THREE.CylinderGeometry(0.196, 0.2, 0.035, 16, 1, true), shortsTrim);
  shortsStripe.position.y = pelvisY - 0.11;
  torsoPivot.add(shortsStripe);

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, SHOULDER_HEIGHT - HIP_HEIGHT - 0.28, 4, 8), jersey);
  torso.position.y = 0.09;
  torso.castShadow = true;
  torsoPivot.add(torso);

  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.095, 0.012, 6, 16), jerseyTrim);
  collar.position.y = SHOULDER_HEIGHT - torsoPivot.position.y - 0.03;
  collar.rotation.x = Math.PI / 2;
  torsoPivot.add(collar);

  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.08, 10), skin);
  neck.position.y = SHOULDER_HEIGHT - torsoPivot.position.y + 0.02;
  neck.castShadow = true;
  torsoPivot.add(neck);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), skin);
  head.position.set(0, SHOULDER_HEIGHT + 0.22 - torsoPivot.position.y, 0);
  head.castShadow = true;
  torsoPivot.add(head);

  const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.136, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hair);
  hairCap.position.copy(head.position);
  hairCap.castShadow = true;
  torsoPivot.add(hairCap);

  root.add(torsoPivot);

  return { root, torsoPivot, legs, arms };
}

/** Tunables for the procedural walk-cycle animation. */
const WALK_STRIDE_LENGTH = 1.6; // meters of travel per full gait cycle
const WALK_LEG_AMPLITUDE = 0.55; // radians, hip swing
const WALK_KNEE_AMPLITUDE = 0.85; // radians, knee flex during the forward swing
const WALK_ARM_AMPLITUDE_RATIO = 0.8;
const WALK_BOB_AMPLITUDE = 0.025; // meters
const WALK_RAMP_SPEED = 0.3; // m/s at which swing amplitude reaches full strength
const IDLE_SWAY_SPEED = 0.7; // rad/s
const ARM_ELBOW_REST_BEND = 0.3; // radians, relaxed athletic elbow bend for the non-ball arm

/** Lowered athletic stance while sprint-dribbling (spec section 26 posture note). */
const CROUCH_DROP = 0.05; // meters
const CROUCH_KNEE_BEND = 0.35; // radians added to both knees
const CROUCH_TORSO_LEAN = 0.15; // radians of forward torso lean
const CROUCH_LAMBDA = 8; // how fast the stance blends in/out

/** Elbow bend heuristic for pointArmAtBall - see that method for why this isn't full 2-bone IK. */
const ELBOW_STRAIGHT = 0.1;
const ELBOW_BENT = 2.0;

export class Player {
  readonly visualRoot: THREE.Group;
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  private readonly rig: PlayerRig;
  private readonly characterController: RAPIER.KinematicCharacterController;
  private verticalVelocity = 0;
  private walkPhase = 0;
  private idleTime = 0;
  private currentCrouch = 0;
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
   * Procedural walk cycle: swings the hip/knee and shoulder pivots on a
   * phase that advances with distance traveled (not raw time), so leg
   * turnover speed naturally scales with movement speed instead of just
   * amplitude. Call once per rendered frame - this is purely visual and
   * never touches physics.
   */
  updateWalkCycle(speed: number, dt: number, crouchTarget = 0): void {
    const crouchT = 1 - Math.exp(-CROUCH_LAMBDA * dt);
    this.currentCrouch += (crouchTarget - this.currentCrouch) * crouchT;

    const swingStrength = clamp(speed / WALK_RAMP_SPEED, 0, 1);

    if (speed > 0.01) {
      this.walkPhase += ((speed / WALK_STRIDE_LENGTH) * Math.PI * 2) * dt;
      this.idleTime = 0;
    } else {
      this.idleTime += dt;
    }

    const swing = Math.sin(this.walkPhase) * WALK_LEG_AMPLITUDE * swingStrength;
    const kneeCrouchBend = this.currentCrouch * CROUCH_KNEE_BEND;
    // Knee flexes while its leg is swinging forward (off the ground) and
    // straightens through the plant/stance half of the cycle - a cheap
    // stand-in for a real gait's knee flex that reads far less robotic
    // than rotating the whole leg as one rigid rod.
    const leftKneeSwing = Math.max(0, Math.sin(this.walkPhase)) * WALK_KNEE_AMPLITUDE * swingStrength;
    const rightKneeSwing = Math.max(0, -Math.sin(this.walkPhase)) * WALK_KNEE_AMPLITUDE * swingStrength;

    this.rig.legs.left.upper.rotation.x = swing;
    this.rig.legs.right.upper.rotation.x = -swing;
    this.rig.legs.left.lower.rotation.x = leftKneeSwing + kneeCrouchBend;
    this.rig.legs.right.lower.rotation.x = rightKneeSwing + kneeCrouchBend;

    this.rig.arms.left.upper.rotation.x = -swing * WALK_ARM_AMPLITUDE_RATIO;
    this.rig.arms.right.upper.rotation.x = swing * WALK_ARM_AMPLITUDE_RATIO;
    this.rig.arms.left.lower.rotation.x = ARM_ELBOW_REST_BEND;
    this.rig.arms.right.lower.rotation.x = ARM_ELBOW_REST_BEND;

    const bob = Math.abs(Math.sin(this.walkPhase * 2)) * WALK_BOB_AMPLITUDE * swingStrength;
    // subtle idle breathing sway so the character doesn't look frozen when standing still
    const idleSway = (1 - swingStrength) * Math.sin(this.idleTime * IDLE_SWAY_SPEED) * 0.01;
    this.rig.torsoPivot.position.y = (SHOULDER_HEIGHT + HIP_HEIGHT) / 2 + idleSway - this.currentCrouch * CROUCH_DROP;
    this.rig.torsoPivot.rotation.x = this.currentCrouch * CROUCH_TORSO_LEAN;
    // called after syncFromPhysics each frame, so this offsets that frame's ground-truth foot height
    this.visualRoot.position.y += bob - this.currentCrouch * CROUCH_DROP * 0.6;
  }

  /**
   * Procedural arm IK (spec section 8/26): while dribbling or gathering a
   * shot, the ball must read as being in the player's hand, not floating
   * near it. This rotates the dribbling-side shoulder so the whole arm
   * points at the ball's actual position every frame, then bends the elbow
   * by how close the ball is to the shoulder - fully bent when the ball is
   * tucked in near the body, straightening out toward the arm's full reach.
   * That's a cheap stand-in for real two-bone IK (which needs a pole vector
   * to pick a bend plane and can flip/glitch at extreme angles); this never
   * does, and at the distance the broadcast camera sits, reads just as
   * well. Overrides whatever the walk cycle set that arm to this frame -
   * call after updateWalkCycle.
   */
  pointArmAtBall(hand: 1 | -1, ballWorldPos: THREE.Vector3): void {
    const chain = hand === 1 ? this.rig.arms.right : this.rig.arms.left;
    const yaw = this.facingYaw;

    const localShoulderPos = chain.upper.position.clone().applyAxisAngle(UP, yaw);
    const worldShoulder = this.visualRoot.position.clone().add(localShoulderPos);

    const toBall = ballWorldPos.clone().sub(worldShoulder);
    const dist = toBall.length();
    if (dist < 1e-6) return;
    const dirWorld = toBall.multiplyScalar(1 / dist);

    const dirLocal = dirWorld.applyAxisAngle(UP, -yaw);
    chain.upper.quaternion.setFromUnitVectors(DOWN, dirLocal);

    const reach = clamp((dist / ARM_LENGTH - 0.35) / 0.65, 0, 1);
    chain.lower.rotation.x = THREE.MathUtils.lerp(ELBOW_BENT, ELBOW_STRAIGHT, reach);
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
