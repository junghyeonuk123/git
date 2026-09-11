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
/** Scratch target for updateDribbleArm - avoids allocating a Vector3 every frame. */
const HAND_TARGET = new THREE.Vector3();
/** Scratch + geometry for the hand anchor: out to the side of the hip, and a little in front of it. */
const HAND_OFFSET = new THREE.Vector3();
/**
 * Widened from 0.32/0.22, which tucked the ball against the hip - almost
 * directly under the shoulder. From there the arm points straight down
 * whatever the ball is doing, so the dribbling arm never visibly moved
 * no matter what the stroke did to it. A real handler keeps the ball
 * outside the hip and slightly ahead, which is also the only way the
 * reach reads from a camera sitting behind the player: shoulder
 * abduction is visible from behind, fore/aft elbow swing is not.
 */
const HAND_SIDE_OFFSET = 0.44;
const HAND_FORWARD_OFFSET = 0.3;
/**
 * Seconds of travel the dribble pocket is pushed ahead of the player,
 * i.e. the pocket leads by this times the player's speed. At a walk
 * (3.2 m/s) that is about 0.45m of lead on top of HAND_FORWARD_OFFSET,
 * at a sprint (6.2 m/s) about 0.87m - the ball is genuinely put down in
 * front and run onto, rather than bounced at the hip and left behind.
 */
const DRIBBLE_LEAD_PER_SPEED = 0.14;
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

/**
 * How far a bent leg lifts the foot off the floor, from the rig's actual
 * segment lengths - so any stance can drop the body by exactly that much
 * and keep the feet planted. Hand-picked drop constants were the reason
 * a deeper stance either floated the player above the floor or sank the
 * shoes into it; deriving it means the bend angles can be tuned purely
 * for how the pose reads, with foot contact staying correct for free.
 *
 * `hip` is the forward thigh pitch and `knee` the fold behind it, both
 * as magnitudes (the negative-forward sign convention is applied by the
 * callers - see the note above CROUCH_KNEE_BEND).
 */
function legStanceDrop(hip: number, knee: number): number {
  const kneeY = HIP_HEIGHT - THIGH_LENGTH * Math.cos(hip);
  const footY = kneeY - SHIN_LENGTH * Math.cos(knee - hip);
  return Math.max(0, footY); // foot rest height is exactly 0, so this is the lift
}

/**
 * The shooter's height off the floor at `elapsed` seconds into the shot
 * motion. This is a REAL ballistic arc - one takeoff speed and actual
 * gravity - not a curve fitted to charge progress.
 *
 * That distinction is the whole fix for the shot reading as levitation.
 * The previous version keyed the rise to how far along the meter was, so
 * the body took ~0.40s to climb and ~0.46s to come back down. A 13cm hop
 * under real gravity is a 0.33s round trip, so the shooter was moving
 * vertically at well under half the speed gravity would carry them - and
 * the eye reads that as floating no matter how small the hop is. The
 * height was never the problem; the timing was.
 *
 * Being a function of seconds rather than of progress also means the
 * airborne phase after release just keeps advancing the same clock (see
 * Game.ts's shotAirElapsed), so takeoff, release and landing are one
 * continuous arc with no seam where the ball leaves.
 */
export function shotChargeLift(elapsedSeconds: number): number {
  const t = elapsedSeconds - SHOT_DIP_SECONDS;
  if (t <= 0) return 0;
  return Math.max(0, SHOT_TAKEOFF_SPEED * t - 0.5 * SHOT_JUMP_GRAVITY * t * t);
}

/**
 * How deep into the loaded stance the shooter is at `elapsed` seconds:
 * sinking through the dip, then extending explosively as the legs drive
 * the body off the floor. Hitting 0 exactly as the jump starts is what
 * makes the dip and the takeoff read as one push rather than a squat the
 * body then floats up out of.
 */
function shotDipAmount(elapsedSeconds: number): number {
  if (elapsedSeconds <= SHOT_DIP_SECONDS) return elapsedSeconds / SHOT_DIP_SECONDS;
  const extendT = (elapsedSeconds - SHOT_DIP_SECONDS) / SHOT_EXTEND_SECONDS;
  return Math.max(0, 1 - extendT);
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

/**
 * Lowered athletic stance. Deepened from the original values after
 * frame-by-frame comparison against real broadcast footage: a ball
 * handler is in a genuinely low stance - thighs well bent, torso leaned
 * forward over the ball - essentially the whole time they have the ball,
 * not just while sprinting. The old numbers left the player standing
 * bolt upright while dribbling, which is a big part of why the motion
 * read as stiff.
 */
// Sign convention for every pose below: this rig's limbs hang along -Y,
// so a POSITIVE rotation.x swings a limb backward and a NEGATIVE one
// swings it forward. A squat is therefore hip NEGATIVE (knee travels
// forward) with knee POSITIVE (shin folds back underneath) - getting
// that backwards folds the whole leg behind the body and reads as
// kneeling, not as sinking into a stance.
const CROUCH_KNEE_BEND = 1.15; // radians added to both knees
const CROUCH_HIP_BEND = 0.55; // radians the thigh pitches FORWARD (applied negative)
const CROUCH_TORSO_LEAN = 0.28; // radians of forward torso lean
const CROUCH_LAMBDA = 8; // how fast the stance blends in/out

/**
 * Dribble push-down tunables. A dribbler does not follow the ball all
 * the way to the floor with their hand - they push it down, stop around
 * thigh height, and meet it again on the way back up. Tracking the ball
 * the whole way (which is what pointArmAtBall does on its own) left the
 * arm hanging straight down at the court every bounce, so the ball read
 * as being escorted to the floor rather than bounced off it.
 */
/**
 * The top of the dribble pocket: the ball height at which the hand is
 * considered to have met the ball and the stroke starts over. Matched
 * to DribblePhysicsConfig's dribbleHeightNormal, because the ball
 * genuinely has to come back up to where the hand can be. This rig's
 * shoulder sits at SHOULDER_HEIGHT with an arm of ARM_LENGTH, so a
 * straight-down hand reaches about 1.0m - a pocket below that is a
 * pocket the hand physically cannot get to, which is exactly why the
 * old 0.66m pocket looked the way it did: the ball hovered around the
 * player's shin while the arms hung dead straight at their sides,
 * because there was no reachable ball for them to move toward.
 */
const DRIBBLE_POCKET_TOP = 0.95;
/** Ball height by which the hand has driven all the way through the push. */
const DRIBBLE_STROKE_BOTTOM = 0.72;
/** Hand height at the top of the pocket (receiving the ball) and at the bottom of the push. */
const DRIBBLE_HAND_HIGH = 0.98;
const DRIBBLE_HAND_LOW = 0.68;
/** Elbow angles across the stroke: cocked at the top of the pocket, driven through at the bottom. */
const DRIBBLE_ELBOW_COCKED = 1.05;
const DRIBBLE_ELBOW_DRIVEN = 0.12;
const DRIBBLE_PUMP_RISE = 0.075; // meters the body extends upward as the ball comes back up
const DRIBBLE_PUMP_LEAN = 0.11; // radians of extra torso lean at the bottom of the push

/** Elbow bend heuristic for pointArmAtBall - see that method for why this isn't full 2-bone IK. */
const ELBOW_STRAIGHT = 0.1;
const ELBOW_BENT = 2.0;

/**
 * Jump-shot tunables, taken from frame-stepping real broadcast footage:
 * the shooter dips into a deep knee bend, drives up out of it, releases
 * ON THE WAY UP, and lands shortly after. All of it is purely visual -
 * the physics capsule never leaves the ground, so nothing about ball
 * flight, collision or the character controller is affected.
 *
 * The ordering matters more than the numbers. The lift used to start at
 * the release, which meant the ball was already gone before the player
 * left the floor - reading as the shooter hovering upward on their own
 * after the shot rather than jumping into it.
 */
const SHOT_LOAD_KNEE = 1.45; // radians of knee bend at the bottom of the dip
const SHOT_LOAD_HIP = 0.68; // radians the thigh pitches forward through the load (applied negative)
/** Seconds spent sinking into the load before the legs fire. */
const SHOT_DIP_SECONDS = 0.15;
/** Seconds the legs take to snap from fully loaded to fully extended - this IS the takeoff. */
const SHOT_EXTEND_SECONDS = 0.12;
/**
 * Takeoff speed, m/s. Everything about the jump follows from this and
 * gravity: apex = v^2/2g = 0.247m, reached 0.224s after takeoff, back on
 * the floor 0.449s after takeoff. Deliberately a jump shot's hop, not a
 * max-effort vertical.
 */
const SHOT_TAKEOFF_SPEED = 2.2;
const SHOT_JUMP_GRAVITY = 9.81;
/** Seconds from the button going down to the shooter's feet being back on the floor. */
export const SHOT_LANDING_SECONDS = SHOT_DIP_SECONDS + (2 * SHOT_TAKEOFF_SPEED) / SHOT_JUMP_GRAVITY;
const SHOT_AIR_TUCK = 0.7; // radians of knee tuck while airborne
const SHOT_AIR_HIP = 0.14; // radians the thighs drift forward while airborne (applied negative)
const SHOT_ARM_FORWARD = 0.3; // how far forward "straight up" leans for the release/follow-through

/** Defensive athletic stance (bent knees, arms spread wide) - see setGuardingPose. */
const GUARD_KNEE_BEND = 1.25; // a defender sits lower than the ball handler
const GUARD_HIP_BEND = 0.6; // thigh pitched FORWARD (applied negative) so the stance squats rather than kneels
const GUARD_TORSO_LEAN = 0.3;
const GUARD_ARM_SPREAD = 1.15; // radians outward from straight down
const GUARD_ELBOW_BEND = 0.9;

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
    // Autostep is for climbing a step or a curb - a basketball court is
    // dead flat, so there is nothing here worth stepping onto. Left at
    // its old 25cm/dynamic-bodies-included setting it did the one thing
    // it could still find to climb: the other player. Pulling up over a
    // defender popped the shooter's capsule ~11cm straight up the instant
    // the two capsules touched, which is what made a contested jumper
    // look like it was released from mid-air by someone levitating. Kept
    // just large enough to absorb collider seams.
    this.characterController.enableAutostep(0.05, 0.05, false);
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
   * Recovery for a rare character-controller failure mode distinct from
   * the oversized-single-step glitch applyMovement already guards
   * against: under sustained large per-tick displacement (this project's
   * low-fps/software-rendered test environment can burst through many
   * queued fixed steps in one query), the controller can occasionally
   * report computedGrounded()=true for a step that actually leaves the
   * player with nothing underneath, so gravity then integrates normally
   * step after step - a real, gradually-accelerating fall, not a single
   * bad correction, so the distSq clamp above never sees anything to
   * reject. Snaps straight back to standing height at the current x/z
   * and zeroes vertical velocity, same shape as Ball's existing y<-3
   * safety net in Game.ts.
   */
  resetToGround(): void {
    const { capsuleRadius, capsuleHeight } = CD.player;
    const t = this.body.translation();
    this.body.setNextKinematicTranslation({ x: t.x, y: capsuleHeight / 2 + capsuleRadius, z: t.z });
    this.verticalVelocity = 0;
    this.isGrounded = true;
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

    // The thigh pitches back with the crouch as well as the knee folding,
    // otherwise a deep knee bend reads as kneeling rather than sinking
    // into a squat.
    const hipCrouchBend = this.currentCrouch * CROUCH_HIP_BEND;
    this.rig.legs.left.upper.rotation.x = swing - hipCrouchBend;
    this.rig.legs.right.upper.rotation.x = -swing - hipCrouchBend;
    this.rig.legs.left.lower.rotation.x = leftKneeSwing + kneeCrouchBend;
    this.rig.legs.right.lower.rotation.x = rightKneeSwing + kneeCrouchBend;

    this.rig.arms.left.upper.rotation.x = -swing * WALK_ARM_AMPLITUDE_RATIO;
    this.rig.arms.right.upper.rotation.x = swing * WALK_ARM_AMPLITUDE_RATIO;
    this.rig.arms.left.lower.rotation.x = ARM_ELBOW_REST_BEND;
    this.rig.arms.right.lower.rotation.x = ARM_ELBOW_REST_BEND;

    const bob = Math.abs(Math.sin(this.walkPhase * 2)) * WALK_BOB_AMPLITUDE * swingStrength;
    // subtle idle breathing sway so the character doesn't look frozen when standing still
    const idleSway = (1 - swingStrength) * Math.sin(this.idleTime * IDLE_SWAY_SPEED) * 0.01;
    this.rig.torsoPivot.position.y = (SHOULDER_HEIGHT + HIP_HEIGHT) / 2 + idleSway;
    this.rig.torsoPivot.rotation.x = this.currentCrouch * CROUCH_TORSO_LEAN;
    // The whole body sinks by exactly the height the bent legs lift the
    // feet, so a deeper stance visibly lowers the player (the only part
    // of a sagittal-plane knee bend that reads at all from the broadcast
    // camera's over-the-shoulder angle) while the shoes stay planted.
    // called after syncFromPhysics each frame, so this offsets that frame's ground-truth foot height
    this.visualRoot.position.y += bob - legStanceDrop(hipCrouchBend, kneeCrouchBend);
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

  /**
   * The dribbling arm specifically: pointArmAtBall, but with the hand
   * stopped at DRIBBLE_HAND_FLOOR instead of chasing the ball down to
   * the court, plus a small body pump synced to the bounce.
   *
   * The pump matters more than it sounds. The broadcast camera sits high
   * and behind, an angle from which fore/aft limb rotation is almost
   * invisible and only vertical body movement really reads - so a
   * dribble with no vertical component to it looks like the player is
   * gliding along beside a ball that happens to be bouncing. Extending
   * up as the ball rises and settling as the hand drives it back down
   * is what makes the two look connected.
   *
   * Call after updateWalkCycle, same as pointArmAtBall.
   */
  updateDribbleArm(hand: 1 | -1, ballWorldPos: THREE.Vector3, ballVerticalSpeed: number): void {
    const ground = this.groundY;
    const ballHeight = ballWorldPos.y - ground;

    // The stroke has to be keyed to the ball's PHASE, not just its
    // height, because a given height happens twice a bounce and the hand
    // is doing opposite things each time. On the way down the hand is
    // driving through the push; on the way up it is lifting back to the
    // top of the pocket to receive the ball. Height alone saturated
    // almost immediately (the ball spends most of its travel below the
    // pocket), which left the arm pinned at full extension for the whole
    // bounce - it looked exactly like an arm hanging at the player's
    // side, because that is what it was.
    const stroke =
      ballVerticalSpeed < 0
        ? clamp((DRIBBLE_POCKET_TOP - ballHeight) / (DRIBBLE_POCKET_TOP - DRIBBLE_STROKE_BOTTOM), 0, 1)
        : 1 - clamp(ballHeight / DRIBBLE_POCKET_TOP, 0, 1);

    // The shoulder aims along the stroke rather than at the ball itself:
    // once the ball is below the pocket it is airborne and out of the
    // hand, so following it to the floor would be reaching, not
    // dribbling.
    const aimY = ground + THREE.MathUtils.lerp(DRIBBLE_HAND_HIGH, DRIBBLE_HAND_LOW, stroke);
    HAND_TARGET.set(ballWorldPos.x, aimY, ballWorldPos.z);
    this.pointArmAtBall(hand, HAND_TARGET);

    // pointArmAtBall picks the elbow from how far away the ball is,
    // which over a dribble's narrow range of distances never changes -
    // the arm stayed rigid for the whole bounce. The stroke is what
    // should be driving it: cocked as the hand takes the ball, straight
    // as it drives through. This is the single most visible part of a
    // dribble and it was simply absent.
    const chain = hand === 1 ? this.rig.arms.right : this.rig.arms.left;
    chain.lower.rotation.x = THREE.MathUtils.lerp(DRIBBLE_ELBOW_COCKED, DRIBBLE_ELBOW_DRIVEN, stroke);

    // Rise on the way up rather than sinking on the way down, so the
    // shoes never get pushed through the court on the push-down half.
    this.visualRoot.position.y += (1 - stroke) * DRIBBLE_PUMP_RISE;
    this.rig.torsoPivot.rotation.x += stroke * DRIBBLE_PUMP_LEAN;
  }

  /**
   * The windup half of a jump shot: sinking into a loaded stance and
   * then driving up out of it. `elapsedSeconds` is real time since the
   * shoot button went down, NOT charge progress - the whole point of the
   * rewrite is that the body's vertical motion runs on gravity's clock
   * rather than the meter's. Call after updateWalkCycle (it deepens
   * whatever stance that produced) and before/alongside pointArmAtBall,
   * which handles the ball-side arm.
   */
  loadShot(elapsedSeconds: number): void {
    const elapsed = Math.max(0, elapsedSeconds);
    const dip = shotDipAmount(elapsed);

    const priorKnee = this.rig.legs.left.lower.rotation.x;
    const hip = Math.max(CROUCH_HIP_BEND * this.currentCrouch, SHOT_LOAD_HIP * dip);
    const knee = Math.max(priorKnee * dip, SHOT_LOAD_KNEE * dip);
    for (const leg of [this.rig.legs.left, this.rig.legs.right]) {
      leg.lower.rotation.x = knee;
      leg.upper.rotation.x = -hip;
    }
    this.rig.torsoPivot.rotation.x = Math.max(this.rig.torsoPivot.rotation.x, CROUCH_TORSO_LEAN * dip);

    // Undo the walk cycle's own crouch planting, apply this stance's,
    // then add however far the drive has lifted the body off the floor.
    this.visualRoot.position.y +=
      legStanceDrop(CROUCH_HIP_BEND * this.currentCrouch, CROUCH_KNEE_BEND * this.currentCrouch) -
      legStanceDrop(hip, knee) +
      shotChargeLift(elapsed);
  }

  /**
   * The airborne half: an actual jump off the floor with the legs tucked
   * and both arms held extended overhead through the release and
   * follow-through, landing at the end of the window. Real broadcast
   * footage is unambiguous that this is where a jump shot's readability
   * comes from - the shooter leaves the floor, and the arms stay up on
   * the way down - where this project previously had the shooting arm
   * snap straight back to the idle pose the instant the ball left the
   * hand, with the player never leaving the ground at all.
   *
   * `elapsedSeconds` is the SAME clock loadShot was being driven by, just
   * kept running past the release, so the height comes straight back out
   * of shotChargeLift and the arc continues with no seam where the ball
   * leaves. Entirely visual: the lift is applied to visualRoot the same
   * way updateWalkCycle's bob/crouch offsets are, so the physics capsule,
   * ball flight and character controller are all untouched.
   */
  updateShotAir(hand: 1 | -1, elapsedSeconds: number): void {
    const height = shotChargeLift(elapsedSeconds);
    // 1 at takeoff, 0 at touchdown - drives the leg tuck and the guide
    // hand relaxing out of the follow-through on the way down.
    const air = clamp(
      (SHOT_LANDING_SECONDS - elapsedSeconds) / (SHOT_LANDING_SECONDS - SHOT_DIP_SECONDS),
      0,
      1,
    );

    for (const leg of [this.rig.legs.left, this.rig.legs.right]) {
      leg.lower.rotation.x = Math.max(leg.lower.rotation.x, SHOT_AIR_TUCK * air);
      leg.upper.rotation.x = -SHOT_AIR_HIP * air;
    }

    // Both arms finish overhead - the guide hand comes up with the
    // shooting hand on a real jump shot, it doesn't stay at the hip.
    const shootDir = new THREE.Vector3(0, 1, SHOT_ARM_FORWARD).normalize();
    const guideDir = new THREE.Vector3(-hand * 0.22, 1, SHOT_ARM_FORWARD * 0.8).normalize();
    const shootArm = hand === 1 ? this.rig.arms.right : this.rig.arms.left;
    const guideArm = hand === 1 ? this.rig.arms.left : this.rig.arms.right;
    shootArm.upper.quaternion.setFromUnitVectors(DOWN, shootDir);
    shootArm.lower.rotation.x = ELBOW_STRAIGHT;
    guideArm.upper.quaternion.setFromUnitVectors(DOWN, guideDir);
    guideArm.lower.rotation.x = THREE.MathUtils.lerp(ELBOW_STRAIGHT, 0.6, 1 - air);

    this.visualRoot.position.y += height;
  }

  /**
   * Athletic defensive stance: knees bent low, arms spread wide to the
   * sides rather than swinging with the gait. Without this the defender
   * used the exact same relaxed walk-cycle arm swing as the ball
   * handler, which reads as strange since a defender is always driven
   * by DefenderAI's own facing override (always toward the attacker,
   * never toward its own movement direction - see that class) rather
   * than a natural walking gait, so an ordinary arm swing on top of that
   * looked like sliding rather than guarding. Call after updateWalkCycle.
   */
  setGuardingPose(): void {
    for (const side of [-1, 1] as const) {
      const chain = side === 1 ? this.rig.arms.right : this.rig.arms.left;
      const localDir = new THREE.Vector3(side * GUARD_ARM_SPREAD, -1, 0.15).normalize();
      chain.upper.quaternion.setFromUnitVectors(DOWN, localDir);
      chain.lower.rotation.x = GUARD_ELBOW_BEND;
    }
    // A floor, not an addition: adding the stance on top of the walk
    // cycle's own knee swing compounded mid-stride into a jerky
    // over-bent leg, which is what made the guarding pose read as
    // stumbling rather than sliding.
    for (const leg of [this.rig.legs.left, this.rig.legs.right]) {
      leg.lower.rotation.x = Math.max(leg.lower.rotation.x, GUARD_KNEE_BEND);
      leg.upper.rotation.x = leg.upper.rotation.x * 0.5 - GUARD_HIP_BEND;
    }
    this.rig.torsoPivot.rotation.x = Math.max(this.rig.torsoPivot.rotation.x, GUARD_TORSO_LEAN);
    this.visualRoot.position.y -= legStanceDrop(GUARD_HIP_BEND, GUARD_KNEE_BEND);
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
   *
   * `side` is +1 for the right hand and -1 for the left, but takes any
   * value in between: a two-handed shot pocket sits partway toward the
   * centerline rather than out at one hand (see ShootingSystem's
   * GATHER_CENTERING), and 0 is dead center in front of the chest.
   */
  getHandPosition(out: THREE.Vector3, side: number, heightAboveGround: number): THREE.Vector3 {
    const p = this.position;
    HAND_OFFSET.set(side * HAND_SIDE_OFFSET, 0, HAND_FORWARD_OFFSET).applyAxisAngle(UP, this.facingYaw);
    return out.set(p.x + HAND_OFFSET.x, this.groundY + heightAboveGround, p.z + HAND_OFFSET.z);
  }

  /**
   * The dribble pocket - where the ball should be bounced - either right
   * now (`seconds` = 0) or `seconds` into the future, assuming the
   * player carries on at `velocity` and turns to face it.
   *
   * Two things separate this from getHandPosition, and both of them are
   * why a drive used to leave the ball behind:
   *
   * The pocket LEADS the player, by more the faster they are going. A
   * handler at speed does not bounce the ball beside their hip - they
   * push it out in front and run onto it, which is the only way to move
   * quickly without the ball being left behind, because the ball is
   * untouchable for most of every bounce and the player covers real
   * ground in that time. With a fixed 0.3m offset the ball was being
   * put down level with the hip and the player simply outran it.
   *
   * And it is predictive: a push has to land the ball where the hand
   * will be a whole bounce from now, and the hand does not just
   * translate with the body - it swings around it as the player turns,
   * by up to half a metre through a 90-degree cut.
   */
  getDribbleHandPosition(
    out: THREE.Vector3,
    side: number,
    heightAboveGround: number,
    travelVelocity: THREE.Vector2,
    leadVelocity: THREE.Vector2,
    seconds: number,
  ): THREE.Vector3 {
    const p = this.position;
    // Two different velocities doing two different jobs, and conflating
    // them breaks one or the other. `travelVelocity` is where the player
    // is going, and is what the body's position `seconds` from now is
    // extrapolated from - it has to be the live value or a drive puts
    // the ball down behind the player. `leadVelocity` only orients and
    // sizes the lead, and is deliberately a smoothed version: the raw
    // direction flips the instant the stick does, which whipped the
    // pocket - lead and all - clean across the body in a single step and
    // left it a metre and a half from where the ball actually was.
    const leadSpeed = leadVelocity.length();
    const yaw = leadSpeed > 1e-3 ? Math.atan2(leadVelocity.x, leadVelocity.y) : this.facingYaw; // .y stores world Z
    const lead = HAND_FORWARD_OFFSET + DRIBBLE_LEAD_PER_SPEED * leadSpeed;
    HAND_OFFSET.set(side * HAND_SIDE_OFFSET, 0, lead).applyAxisAngle(UP, yaw);
    return out.set(
      p.x + travelVelocity.x * seconds + HAND_OFFSET.x,
      this.groundY + heightAboveGround,
      p.z + travelVelocity.y * seconds + HAND_OFFSET.z,
    );
  }
}
