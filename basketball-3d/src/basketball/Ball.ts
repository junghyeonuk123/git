import * as THREE from 'three';
import type { PhysicsWorld } from '@/physics/PhysicsWorld';
import { PhysicsMaterials, BALL_LINEAR_DAMPING } from '@/physics/MaterialProperties';
import { CollisionGroup, interactionGroups } from '@/physics/CollisionLayers';
import { CourtDimensions as CD } from './CourtDimensions';

/**
 * A real dynamic rigid body - never a scripted/animated position. Every
 * bounce, rim deflection and backboard carom the player sees is the
 * physics engine's own output.
 */
export class Ball {
  readonly mesh: THREE.Mesh;
  readonly body: import('@dimforge/rapier3d-compat').RigidBody;
  private readonly seamGroup: THREE.Group;

  constructor(scene: THREE.Scene, physics: PhysicsWorld, spawn: THREE.Vector3) {
    const radius = CD.ball.radius;

    const geometry = new THREE.SphereGeometry(radius, 32, 24);
    const material = new THREE.MeshStandardMaterial({
      color: 0xcf5a1e,
      roughness: 0.75,
      metalness: 0.05,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;

    // seam lines as thin torus overlays, purely cosmetic
    this.seamGroup = new THREE.Group();
    const seamMat = new THREE.MeshStandardMaterial({ color: 0x1a1008, roughness: 0.9 });
    const seamRadius = radius * 1.003;
    const tube = radius * 0.012;
    const ring = (rotX: number, rotY: number) => {
      const torus = new THREE.Mesh(new THREE.TorusGeometry(seamRadius, tube, 8, 48), seamMat);
      torus.rotation.x = rotX;
      torus.rotation.y = rotY;
      return torus;
    };
    this.seamGroup.add(ring(0, 0));
    this.seamGroup.add(ring(Math.PI / 2, 0));
    this.seamGroup.add(ring(0, Math.PI / 2));
    this.mesh.add(this.seamGroup);

    scene.add(this.mesh);

    const bodyDesc = physics.RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(spawn.x, spawn.y, spawn.z)
      .setLinearDamping(BALL_LINEAR_DAMPING)
      .setAngularDamping(0.2)
      .setCcdEnabled(true); // fast shots must not tunnel through the rim/backboard
    this.body = physics.world.createRigidBody(bodyDesc);

    const colliderDesc = physics.RAPIER.ColliderDesc.ball(radius)
      .setMass(CD.ball.mass)
      .setRestitution(PhysicsMaterials.ball.restitution)
      .setFriction(PhysicsMaterials.ball.friction)
      .setCollisionGroups(
        interactionGroups(
          CollisionGroup.Ball,
          CollisionGroup.Court | CollisionGroup.Rim | CollisionGroup.Backboard | CollisionGroup.Player,
        ),
      )
      .setActiveEvents(physics.RAPIER.ActiveEvents.COLLISION_EVENTS);
    physics.world.createCollider(colliderDesc, this.body);
  }

  /** Copy the physics transform onto the render mesh. Call after each physics step. */
  syncFromPhysics(): void {
    const t = this.body.translation();
    const r = this.body.rotation();
    this.mesh.position.set(t.x, t.y, t.z);
    this.mesh.quaternion.set(r.x, r.y, r.z, r.w);
  }

  get position(): THREE.Vector3 {
    const t = this.body.translation();
    return new THREE.Vector3(t.x, t.y, t.z);
  }

  get linearVelocity(): THREE.Vector3 {
    const v = this.body.linvel();
    return new THREE.Vector3(v.x, v.y, v.z);
  }

  setKinematicHeld(position: THREE.Vector3): void {
    this.body.setBodyType(2 /* kinematicPositionBased */, true);
    this.body.setNextKinematicTranslation(position);
  }

  release(velocity: THREE.Vector3, angularVelocity: THREE.Vector3): void {
    this.body.setBodyType(0 /* dynamic */, true);
    this.body.setLinvel(velocity, true);
    this.body.setAngvel(angularVelocity, true);
  }
}
