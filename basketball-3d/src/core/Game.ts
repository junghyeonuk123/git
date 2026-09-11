import * as THREE from 'three';
import { GameLoop } from './GameLoop';
import { InputManager } from './InputManager';
import { PhysicsWorld } from '@/physics/PhysicsWorld';
import { Court } from '@/basketball/Court';
import { Hoop } from '@/basketball/Hoop';
import { Arena } from '@/environment/Arena';
import { Crowd } from '@/environment/Crowd';
import { Ball } from '@/basketball/Ball';
import { CourtDimensions as CD } from '@/basketball/CourtDimensions';
import { BasketballRules } from '@/basketball/BasketballRules';
import { Player, SHOT_LANDING_SECONDS } from '@/player/Player';
import { PlayerController } from '@/player/PlayerController';
import { nearestHoop, type ShotResult } from '@/player/ShootingSystem';
import { DefenderAI } from '@/ai/DefenderAI';
import { classifyBallMotion, isRecoverable } from '@/basketball/LooseBallRecovery';
import { CameraController } from '@/camera/CameraController';
import { Scoreboard } from '@/ui/Scoreboard';
import { GameClock } from '@/ui/GameClock';
import { ShotMeter } from '@/ui/ShotMeter';
import { PickupIndicator } from '@/ui/PickupIndicator';

export interface LoadProgressCallback {
  (fraction: number, statusText: string): void;
}

/**
 * A cheap stand-in for real arena geometry (Phase 8): a vertical gradient
 * from dark ceiling to a warmer glow near the horizon, instead of one flat
 * background color. Costs nothing at runtime (baked once at load) but goes
 * a long way toward not reading as an empty void around the court.
 */
function buildArenaGradient(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, '#05070c');
  gradient.addColorStop(0.55, '#0d1420');
  gradient.addColorStop(1, '#232f42');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Top-level orchestrator. Owns the render/physics setup and wires every
 * system's per-frame update, but contains no gameplay rules itself -
 * that keeps this file from growing into the "one giant main.ts" the
 * spec explicitly warns against.
 */
export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly input = new InputManager();

  private physics!: PhysicsWorld;
  private cameraController!: CameraController;
  private player!: Player;
  private playerController!: PlayerController;
  private defender!: DefenderAI;
  private ball!: Ball;
  private hoops: Hoop[] = [];
  private crowd!: Crowd;
  private loop!: GameLoop;

  private readonly rules = new BasketballRules();
  private readonly scoreboard = new Scoreboard();
  private readonly gameClock = new GameClock();
  private readonly shotMeter = new ShotMeter();
  private readonly pickupIndicator = new PickupIndicator();
  private lastSeenShotResult: ShotResult | null = null;
  private lastSeenRuleEventAt = -1;
  private elapsedTime = 0;
  /**
   * The shot motion's clock, kept running past the release so the jump
   * arc continues uninterrupted through it (see Player.shotChargeLift).
   * Negative means no shot is in the air.
   */
  private shotAirElapsed = -1;
  private shotAirHand: 1 | -1 = 1;

  private readonly GRAVITY_MAGNITUDE = 9.81;
  /** Small accent light that tracks the controlled player - keeps them reading as the visual focal point (spec section 19/53). */
  private readonly playerLight = new THREE.PointLight(0xfff2df, 9, 7, 2);

  private debugEnabled = false;
  /** Spec section 41: a dedicated dribble-physics debug block, independent of the main F1 panel. */
  private dribbleDebugEnabled = false;
  private readonly debugPanel = document.getElementById('debug-panel') as HTMLDivElement;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // WebGLRenderer defaults to a 300x150 backing buffer until setSize is
    // called; without an initial call here the canvas was being upscaled
    // by CSS to fill the viewport, which is what caused the whole scene
    // to look badly blurred.
    this.renderer.setSize(window.innerWidth, window.innerHeight);

    window.addEventListener('resize', this.onResize);
  }

  async start(onProgress: LoadProgressCallback): Promise<void> {
    onProgress(0.05, 'Booting renderer…');
    this.setupSceneBasics();

    onProgress(0.2, 'Initializing physics…');
    this.physics = await PhysicsWorld.create();

    onProgress(0.45, 'Building court…');
    new Court(this.scene, this.physics);
    this.hoops = [new Hoop(this.scene, this.physics, 1), new Hoop(this.scene, this.physics, -1)];

    onProgress(0.6, 'Building arena…');
    new Arena(this.scene);
    this.crowd = new Crowd(this.scene);

    onProgress(0.7, 'Spawning players…');
    this.cameraController = new CameraController(window.innerWidth / window.innerHeight);
    this.player = new Player(this.scene, this.physics, new THREE.Vector3(-4, 0, 0));
    this.defender = new DefenderAI(this.scene, this.physics, new THREE.Vector3(-2, 0, 1.5));

    onProgress(0.85, 'Placing basketball…');
    this.ball = new Ball(this.scene, this.physics, new THREE.Vector3(-4, 1, 0));
    this.playerController = new PlayerController(
      this.player,
      this.ball,
      this.input,
      this.GRAVITY_MAGNITUDE,
      this.physics.world.timestep,
    );
    this.playerController.placeBallInHand();

    onProgress(0.95, 'Warming up…');
    this.input.rebind('toggleDebug', ['F1']);
    window.addEventListener('keydown', this.onDebugToggle);
    window.addEventListener('keydown', this.onDribbleDebugToggle);

    this.loop = new GameLoop({
      fixedUpdate: this.fixedUpdate,
      update: this.update,
      render: this.render,
    });
    this.loop.start();

    onProgress(1, 'Ready');
  }

  private setupSceneBasics(): void {
    const bg = buildArenaGradient();
    this.scene.background = bg;
    this.scene.fog = new THREE.Fog(0x0d1420, 26, 68);

    const hemi = new THREE.HemisphereLight(0x8fa6c9, 0x1a1410, 0.55);
    this.scene.add(hemi);

    // key light
    const sun = new THREE.DirectionalLight(0xfff2df, 2.1);
    sun.position.set(12, 18, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 45;
    sun.shadow.camera.left = -18;
    sun.shadow.camera.right = 18;
    sun.shadow.camera.top = 12;
    sun.shadow.camera.bottom = -12;
    sun.shadow.bias = -0.0015;
    this.scene.add(sun);

    // fill light, softening the key light's shadow side
    const fill = new THREE.DirectionalLight(0x9db7ff, 0.35);
    fill.position.set(-10, 10, -10);
    this.scene.add(fill);

    // rim/kicker light: positioned behind the play relative to the fixed
    // broadcast camera (which sits on the -Z side looking toward +Z), so
    // it catches shoulder/head edges and helps players separate from the
    // dark background instead of reading as flat silhouettes.
    const rim = new THREE.DirectionalLight(0xbcd4ff, 0.6);
    rim.position.set(-4, 7, 22);
    this.scene.add(rim);

    // overhead arena lighting rig: a handful of non-shadow-casting point
    // lights above center court and each hoop, mainly there to put a
    // visible specular highlight on the clearcoat hardwood (spec section
    // 19/21) - a flat court under directional light alone doesn't read as
    // "under stadium lights."
    const rigPositions: Array<[number, number, number]> = [
      [0, 9.5, 0],
      [CD.length / 2 - 6, 8.5, 0],
      [-(CD.length / 2 - 6), 8.5, 0],
    ];
    for (const [x, y, z] of rigPositions) {
      const rig = new THREE.PointLight(0xfff6e0, 55, 24, 2);
      rig.position.set(x, y, z);
      this.scene.add(rig);
    }

    // accent light tracking the controlled player - see fixedUpdate/update
    // for the per-frame position sync
    this.scene.add(this.playerLight);
  }

  private readonly fixedUpdate = (dt: number): void => {
    // Movement is world-relative, not camera-relative - the broadcast
    // camera (CameraController) never rotates, so there is no camera yaw
    // to convert input against.
    this.playerController.fixedUpdate(dt, this.hoops, this.defender.player.position);
    if (this.player.position.y < -2) {
      this.player.resetToGround();
    }
    this.defender.fixedUpdate(dt, this.player, this.ball, this.hoops, this.playerController);
    if (this.defender.player.position.y < -2) {
      this.defender.player.resetToGround();
    }
    this.physics.step();
    this.checkBallCollisionEvents();
    this.updateNets(dt);

    if (this.playerController.lastShotResult && this.playerController.lastShotResult !== this.lastSeenShotResult) {
      this.lastSeenShotResult = this.playerController.lastShotResult;
      this.rules.beginShotAttempt(this.lastSeenShotResult, this.ball.position);
      this.shotAirHand = this.playerController.hand;
      // release() leaves the meter at its release value, so this is how
      // far into the jump the ball actually left the hand. Handing the
      // same clock to updateShotAir is what makes takeoff, release and
      // landing one arc instead of two animations stitched together.
      this.shotAirElapsed = this.playerController.shooting.chargeSeconds;
    }
    this.rules.update(
      dt,
      this.ball.position,
      this.player.position,
      this.playerController.hasBall,
      this.playerController.shooting.state !== 'idle',
    );
    if (this.rules.lastEvent?.kind === 'score' && this.rules.lastEvent.at !== this.lastSeenRuleEventAt) {
      this.lastSeenRuleEventAt = this.rules.lastEvent.at;
      this.crowd.triggerCheer();
    }

    this.updateLooseBallRecovery();
  };

  /**
   * One drain per step for every ball collision-event consumer - the
   * event queue's buffer is cleared as soon as it's drained once, so this
   * has to be the single place anything reads it.
   *
   * Rule 7-Section IV-4-1 needs to know whether a missed shot actually
   * touched the rim (vs. an airball, which never resets the shot clock).
   * Rule 8-Section II-1 needs to know if the ball touched a basket's
   * support pole, which is a dead-ball out-of-bounds rather than a legal
   * bounce.
   */
  private checkBallCollisionEvents(): void {
    const ballHandle = this.ball.collider.handle;
    const otherHandle = (h1: number, h2: number): number | null =>
      h1 === ballHandle ? h2 : h2 === ballHandle ? h1 : null;

    this.physics.drainCollisionEvents((handle1, handle2, started) => {
      if (!started) return;
      const other = otherHandle(handle1, handle2);
      if (other === null) return;
      if (this.hoops.some((h) => h.rimCollider.handle === other)) {
        this.rules.notifyRimContact();
      } else if (this.hoops.some((h) => h.poleCollider.handle === other)) {
        this.rules.notifyBasketSupportContact();
      }
    });
  }

  /** Net physics (spec section 7): simulate each hoop's net and let the ball disturb it when nearby. */
  private updateNets(dt: number): void {
    const ballPos = this.ball.position;
    const ballVel = this.ball.linearVelocity;
    for (const hoop of this.hoops) {
      hoop.net.update(dt);
      const local = ballPos.clone().sub(hoop.rimCenter);
      const horizDist = Math.hypot(local.x, local.z);
      const withinRing = horizDist < CD.hoop.rimRadius * 1.6;
      const withinHeight = local.y < 0.15 && local.y > -CD.hoop.netHeight - 0.15;
      if (withinRing && withinHeight) {
        hoop.net.applyBallInfluence(local, ballVel);
      }
    }
  }

  /**
   * Normal loose-ball recovery (the player running down and picking up a
   * live ball) is handled every tick inside PlayerController via
   * LooseBallRecoverySystem - real proximity/orientation/ball-speed
   * gating and a brief grab interpolation instead of a teleport (see
   * LooseBallRecovery.ts for why the old approach here, a pure "ball has
   * been slow for 1.2s" timer with no player-position check at all,
   * could leave a player standing right next to a rolling ball forever).
   *
   * What's left here are the two cases that are legitimately an instant
   * administrative reset, not a physical recovery: the ball leaving the
   * playable world entirely, and a rules-forced dead ball. No defenders/
   * AI exist yet (Phase 5) and there's no second team to award a
   * turnover to, so both just hand the ball back to the player.
   */
  private updateLooseBallRecovery(): void {
    // Hard safety net unrelated to game rules: an overpowered shot could
    // in principle clear the finite floor collider entirely and free-fall
    // forever with nothing left to bounce off of.
    if (this.ball.position.y < -3) {
      this.recoverBall();
      return;
    }

    if (this.rules.turnoverRequested) {
      this.recoverBall();
    }
  }

  private recoverBall(): void {
    this.playerController.regainPossession();
    this.playerController.placeBallInHand();
  }

  private readonly update = (dt: number, _alpha: number): void => {
    this.elapsedTime += dt;
    this.crowd.update(dt, this.elapsedTime);
    this.player.syncFromPhysics();
    // A ball handler is in a low athletic stance essentially the whole
    // time they have the ball, not only while sprinting - standing bolt
    // upright over a live dribble was a large part of why the motion
    // read as stiff next to real footage.
    const stanceTarget = this.playerController.dribbleSprintActive ? 1 : this.playerController.hasBall ? 0.6 : 0;
    this.player.updateWalkCycle(this.playerController.movement.speed, dt, stanceTarget);
    this.playerLight.position.set(this.player.position.x, this.player.position.y + 2.4, this.player.position.z);
    this.defender.syncFromPhysics();
    this.defender.updateVisuals(dt);
    this.ball.syncFromPhysics();
    const charging = this.playerController.shooting.state === 'charging';
    if (this.playerController.hasBall) {
      if (charging) {
        // Sink into the loaded stance as the shot winds up, and bring
        // BOTH hands to the ball - a real gather is two-handed, where
        // this previously left the off hand swinging at the hip.
        this.player.loadShot(this.playerController.shooting.chargeSeconds);
        this.player.pointArmAtBall(1, this.ball.position);
        this.player.pointArmAtBall(-1, this.ball.position);
      } else {
        // visually plants the dribbling hand on the ball instead of letting
        // it read as a separate object bouncing near the player (spec
        // section 26: ball/hand IK), and pumps the body with the bounce
        // so the player is visibly pushing the ball down rather than
        // walking alongside it.
        this.player.updateDribbleArm(this.playerController.hand, this.ball.position, this.ball.linearVelocity.y);
      }
    } else if (this.shotAirElapsed >= 0) {
      this.shotAirElapsed += dt;
      this.player.updateShotAir(this.shotAirHand, this.shotAirElapsed);
      if (this.shotAirElapsed >= SHOT_LANDING_SECONDS) this.shotAirElapsed = -1;
    }
    this.cameraController.update(this.player.position, this.ball.position, dt, {
      speed: this.playerController.movement.speed,
      charging,
      chargeFocusX: charging ? nearestHoop(this.hoops, this.ball.position).rimCenter.x : null,
      hasBall: this.playerController.hasBall,
    });

    this.scoreboard.update(this.rules, dt);
    this.gameClock.update(this.rules);
    this.shotMeter.update(this.playerController.shooting);
    this.pickupIndicator.update(!this.playerController.hasBall && isRecoverable(this.player, this.ball));

    if (this.debugEnabled || this.dribbleDebugEnabled) {
      this.renderDebugPanel(dt);
    }

    this.input.endFrame();
  };

  private readonly render = (): void => {
    this.renderer.render(this.scene, this.cameraController.camera);
  };

  private renderDebugPanel(dt: number): void {
    const lines: string[] = [];

    if (this.debugEnabled) {
      const fps = dt > 0 ? 1 / dt : 0;
      const v = this.ball.linearVelocity;
      const bp = this.ball.position;
      const p = this.player.position;
      lines.push(
        `fps: ${fps.toFixed(0)}`,
        `physicsDt: ${this.physics.world.timestep.toFixed(4)}`,
        `playerPos: ${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}`,
        `grounded: ${this.player.isGrounded}  facingYaw: ${this.player.facingYaw.toFixed(2)}`,
        `ballPos: ${bp.x.toFixed(2)}, ${bp.y.toFixed(2)}, ${bp.z.toFixed(2)}`,
        `ballVel: ${v.length().toFixed(2)}`,
        `hasBall: ${this.playerController.hasBall}`,
        `ballMotion: ${classifyBallMotion(this.ball)}  distToBall: ${p.distanceTo(bp).toFixed(2)}  recovering: ${this.playerController.looseBallRecovery.isRecovering}`,
        `speed: ${this.playerController.movement.speed.toFixed(2)}  sprintActive: ${this.playerController.dribbleSprintActive}`,
        `playerState: ${this.playerController.stateMachine.current} (${this.playerController.stateMachine.timeInState.toFixed(2)}s)`,
        `ballOwnership: ${this.playerController.ballOwnership.current} (owner: ${this.playerController.ballOwnership.owner})`,
        `ownershipCheck: ${this.playerController.ballOwnership.checkConsistency(this.ball) ?? 'ok'}`,
        `shotState: ${this.playerController.shooting.state}`,
        `shotMeter: ${this.playerController.shooting.meter.toFixed(3)}`,
        `shotAir: ${this.shotAirElapsed.toFixed(3)}s  chargeS: ${this.playerController.shooting.chargeSeconds.toFixed(3)}  visualY: ${this.player.visualRoot.position.y.toFixed(3)}`,
        `lastShotZone: ${this.playerController.lastShotResult?.zone ?? '-'}  contest: ${this.playerController.lastShotResult ? this.playerController.lastShotResult.contestLevel.toFixed(2) : '-'}  contestDist: ${this.playerController.lastShotResult ? this.playerController.lastShotResult.contestDistance.toFixed(2) : '-'}`,
        `score: ${this.rules.score}  quarter: ${this.rules.quarter}  quarterClock: ${this.rules.quarterClock.toFixed(1)}`,
        `shotClock: ${this.rules.shotClock.toFixed(1)}`,
        `lastRuleEvent: ${this.rules.lastEvent?.detail ?? '-'}`,
        `defenderPos: ${this.defender.player.position.x.toFixed(2)}, ${this.defender.player.position.z.toFixed(2)}  distToBall: ${this.defender.debugState.distanceToBall.toFixed(2)}  stealCooldown: ${this.defender.debugState.stealCooldown.toFixed(2)}`,
        `bodies: ${this.physics.world.bodies.len()}`,
        `colliders: ${this.physics.world.colliders.len()}`,
      );
    }

    if (this.dribbleDebugEnabled) {
      // Dribbling-physics rework spec section 41: everything needed to
      // confirm the ball is a real independent physical object and not
      // reattached to the hand - velocity, angular velocity, the current
      // hand-ball distance (should visibly swing, not sit constant), the
      // bounce phase, and time since the last floor contact.
      if (lines.length > 0) lines.push('--- dribble debug (F8) ---');
      const pv = this.playerController.movement.velocity;
      const bv = this.ball.linearVelocity;
      const bav = this.ball.angularVelocity;
      lines.push(
        `hand: ${this.playerController.hand === 1 ? 'right' : 'left'}`,
        `dribblePhase: ${this.playerController.dribble.phase}`,
        `contactTimer: ${this.playerController.dribble.contactTimer.toFixed(3)}s`,
        `handDistance: ${this.playerController.dribble.handDistance.toFixed(3)}m  lastPush: ${this.playerController.dribble.pushSpeed.toFixed(2)}m/s`,
        `ballVel: ${bv.x.toFixed(2)}, ${bv.y.toFixed(2)}, ${bv.z.toFixed(2)}  (|v|=${bv.length().toFixed(2)})`,
        `ballAngVel: ${bav.length().toFixed(2)} rad/s`,
        `playerVel: ${pv.x.toFixed(2)}, ${pv.y.toFixed(2)}  (|v|=${this.playerController.movement.speed.toFixed(2)})`,
        `ballAuthority: ${this.ball.isKinematic ? 'held (kinematic)' : 'physics (dynamic)'}`,
      );
    }

    this.debugPanel.textContent = lines.join('\n');
  }

  private readonly onDebugToggle = (e: KeyboardEvent): void => {
    if (e.code !== 'F1') return;
    e.preventDefault();
    this.debugEnabled = !this.debugEnabled;
    this.debugPanel.hidden = !(this.debugEnabled || this.dribbleDebugEnabled);
  };

  private readonly onDribbleDebugToggle = (e: KeyboardEvent): void => {
    if (e.code !== 'F8') return;
    e.preventDefault();
    this.dribbleDebugEnabled = !this.dribbleDebugEnabled;
    this.debugPanel.hidden = !(this.debugEnabled || this.dribbleDebugEnabled);
    if (!this.dribbleDebugEnabled && !this.debugEnabled) {
      this.debugPanel.textContent = '';
    }
  };

  private readonly onResize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setSize(width, height);
    this.cameraController?.setAspect(width / height);
    // Fat-line net rendering (see Net.ts) needs the viewport size to keep
    // its screen-space pixel width correct after a resize.
    for (const hoop of this.hoops) {
      hoop.net.setResolution(width, height);
    }
  };
}
