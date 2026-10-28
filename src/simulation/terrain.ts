import { SIZE, type Point } from "./config";

// "Emerald Marches": two raised main bases on opposite corners, each with two
// ramps (in the spirit of Warcraft III's Lost Temple and Twisted Meadows), a
// river between two lakes crossed at three shallow fords, and AoE2-style
// woodlines that split the lowland into lanes. The map is point-symmetric
// around its centre so both sides are identical. Heights are analytic, so the
// simulation (blocking, placement) and the renderer (mesh) read the same map.

export const PLATEAU_HEIGHT = 1.6,
  MID_HEIGHT = 0.8,
  LOWLAND = 0.25,
  WATER_LEVEL = -0.12,
  // Below this the ground is deep water; fords stay above it.
  DEEP_WATER = -0.45,
  // Steepest walkable slope (rise per unit); ramps stay well below it.
  MAX_SLOPE = 0.5;

/** Point reflection through the map centre: the other player's side. */
export const mirror = (p: Point): Point => ({ x: SIZE - p.x, z: SIZE - p.z });

const deg = Math.PI / 180;
interface Plateau {
  x: number;
  z: number;
  r: number;
  /** Rise above the lowland. */
  h: number;
  ramps: number[];
  phase: number;
}
const halfPlateaus: Plateau[] = [
  // Main base.
  {
    x: 24,
    z: 24,
    r: 17,
    h: PLATEAU_HEIGHT,
    ramps: [8 * deg, 82 * deg],
    phase: 0,
  },
  // Overlook: a low hill astride the road to the centre ford. It splits the
  // approach into two side gaps and a ramp path over the top, and its crown
  // sees the ford while lowland units cannot see up onto it.
  {
    x: 46,
    z: 46,
    r: 5.5,
    h: MID_HEIGHT,
    ramps: [225 * deg, 45 * deg],
    phase: 1,
  },
  // Hill expansion: a gold mine on a mid-height shelf with a single ramp
  // facing home, easy to hold but slow to reinforce.
  { x: 19, z: 73, r: 7.5, h: MID_HEIGHT, ramps: [290 * deg], phase: 2 },
];
export const PLATEAUS: Plateau[] = [
  ...halfPlateaus,
  ...halfPlateaus.map((p) => ({
    ...p,
    ...mirror(p),
    ramps: p.ramps.map((a) => a + Math.PI),
    phase: p.phase + Math.PI,
  })),
];
// River centreline from the north-west lake to the south-east lake.
const RIVER_A = { x: 18, z: 110 },
  RIVER_B = { x: 110, z: 18 },
  RIVER_HALF_WIDTH = 4,
  LAKES = [
    { x: 16, z: 112, r: 10 },
    { x: 112, z: 16, r: 10 },
  ];
/** Shallow crossings, as positions along the river (0 = north-west end). */
export const FORDS = [0.22, 0.5, 0.78].map((t) => riverPoint(t));

const smoothstep = (a: number, b: number, v: number) => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const angleDiff = (a: number, b: number) =>
  Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

/** Point on the river centreline; the meander is odd around the middle so the river stays symmetric. */
export function riverPoint(t: number): Point {
  const dx = RIVER_B.x - RIVER_A.x,
    dz = RIVER_B.z - RIVER_A.z,
    len = Math.hypot(dx, dz),
    meander = 3.2 * Math.sin(2 * Math.PI * 1.5 * (t - 0.5));
  return {
    x: RIVER_A.x + dx * t + (-dz / len) * meander,
    z: RIVER_A.z + dz * t + (dx / len) * meander,
  };
}
// Sampled centreline for distance queries.
const RIVER = Array.from({ length: 97 }, (_, i) => riverPoint(i / 96));
function riverDistance(x: number, z: number) {
  // The river hugs the anti-diagonal x + z = SIZE; far from it, skip the scan.
  if (Math.abs(x + z - SIZE) / Math.SQRT2 > 12) return Infinity;
  let best = Infinity;
  for (let i = 0; i < RIVER.length - 1; i++) {
    const a = RIVER[i],
      b = RIVER[i + 1],
      vx = b.x - a.x,
      vz = b.z - a.z,
      t = Math.max(
        0,
        Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / (vx * vx + vz * vz)),
      );
    best = Math.min(best, Math.hypot(x - a.x - vx * t, z - a.z - vz * t));
  }
  return best;
}

function plateauLift(x: number, z: number) {
  let lift = 0;
  for (const p of PLATEAUS) {
    const dx = x - p.x,
      dz = z - p.z,
      d = Math.hypot(dx, dz);
    const foot = p.r + 1.5 + 3.125 * p.h;
    if (d > foot + 3) continue;
    const a = Math.atan2(dz, dx),
      // A wobbling rim reads as natural rock rather than a drawn circle.
      r =
        p.r +
        0.9 * Math.sin(3 * (a - p.phase) + 0.7) +
        0.5 * Math.sin(5 * (a - p.phase) + 2.1);
    let t = smoothstep(r + 0.9, r - 0.6, d);
    for (const ramp of p.ramps) {
      const off = angleDiff(a, ramp);
      if (off > Math.PI / 2) continue;
      const lateral = d * Math.sin(off),
        up = smoothstep(foot - p.r + r, r - 1.5, d),
        // The ramp's walls fade into a gentle flare at its foot instead of
        // running as low cliffs out into the lowland.
        side = 1 - smoothstep(2.4, 3.2 + 2.4 * (1 - up), lateral);
      t = Math.max(t, side * up);
    }
    lift = Math.max(lift, t * p.h);
  }
  return lift;
}

/** Ground height in world units; 0 is the lowland. */
export function heightAt(x: number, z: number) {
  // Gentle rolling ground, symmetric under the map mirror.
  const roll = (u: number, v: number) =>
    0.07 * Math.sin(u * 0.19 + v * 0.11) +
    0.05 * Math.sin(u * 0.07 - v * 0.23 + 1.3);
  // The lowland sits a little above the water so the rolls never pool, and
  // flattens to LOWLAND at the border to meet the forest floor outside the map.
  const edge = smoothstep(0, 6, Math.min(x, z, SIZE - x, SIZE - z));
  let h =
    LOWLAND +
    edge * (roll(x, z) + roll(SIZE - x, SIZE - z)) +
    plateauLift(x, z);
  let water = smoothstep(
    RIVER_HALF_WIDTH + 1.4,
    RIVER_HALF_WIDTH - 0.8,
    riverDistance(x, z),
  );
  for (const l of LAKES)
    water = Math.max(
      water,
      smoothstep(l.r + 1.6, l.r - 1, Math.hypot(x - l.x, z - l.z)),
    );
  if (water > 0) {
    let ford = 0;
    for (const f of FORDS)
      ford = Math.max(ford, 1 - smoothstep(4, 6, Math.hypot(x - f.x, z - f.z)));
    const bed = -0.95 + (0.95 - 0.22) * ford;
    h = h * (1 - water) + bed * water;
  }
  return h;
}

let blocking: Uint8Array | null = null;
/** Static blocking per map cell (deep water, cliff faces); computed once. */
export function terrainBlocking() {
  return (blocking ??= computeBlocking());
}
function computeBlocking() {
  // Heights on a quarter-cell grid; a cell is a cliff face where the ground
  // anywhere inside it rises faster than MAX_SLOPE. Judging the steepest
  // stretch rather than the corner-to-corner drop catches low hills whose
  // rim falls across a cell boundary.
  const F = 4,
    N = SIZE * F + 1,
    fine = new Float32Array(N * N);
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) fine[j * N + i] = heightAt(i / F, j / F);
  const cells = new Uint8Array(SIZE * SIZE),
    limit = MAX_SLOPE / F;
  for (let z = 0; z < SIZE; z++)
    for (let x = 0; x < SIZE; x++) {
      let lo = Infinity,
        steep = false;
      for (let j = z * F; j <= (z + 1) * F && !steep; j++)
        for (let i = x * F; i <= (x + 1) * F; i++) {
          const h = fine[j * N + i];
          lo = Math.min(lo, h);
          if (
            (i > x * F && Math.abs(h - fine[j * N + i - 1]) > limit) ||
            (j > z * F && Math.abs(h - fine[(j - 1) * N + i]) > limit)
          ) {
            steep = true;
            break;
          }
        }
      if (steep || lo < DEEP_WATER) cells[z * SIZE + x] = 1;
    }
  return cells;
}

/** Height tier of a ground height: 0 lowland (and water), 1 hill, 2 main plateau. */
export const tierOf = (h: number) =>
  h > LOWLAND + (MID_HEIGHT + PLATEAU_HEIGHT) / 2
    ? 2
    : h > LOWLAND + MID_HEIGHT / 2
      ? 1
      : 0;
let tiers: Uint8Array | null = null;
/** Height tier per map cell, sampled at the cell centre; computed once. */
export function terrainTiers() {
  if (!tiers) {
    tiers = new Uint8Array(SIZE * SIZE);
    for (let z = 0; z < SIZE; z++)
      for (let x = 0; x < SIZE; x++)
        tiers[z * SIZE + x] = tierOf(heightAt(x + 0.5, z + 0.5));
  }
  return tiers;
}
/** Height tier under a world position (0 outside the map). */
export function tierAt(x: number, z: number) {
  const cx = Math.floor(x),
    cz = Math.floor(z);
  return cx < 0 || cz < 0 || cx >= SIZE || cz >= SIZE
    ? 0
    : terrainTiers()[cz * SIZE + cx];
}
/** Movement speed factor while wading through a ford. */
export const WADE_SPEED = 0.7;
let wet: Uint8Array | null = null;
/** Cells under shallow water, where units wade; computed once. */
export function terrainWet() {
  if (!wet) {
    wet = new Uint8Array(SIZE * SIZE);
    for (let z = 0; z < SIZE; z++)
      for (let x = 0; x < SIZE; x++)
        wet[z * SIZE + x] = heightAt(x + 0.5, z + 0.5) < WATER_LEVEL ? 1 : 0;
  }
  return wet;
}

/** Whether a square footprint is dry and level enough to build on. */
export function buildable(p: Point, size: number) {
  const s = size / 2;
  let lo = Infinity,
    hi = -Infinity;
  for (let x = p.x - s; x <= p.x + s + 1e-6; x += s)
    for (let z = p.z - s; z <= p.z + s + 1e-6; z += s) {
      const h = heightAt(x, z);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
  return lo > WATER_LEVEL + 0.05 && hi - lo < 0.35;
}

// Deterministic hash for ragged forest edges.
const hash = (x: number, z: number) => {
  let h = Math.imul((x * 73856093) ^ (z * 19349663), 0x9e3779b1);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
};

export interface Placement {
  kind: "gold" | "tree" | "rock";
  x: number;
  z: number;
}
/**
 * Neutral resources and obstacles. Built for the first player's half and
 * mirrored, so every mine and woodline has an identical twin.
 */
let cachedLayout: Placement[] | null = null;
export function layout(): Placement[] {
  return (cachedLayout ??= computeLayout());
}
function computeLayout(): Placement[] {
  const half: Placement[] = [
    { kind: "gold", x: 13, z: 23 }, // main
    { kind: "gold", x: 12, z: 56 }, // natural, below the north ramp
    { kind: "gold", x: 30, z: 84 }, // contested, by the west ford
    { kind: "gold", x: 15, z: 76 }, // hill expansion
    // Boulders narrowing the centre ford's approach.
    { kind: "rock", x: 52.5, z: 66.5 },
    { kind: "rock", x: 66.5, z: 52.5 },
  ];
  const keepOut: (Point & { r: number })[] = [
    { x: 24, z: 24, r: 7 }, // stronghold and its spawn ring
    { x: 13, z: 23, r: 4 },
    { x: 12, z: 56, r: 4.5 },
    { x: 30, z: 84, r: 4.5 },
    { x: 15, z: 76, r: 4.5 },
    ...FORDS.map((f) => ({ ...f, r: 9 })),
  ];
  // Ramp feet stay open so the bases never get sealed by trees.
  for (const p of halfPlateaus)
    for (const a of p.ramps)
      keepOut.push({
        x: p.x + Math.cos(a) * (p.r + 3),
        z: p.z + Math.sin(a) * (p.r + 3),
        r: 6,
      });
  const forest = (x: number, z: number) => {
    // Woodline behind the main base, on the plateau.
    const d = Math.hypot(x - 24, z - 24),
      a = Math.atan2(z - 24, x - 24) / deg;
    // Angles -145..-55 degrees: the side facing the map corner.
    if (d > 11.5 && d < 15.5 && a > -145 && a < -55) return 1;
    // Edge forests along the west and south borders, running into the lake
    // corners so the river can only be crossed at the fords (or by chopping).
    if ((x < 7 && z > 44) || (z < 7 && x > 44))
      return 1 - smoothstep(4, 7, Math.min(x < 7 ? x : z, 7));
    // Lane-splitting groves between the ramps and the side fords.
    for (const g of [
      { x: 38, z: 60, r: 6.5 },
      { x: 60, z: 38, r: 6.5 },
      { x: 72, z: 20, r: 5 },
    ]) {
      const gd = Math.hypot(x - g.x, z - g.z);
      if (gd < g.r) return 1 - smoothstep(g.r - 2, g.r, gd) * 0.7;
    }
    return 0;
  };
  for (let z = 1; z < SIZE; z += 2)
    for (let x = 1; x < SIZE; x += 2) {
      // Build only the first player's half; the mirror fills the rest. Cells
      // on the mirror line itself are generated from both sides and deduplicated.
      if (x + z > SIZE) continue;
      const density = forest(x, z);
      if (!density || hash(x, z) > density) continue;
      if (keepOut.some((k) => Math.hypot(x - k.x, z - k.z) < k.r)) continue;
      // Trees need dry, gentle ground (not cliffs, ramps or river banks).
      if (!buildable({ x, z }, 2)) continue;
      half.push({ kind: "tree", x, z });
    }
  const seen = new Set<string>();
  return [...half, ...half.map((p) => ({ ...p, ...mirror(p) }))].filter((p) => {
    const key = `${p.kind}:${p.x}:${p.z}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
