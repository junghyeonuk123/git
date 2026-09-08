import * as THREE from 'three';
import { GameLoop } from './GameLoop';
import { InputManager } from './InputManager';
import { PhysicsWorld } from '@/physics/PhysicsWorld';
import { Court } from '@/basketball/Court';
import { Hoop } from '@/basketball/Hoop';
import { Ball } from '@/basketball/Ball';
import { CourtDimensions as CD } from '@/basketball/CourtDimensions';
import { Player } from '@/player/Player';
import { PlayerController } from '@/player/PlayerController';
import { CameraController } from '@/camera/CameraController';

export interface LoadProgressCallback {
  (fraction: number, statusText: string): void;
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
  private ball!: Ball;
  private hoops: Hoop[] = [];
  private loop!: GameLoop;

  private looseBallTimer = 0;
  private readonly GRAVITY_MAGNITUDE = 9.81;

  private debugEnabled = false;
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

    onProgress(0.7, 'Spawning players…');
    this.cameraController = new CameraController(window.innerWidth / window.innerHeight);
    this.player = new Player(this.scene, this.physics, new THREE.Vector3(-4, 0, 0));

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

    this.loop = new GameLoop({
      fixedUpdate: this.fixedUpdate,
      update: this.update,
      render: this.render,
    });
    this.loop.start();

    onProgress(1, 'Ready');
  }

  private setupSceneBasics(): void {
    this.scene.background = new THREE.Color(0x0d1018);
    this.scene.fog = new THREE.Fog(0x0d1018, 26, 68);

    const hemi = new THREE.HemisphereLight(0x8fa6c9, 0x1a1410, 0.55);
    this.scene.add(hemi);

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

    const fill = new THREE.DirectionalLight(0x9db7ff, 0.35);
    fill.position.set(-10, 10, -10);
    this.scene.add(fill);
  }

  private readonly fixedUpdate = (dt: number): void => {
    this.playerController.fixedUpdate(this.cameraController.yaw, dt, this.hoops);
    this.physics.step();
    this.updateNets(dt);
    this.updateLooseBallRecovery(dt);
  };

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

  /** No defenders/AI exist yet (Phase 5), so a shot or pass that comes to rest is simply handed back. */
  private updateLooseBallRecovery(dt: number): void {
    // Safety net: an overpowered shot can clear the finite floor collider
    // entirely and free-fall forever with nothing to bounce off of -
    // that's a real (if extreme) physics outcome, not a bug, but without
    // an out-of-bounds rule yet (Phase 3) the ball needs a way back.
    if (this.ball.position.y < -3 || Math.hypot(this.ball.position.x, this.ball.position.z) > CD.length) {
      this.playerController.regainPossession();
      this.playerController.placeBallInHand();
      this.looseBallTimer = 0;
      return;
    }

    if (this.playerController.hasBall) {
      this.looseBallTimer = 0;
      return;
    }
    const speed = this.ball.linearVelocity.length();
    this.looseBallTimer = speed < 0.4 ? this.looseBallTimer + dt : 0;
    if (this.looseBallTimer > 1.2) {
      this.playerController.regainPossession();
      this.playerController.placeBallInHand();
      this.looseBallTimer = 0;
    }
  }

  private readonly update = (dt: number, _alpha: number): void => {
    this.player.syncFromPhysics();
    this.player.updateWalkCycle(this.playerController.movement.speed, dt);
    this.ball.syncFromPhysics();
    this.cameraController.update(this.player.position, this.playerController.movement.facingYaw, dt);

    if (this.debugEnabled) {
      this.renderDebugPanel(dt);
    }

    this.input.endFrame();
  };

  private readonly render = (): void => {
    this.renderer.render(this.scene, this.cameraController.camera);
  };

  private renderDebugPanel(dt: number): void {
    const fps = dt > 0 ? 1 / dt : 0;
    const v = this.ball.linearVelocity;
    const p = this.player.position;
    this.debugPanel.textContent = [
      `fps: ${fps.toFixed(0)}`,
      `physicsDt: ${this.physics.world.timestep.toFixed(4)}`,
      `playerPos: ${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)}`,
      `grounded: ${this.player.isGrounded}`,
      `ballVel: ${v.length().toFixed(2)}`,
      `hasBall: ${this.playerController.hasBall}`,
      `shotState: ${this.playerController.shooting.state}`,
      `shotMeter: ${this.playerController.shooting.meter.toFixed(3)}`,
      `lastShotZone: ${this.playerController.lastShotResult?.zone ?? '-'}`,
      `bodies: ${this.physics.world.bodies.len()}`,
      `colliders: ${this.physics.world.colliders.len()}`,
    ].join('\n');
  }

  private readonly onDebugToggle = (e: KeyboardEvent): void => {
    if (e.code !== 'F1') return;
    e.preventDefault();
    this.debugEnabled = !this.debugEnabled;
    this.debugPanel.hidden = !this.debugEnabled;
  };

  private readonly onResize = (): void => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setSize(width, height);
    this.cameraController?.setAspect(width / height);
  };
}
