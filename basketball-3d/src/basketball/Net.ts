import * as THREE from 'three';
import { CourtDimensions as CD } from './CourtDimensions';

/**
 * Phase 1 net: a static cosmetic mesh so the hoop reads correctly on
 * screen. Phase 2 replaces this with a small Verlet/PBD cloth sim (see
 * spec section 7) driven by ball contact - the render mesh here is
 * intentionally built the same way (radial strands + horizontal rings)
 * so that swap only has to touch vertex positions, not topology.
 */
export class Net {
  readonly group: THREE.Group;
  private readonly strandPositions: THREE.BufferAttribute;
  private readonly strandCount = 12;
  private readonly ringCount = 6;

  constructor(scene: THREE.Scene, center: THREE.Vector3) {
    this.group = new THREE.Group();
    this.group.position.copy(center);

    const topRadius = CD.hoop.rimRadius;
    const bottomRadius = topRadius * 0.55;
    const height = CD.hoop.netHeight;

    const points: number[] = [];
    for (let i = 0; i < this.strandCount; i++) {
      const a = (i / this.strandCount) * Math.PI * 2;
      for (let r = 0; r <= this.ringCount; r++) {
        const t = r / this.ringCount;
        const radius = THREE.MathUtils.lerp(topRadius, bottomRadius, t);
        const sway = Math.sin(t * Math.PI) * topRadius * 0.05;
        points.push(Math.cos(a) * (radius + sway), -height * t, Math.sin(a) * (radius + sway));
      }
    }

    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(points);
    this.strandPositions = new THREE.BufferAttribute(positions, 3);
    geometry.setAttribute('position', this.strandPositions);

    const indices: number[] = [];
    const stride = this.ringCount + 1;
    for (let i = 0; i < this.strandCount; i++) {
      for (let r = 0; r < this.ringCount; r++) {
        indices.push(i * stride + r, i * stride + r + 1);
      }
    }
    // horizontal connecting rings for a woven look
    for (let r = 1; r < this.ringCount; r++) {
      for (let i = 0; i < this.strandCount; i++) {
        const a = i * stride + r;
        const b = ((i + 1) % this.strandCount) * stride + r;
        indices.push(a, b);
      }
    }
    geometry.setIndex(indices);

    const material = new THREE.LineBasicMaterial({ color: 0xf2f2f2, transparent: true, opacity: 0.9 });
    const lines = new THREE.LineSegments(geometry, material);
    this.group.add(lines);

    scene.add(this.group);
  }
}
