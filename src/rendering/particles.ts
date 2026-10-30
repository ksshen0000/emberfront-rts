import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import "@babylonjs/core/Meshes/thinInstanceMesh";

// Per-particle floats: start x/y/z, velocity (or arc end) x/y/z, age, life,
// size, gravity (or arc height), mode.
const STRIDE = 11,
  BALLISTIC = 0,
  ARC = 1;

/**
 * A fixed-size particle pool drawn as thin instances of one mesh: one draw
 * call per pool, no meshes created or disposed while effects play, and when
 * the pool is full new particles are simply dropped.
 */
export class ParticlePool {
  private data: Float32Array;
  private matrices: Float32Array;
  count = 0;
  constructor(
    public mesh: Mesh,
    public max: number,
  ) {
    this.data = new Float32Array(max * STRIDE);
    this.matrices = new Float32Array(max * 16);
    mesh.thinInstanceSetBuffer("matrix", this.matrices, 16, false);
    mesh.thinInstanceCount = 0;
    // Particles roam the whole map; skip per-frame bounding updates and culling.
    mesh.alwaysSelectAsActiveMesh = true;
    mesh.doNotSyncBoundingInfo = true;
    mesh.isPickable = false;
  }
  private add(values: number[]) {
    if (this.count >= this.max) return false;
    this.data.set(values, this.count++ * STRIDE);
    return true;
  }
  /** A particle thrown with a velocity, falling (or rising) under gravity. */
  throw(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    life: number,
    size: number,
    gravity: number,
  ) {
    return this.add([x, y, z, vx, vy, vz, 0, life, size, gravity, BALLISTIC]);
  }
  /** A projectile lobbed from one point to another, pointing along its flight. */
  lob(
    from: { x: number; y: number; z: number },
    to: { x: number; y: number; z: number },
    life: number,
    height: number,
  ) {
    return this.add([
      from.x,
      from.y,
      from.z,
      to.x,
      to.y,
      to.z,
      0,
      life,
      1,
      height,
      ARC,
    ]);
  }
  clear() {
    this.count = 0;
    this.mesh.thinInstanceCount = 0;
  }
  update(dt: number) {
    if (!this.count) return;
    const d = this.data,
      m = this.matrices;
    for (let i = 0; i < this.count;) {
      const o = i * STRIDE,
        age = (d[o + 6] += dt);
      if (age >= d[o + 7]) {
        // Swap the last live particle into this slot; order does not matter.
        this.count--;
        d.copyWithin(o, this.count * STRIDE, this.count * STRIDE + STRIDE);
        continue;
      }
      const t = age / d[o + 7],
        k = i * 16;
      if (d[o + 10] === BALLISTIC) {
        // Uniform scale that shrinks to nothing over the particle's life.
        const s = d[o + 8] * (1 - t * t);
        m[k] = m[k + 5] = m[k + 10] = s;
        m[k + 1] = m[k + 2] = m[k + 4] = m[k + 6] = m[k + 8] = m[k + 9] = 0;
        m[k + 12] = d[o] + d[o + 3] * age;
        m[k + 13] = d[o + 1] + d[o + 4] * age - 0.5 * d[o + 9] * age * age;
        m[k + 14] = d[o + 2] + d[o + 5] * age;
      } else {
        const dx = d[o + 3] - d[o],
          dy = d[o + 4] - d[o + 1],
          dz = d[o + 5] - d[o + 2],
          h = d[o + 9],
          lift = Math.sin(t * Math.PI) * h;
        // Flight direction is the derivative of the lobbed path.
        let fx = dx,
          fy = dy + Math.cos(t * Math.PI) * Math.PI * h,
          fz = dz;
        const fl = Math.hypot(fx, fy, fz) || 1;
        fx /= fl;
        fy /= fl;
        fz /= fl;
        let rx = fz,
          rz = -fx;
        const rl = Math.hypot(rx, rz);
        if (rl < 1e-4) {
          rx = 1;
          rz = 0;
        } else {
          rx /= rl;
          rz /= rl;
        }
        // Rows: local x → right, y → up, z → flight direction.
        m[k] = rx;
        m[k + 1] = 0;
        m[k + 2] = rz;
        m[k + 4] = fy * rz;
        m[k + 5] = fz * rx - fx * rz;
        m[k + 6] = -fy * rx;
        m[k + 8] = fx;
        m[k + 9] = fy;
        m[k + 10] = fz;
        m[k + 12] = d[o] + dx * t;
        m[k + 13] = d[o + 1] + dy * t + lift;
        m[k + 14] = d[o + 2] + dz * t;
      }
      m[k + 3] = m[k + 7] = m[k + 11] = 0;
      m[k + 15] = 1;
      i++;
    }
    this.mesh.thinInstanceCount = this.count;
    this.mesh.thinInstanceBufferUpdated("matrix");
  }
}
