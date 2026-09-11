import * as THREE from 'three';
import type { PhysicsWorld } from '@/physics/PhysicsWorld';
import { PhysicsMaterials } from '@/physics/MaterialProperties';
import { CollisionGroup, interactionGroups } from '@/physics/CollisionLayers';
import { CourtDimensions as CD } from './CourtDimensions';

/**
 * A real collidable panel, not set dressing: bank shots and hard passes
 * both have to bounce off this collider's face.
 */
export class Backboard {
  readonly mesh: THREE.Mesh;
  /** Outward-facing normal of the shootable face, in world space. */
  readonly faceNormal: THREE.Vector3;

  constructor(scene: THREE.Scene, physics: PhysicsWorld, side: 1 | -1) {
    const { backboardWidth, backboardHeight, backboardThickness, backboardBottomHeight, backboardDistanceFromBaseline } =
      CD.hoop;

    const centerX = side * (CD.length / 2 - backboardDistanceFromBaseline);
    const centerY = backboardBottomHeight + backboardHeight / 2;
    this.faceNormal = new THREE.Vector3(-side, 0, 0);

    const geometry = new THREE.BoxGeometry(backboardThickness, backboardHeight, backboardWidth);
    const material = new THREE.MeshPhysicalMaterial({
      color: 0xdfeaf2,
      transparent: true,
      opacity: 0.35,
      roughness: 0.05,
      metalness: 0,
      transmission: 0.6,
      thickness: 0.05,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.set(centerX, centerY, 0);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);

    // shooter's-square accent, matches regulation markings (a white outline
    // rectangle centered just above the rim, per spec section 15)
    const squareWidth = 24 * 0.0254;
    const squareHeight = 18 * 0.0254;
    const squareGeo = new THREE.EdgesGeometry(new THREE.BoxGeometry(0.005, squareHeight, squareWidth));
    const squareMat = new THREE.LineBasicMaterial({ color: 0xf4f6fb });
    const square = new THREE.LineSegments(squareGeo, squareMat);
    square.position.set(centerX - side * (backboardThickness / 2 + 0.003), CD.hoop.rimHeight + 0.05, 0);
    scene.add(square);

    // mounting hardware: small bolt-like studs around the board's frame,
    // where a real backboard bolts to its support arm
    const boltMaterial = new THREE.MeshStandardMaterial({ color: 0x3a3f4a, roughness: 0.4, metalness: 0.7 });
    const boltGeo = new THREE.CylinderGeometry(0.018, 0.018, 0.02, 8);
    const boltOffsets: Array<[number, number]> = [
      [backboardWidth / 2 - 0.15, backboardHeight / 2 - 0.15],
      [-(backboardWidth / 2 - 0.15), backboardHeight / 2 - 0.15],
      [backboardWidth / 2 - 0.15, -(backboardHeight / 2 - 0.15)],
      [-(backboardWidth / 2 - 0.15), -(backboardHeight / 2 - 0.15)],
    ];
    for (const [dz, dy] of boltOffsets) {
      const bolt = new THREE.Mesh(boltGeo, boltMaterial);
      bolt.rotation.x = Math.PI / 2;
      bolt.position.set(centerX - side * (backboardThickness / 2 + 0.01), centerY + dy, dz);
      bolt.castShadow = true;
      scene.add(bolt);
    }

    const bodyDesc = physics.RAPIER.RigidBodyDesc.fixed().setTranslation(centerX, centerY, 0);
    const body = physics.world.createRigidBody(bodyDesc);
    const colliderDesc = physics.RAPIER.ColliderDesc.cuboid(backboardThickness / 2, backboardHeight / 2, backboardWidth / 2)
      .setRestitution(PhysicsMaterials.backboard.restitution)
      .setFriction(PhysicsMaterials.backboard.friction)
      .setCollisionGroups(interactionGroups(CollisionGroup.Backboard, CollisionGroup.Ball));
    physics.world.createCollider(colliderDesc, body);
  }
}
