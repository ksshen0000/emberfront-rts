import { SIZE, type Point } from "./config";
// Static occupancy and clearance share the same authority as building placement.
export class Navigation {
  cells = new Uint8Array(SIZE * SIZE);
  /** Static terrain blocking (water, cliffs) that every rebuild starts from. */
  terrain = new Uint8Array(SIZE * SIZE);
  version = 0;
  index(x: number, z: number) {
    return z * SIZE + x;
  }
  blocked(x: number, z: number) {
    return (
      x < 0 || z < 0 || x >= SIZE || z >= SIZE || !!this.cells[this.index(x, z)]
    );
  }
  canStand(x: number, z: number, r = 0.35) {
    for (let a = Math.floor(x - r); a <= Math.floor(x + r); a++)
      for (let b = Math.floor(z - r); b <= Math.floor(z + r); b++)
        if (this.blocked(a, b)) return false;
    return true;
  }
  segment(a: Point, b: Point) {
    const n = Math.max(1, Math.ceil(Math.hypot(a.x - b.x, a.z - b.z) / 0.2));
    for (let i = 1; i <= n; i++)
      if (
        !this.canStand(a.x + ((b.x - a.x) * i) / n, a.z + ((b.z - a.z) * i) / n)
      )
        return false;
    return true;
  }
  occupy(p: Point, size: number) {
    for (let x = Math.floor(p.x - size / 2); x < Math.ceil(p.x + size / 2); x++)
      for (
        let z = Math.floor(p.z - size / 2);
        z < Math.ceil(p.z + size / 2);
        z++
      )
        if (x >= 0 && z >= 0 && x < SIZE && z < SIZE)
          this.cells[this.index(x, z)] = 1;
  }
  nearest(p: Point, limit = 10): Point | null {
    for (let r = 0; r <= limit; r++)
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const q = {
            x: Math.floor(p.x) + dx + 0.5,
            z: Math.floor(p.z) + dz + 0.5,
          };
          if (this.canStand(q.x, q.z)) return q;
        }
    return null;
  }
  path(start: Point, end: Point): Point[] | null {
    const goal = this.nearest(end);
    if (!goal) return null;
    if (this.segment(start, goal)) return [goal];
    const sx = Math.floor(start.x),
      sz = Math.floor(start.z),
      gx = Math.floor(goal.x),
      gz = Math.floor(goal.z);
    const startId = this.index(sx, sz),
      goalId = this.index(gx, gz);
    const scores = new Float64Array(SIZE * SIZE).fill(Infinity),
      prev = new Int32Array(SIZE * SIZE).fill(-1),
      closed = new Uint8Array(SIZE * SIZE);
    const heap: { id: number; f: number }[] = [];
    const push = (id: number, f: number) => {
      let i = heap.length;
      heap.push({ id, f });
      while (i) {
        const p = (i - 1) >> 1;
        if (heap[p].f <= f) break;
        heap[i] = heap[p];
        i = p;
      }
      heap[i] = { id, f };
    };
    const pop = () => {
      const first = heap[0],
        last = heap.pop()!;
      if (heap.length) {
        let i = 0;
        while (i * 2 + 1 < heap.length) {
          let c = i * 2 + 1;
          if (c + 1 < heap.length && heap[c + 1].f < heap[c].f) c++;
          if (heap[c].f >= last.f) break;
          heap[i] = heap[c];
          i = c;
        }
        heap[i] = last;
      }
      return first;
    };
    const heuristic = (x: number, z: number) => {
      const dx = Math.abs(x - gx),
        dz = Math.abs(z - gz);
      return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
    };
    scores[startId] = 0;
    push(startId, heuristic(sx, sz));
    let count = 0;
    while (heap.length && count++ < SIZE * SIZE) {
      const { id } = pop();
      if (closed[id]) continue;
      closed[id] = 1;
      if (id === goalId) {
        const result: Point[] = [];
        let at = id;
        while (at !== startId) {
          result.push({ x: (at % SIZE) + 0.5, z: Math.floor(at / SIZE) + 0.5 });
          at = prev[at];
          if (at < 0) return null;
        }
        return result.reverse();
      }
      const x = id % SIZE,
        z = Math.floor(id / SIZE);
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dz) continue;
          const nx = x + dx,
            nz = z + dz;
          if (
            this.blocked(nx, nz) ||
            (dx && dz && (this.blocked(x + dx, z) || this.blocked(x, z + dz)))
          )
            continue;
          const ni = this.index(nx, nz),
            next = scores[id] + (dx && dz ? Math.SQRT2 : 1);
          if (next >= scores[ni]) continue;
          scores[ni] = next;
          prev[ni] = id;
          push(ni, next + heuristic(nx, nz));
        }
    }
    return null;
  }
}
