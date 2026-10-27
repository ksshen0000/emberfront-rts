import { describe, it, expect } from "vitest";
import { World, VISIBLE, EXPLORED, type Entity } from "../src/simulation/world";
import { Navigation } from "../src/simulation/navigation";
import {
  FORDS,
  PLATEAUS,
  heightAt,
  layout,
  mirror,
  riverPoint,
} from "../src/simulation/terrain";
import {
  STEP,
  SPECS,
  START,
  GOLD_MINE,
  QUEUE_MAX,
  distance,
  isUnit,
} from "../src/simulation/config";
const advance = (w: World, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / STEP); i++) w.step();
};
const fresh = () => {
  const w = new World();
  w.aiEnabled = false;
  return w;
};
const base = (w: World, owner = 0) =>
  w.own(owner as 0 | 1).find((e) => e.kind === "base")!;
const worker = (w: World) => w.own(0).find((e) => e.kind === "worker")!;

describe("economy and lifecycle", () => {
  it("starts with specified economy and freezes when paused", () => {
    const w = fresh();
    expect(w.population(0)).toEqual({ used: 5, reserved: 0, cap: 12 });
    w.paused = true;
    advance(w, 10);
    expect(w.time).toBe(0);
    expect(w.players[0]).toEqual(START);
  });
  it("collects and deposits gold; no credit while carried", () => {
    const w = fresh(),
      u = worker(w),
      mine = [...w.entities.values()].find((e) => e.kind === "gold")!;
    w.submit({ player: 0, ids: [u.id], type: "gather", target: mine.id });
    advance(w, 80);
    expect(w.players[0].gold).toBeGreaterThanOrEqual(530);
    expect(w.players[0].gold - 500 + u.carry + mine.amount).toBe(GOLD_MINE);
    w.assertInvariants();
  });
  it("queues and cancels atomically without double refunds", () => {
    const w = fresh(),
      b = base(w),
      price = SPECS.worker.gold;
    w.players[0].gold = 1000;
    for (let i = 0; i <= QUEUE_MAX; i++)
      w.submit({ player: 0, ids: [b.id], type: "train", kind: "worker" });
    w.step();
    expect(b.queue).toHaveLength(QUEUE_MAX);
    expect(w.players[0].gold).toBe(1000 - QUEUE_MAX * price);
    expect(w.population(0).reserved).toBe(QUEUE_MAX);
    w.submit({ player: 0, ids: [b.id], type: "cancel", index: 3 });
    w.step();
    expect(w.players[0].gold).toBe(1000 - (QUEUE_MAX - 1) * price);
    advance(w, (QUEUE_MAX - 1) * SPECS.worker.time + 5);
    expect(w.population(0)).toEqual({
      used: 5 + QUEUE_MAX - 1,
      reserved: 0,
      cap: 12,
    });
    w.assertInvariants();
  });
  it("does not produce beyond capacity when farm is lost", () => {
    const w = fresh(),
      b = base(w);
    for (let i = 0; i < 5; i++) w.spawn("soldier", 0, 50 + i, 30);
    const farm = w.spawn("farm", 0, 34.5, 20.5);
    w.rebuild();
    w.submit({ player: 0, ids: [b.id], type: "train", kind: "worker" });
    w.step();
    w.remove(farm);
    advance(w, SPECS.worker.time + 2);
    expect(b.queue).toHaveLength(1);
    expect(w.population(0).used).toBe(15);
    w.spawn("farm", 0, 34.5, 20.5);
    w.rebuild();
    w.step();
    expect(b.queue).toHaveLength(0);
    expect(w.population(0).used).toBe(16);
  });
  it("cancels a foundation once and frees occupancy", () => {
    const w = fresh(),
      u = worker(w);
    w.submit({
      player: 0,
      ids: [u.id],
      type: "build",
      kind: "farm",
      point: { x: 34.5, z: 24.5 },
    });
    w.step();
    const b = w.own(0).find((e) => e.kind === "farm")!;
    expect(b).toBeDefined();
    expect(w.nav.canStand(b.x, b.z)).toBe(false);
    const { gold, wood } = SPECS.farm;
    expect(w.players[0]).toEqual({
      gold: START.gold - gold,
      wood: START.wood - wood,
    });
    w.submit({ player: 0, ids: [b.id], type: "cancel" });
    w.submit({ player: 0, ids: [b.id], type: "cancel" });
    w.step();
    expect(w.players[0]).toEqual({
      gold: START.gold - gold + Math.floor(gold * 0.75),
      wood: START.wood - wood + Math.floor(wood * 0.75),
    });
    expect(w.nav.canStand(b.x, b.z)).toBe(true);
  });
  it("finishes construction only with a worker present", () => {
    const w = fresh(),
      u = worker(w);
    w.submit({
      player: 0,
      ids: [u.id],
      type: "build",
      kind: "barracks",
      point: { x: 34.5, z: 24.5 },
    });
    advance(w, SPECS.barracks.time + 20);
    const b = w.own(0).find((e) => e.kind === "barracks")!;
    expect(b.progress).toBe(1);
    expect(b.hp).toBeCloseTo(SPECS.barracks.hp);
    w.assertInvariants();
  });
  it("releases reservation and does not refund destroyed production", () => {
    const w = fresh(),
      b = w.spawn("barracks", 0, 34.5, 24.5);
    w.rebuild();
    w.submit({ player: 0, ids: [b.id], type: "train", kind: "soldier" });
    w.step();
    const gold = w.players[0].gold;
    w.remove(b);
    expect(w.population(0).reserved).toBe(0);
    expect(w.players[0].gold).toBe(gold);
  });
  it("simultaneous lethal hits allow mutual destruction and draw", () => {
    const w = fresh();
    const a = base(w),
      b = base(w, 1);
    a.hp = 1;
    b.hp = 1;
    w.spawn("worker", 1, a.x + 3.8, a.z);
    w.spawn("worker", 0, b.x + 3.8, b.z);
    const attackers = [...w.entities.values()].filter(
      (e) => e.kind === "worker" && e.x > 25,
    );
    for (const e of attackers) {
      const target = e.owner === 0 ? b : a;
      w.setOrder(e, { type: "attack", target: target.id });
    }
    w.step();
    expect(w.result).toBe("draw");
    const t = w.time;
    advance(w, 10);
    expect(w.time).toBe(t);
  });
});
describe("navigation", () => {
  it("routes around hard obstacles without diagonal corner cutting", () => {
    const n = new Navigation();
    n.occupy({ x: 10, z: 10 }, 6);
    const start = { x: 5.5, z: 10.5 },
      end = { x: 16.5, z: 10.5 },
      path = n.path(start, end)!;
    expect(path.length).toBeGreaterThan(1);
    let p = start;
    for (const next of path) {
      expect(n.segment(p, next)).toBe(true);
      p = next;
    }
    expect(distance(p, end)).toBeLessThan(1);
  });
  it("returns null for a sealed island", () => {
    const n = new Navigation();
    for (let x = 8; x <= 12; x++) {
      n.cells[n.index(x, 8)] = 1;
      n.cells[n.index(x, 12)] = 1;
    }
    for (let z = 8; z <= 12; z++) {
      n.cells[n.index(8, z)] = 1;
      n.cells[n.index(12, z)] = 1;
    }
    expect(n.path({ x: 5.5, z: 5.5 }, { x: 10.5, z: 10.5 })).toBeNull();
  });
  it("moves 20 units to distinct open-space destinations", () => {
    const w = fresh();
    const units: Entity[] = [];
    for (let i = 0; i < 20; i++)
      units.push(
        w.spawn("soldier", 0, 50 + (i % 5) * 1.2, 30 + Math.floor(i / 5) * 1.2),
      );
    w.submit({
      player: 0,
      ids: units.map((e) => e.id),
      type: "move",
      point: { x: 76, z: 32 },
    });
    advance(w, 30);
    expect(units.filter((e) => distance(e, { x: 76, z: 32 }) < 5)).toHaveLength(
      20,
    );
    w.assertInvariants();
  });
  it("invalidates paths when a building appears", () => {
    const w = fresh(),
      u = w.spawn("soldier", 0, 50.5, 30.5);
    w.submit({
      player: 0,
      ids: [u.id],
      type: "move",
      point: { x: 75.5, z: 30.5 },
    });
    advance(w, 1);
    w.spawn("barracks", 0, 60.5, 30.5);
    w.rebuild();
    advance(w, 20);
    expect(distance(u, { x: 75.5, z: 30.5 })).toBeLessThan(1);
    w.assertInvariants();
  });
});
describe("AI and long-running simulation", () => {
  it("develops using real resources and builds an attacking army", () => {
    const w = new World();
    for (let i = 0; i < 6000; i++) {
      w.step();
      if (i % 100 === 0) w.assertInvariants();
    }
    const all = w.own(1);
    expect(all.some((e) => e.kind === "barracks" && e.progress === 1)).toBe(
      true,
    );
    expect(
      all.filter((e) => e.kind === "soldier" || e.kind === "archer").length,
    ).toBeGreaterThanOrEqual(6);
    expect(all.some((e) => isUnit(e.kind) && e.order.type === "assault")).toBe(
      true,
    );
  }, 20000);
});

describe("fog of war", () => {
  const fogAt = (w: World, owner: 0 | 1, x: number, z: number) =>
    w.fogAt(owner, x, z);
  it("starts with each side seeing only its own settlement", () => {
    const w = fresh(),
      enemy = base(w, 1);
    expect(fogAt(w, 0, 24, 24) & VISIBLE).toBeTruthy();
    expect(w.sees(0, enemy)).toBe(false);
    expect(fogAt(w, 0, enemy.x, enemy.z)).toBe(0);
    expect(w.sees(1, base(w, 0))).toBe(false);
    expect(w.sees(0, base(w, 0))).toBe(true);
  });
  it("reveals around a scout, keeps the area explored after it leaves", () => {
    const w = fresh(),
      enemy = base(w, 1),
      scout = w.spawn("archer", 0, enemy.x - 8, enemy.z - 8);
    w.updateFog();
    expect(w.sees(0, enemy)).toBe(true);
    w.remove(scout);
    w.updateFog();
    expect(w.sees(0, enemy)).toBe(false);
    expect(fogAt(w, 0, enemy.x, enemy.z) & EXPLORED).toBeTruthy();
    expect(fogAt(w, 0, enemy.x, enemy.z) & VISIBLE).toBeFalsy();
  });
  it("updates while units move and respects each unit's sight radius", () => {
    const w = fresh(),
      u = worker(w),
      r = SPECS.worker.sight!;
    w.submit({ player: 0, ids: [u.id], type: "move", point: { x: 76, z: 32 } });
    advance(w, 40);
    expect(distance(u, { x: 76, z: 32 })).toBeLessThan(2);
    expect(fogAt(w, 0, u.x + r - 1.5, u.z) & VISIBLE).toBeTruthy();
    expect(fogAt(w, 0, u.x + r + 1.5, u.z) & VISIBLE).toBeFalsy();
    // The start position stays explored but is no longer lit by this worker alone.
    expect(fogAt(w, 0, 64, 40) & VISIBLE).toBeFalsy();
  });
  it("large footprints count as seen when any edge cell is visible", () => {
    const w = fresh(),
      enemy = base(w, 1),
      edge = SPECS.base.size / 2;
    // Sight 9 from 11 units away reaches the near edge of the 6x6 base only.
    w.spawn("worker", 0, enemy.x - edge - 8, enemy.z);
    w.updateFog();
    expect(fogAt(w, 0, enemy.x, enemy.z) & VISIBLE).toBeFalsy();
    expect(w.sees(0, enemy)).toBe(true);
  });
});

describe("terrain", () => {
  it("the main plateau is walled by cliffs and reached by its ramps", () => {
    const w = fresh(),
      p = PLATEAUS[0];
    // Rim cells facing the map corner are cliff faces.
    for (const a of [200, 225, 250].map((d) => (d * Math.PI) / 180)) {
      const x = p.x + Math.cos(a) * (p.r + 0.2),
        z = p.z + Math.sin(a) * (p.r + 0.2);
      expect(w.nav.canStand(x, z)).toBe(false);
    }
    // The walk down never jumps a cliff: consecutive steps change height gently.
    const path = w.nav.path({ x: 28.5, z: 30.5 }, { x: 60, z: 20 })!;
    expect(path).not.toBeNull();
    let prev = heightAt(28.5, 30.5);
    for (const q of path) {
      const h = heightAt(q.x, q.z);
      expect(Math.abs(h - prev)).toBeLessThan(0.6);
      prev = h;
    }
    expect(prev).toBeLessThan(0.6);
  });
  it("the river can only be crossed at the fords", () => {
    const w = fresh();
    // Along the channel, only the fords are walkable.
    for (let i = 3; i <= 97; i++) {
      const p = riverPoint(i / 100),
        nearFord = FORDS.some((f) => Math.hypot(p.x - f.x, p.z - f.z) < 3),
        farFromFord = FORDS.every((f) => Math.hypot(p.x - f.x, p.z - f.z) > 7);
      if (nearFord) expect(w.nav.canStand(p.x, p.z)).toBe(true);
      if (farFromFord) expect(w.nav.canStand(p.x, p.z)).toBe(false);
    }
    // With the three fords closed, the two halves of the map are cut apart.
    expect(
      w.nav.path({ x: 28.5, z: 30.5 }, { x: 99.5, z: 97.5 }),
    ).not.toBeNull();
    for (const f of FORDS)
      for (let dz = -8; dz <= 8; dz++)
        for (let dx = -8; dx <= 8; dx++)
          if (Math.hypot(dx, dz) <= 8)
            w.nav.cells[
              w.nav.index(Math.floor(f.x) + dx, Math.floor(f.z) + dz)
            ] = 1;
    w.nav.version++;
    expect(w.nav.path({ x: 28.5, z: 30.5 }, { x: 99.5, z: 97.5 })).toBeNull();
  });
  it("buildings need dry, level ground", () => {
    const w = fresh(),
      p = PLATEAUS[0],
      ramp = p.ramps[0],
      onRamp = w.snap("farm", {
        x: p.x + Math.cos(ramp) * (p.r + 2),
        z: p.z + Math.sin(ramp) * (p.r + 2),
      });
    expect(w.placement("farm", onRamp)).toMatch(/steep|Blocked/);
    expect(w.placement("farm", w.snap("farm", FORDS[1]))).toMatch(
      /steep|wet|Blocked/,
    );
    expect(w.placement("farm", { x: 34.5, z: 24.5 })).toBeNull();
  });
  it("refuses a building that would wall the strongholds off from each other", () => {
    const w = fresh();
    // A wall right across the map with a single three-cell gap at x 90-92.
    for (let x = 0; x < 128; x++)
      if (x < 90 || x > 92) w.nav.cells[w.nav.index(x, 60)] = 1;
      else w.nav.cells[w.nav.index(x, 60)] = 0;
    expect(w.seals({ x: 91.5, z: 60.5 }, 3)).toBe(true);
    expect(w.seals({ x: 70.5, z: 30.5 }, 3)).toBe(false);
  });
  it("is the same map from both sides", () => {
    const key = (p: { kind: string; x: number; z: number }) =>
      `${p.kind}:${p.x}:${p.z}`;
    const all = layout(),
      keys = new Set(all.map(key));
    for (const p of all)
      expect(keys.has(key({ ...p, ...mirror(p) }))).toBe(true);
    for (let i = 0; i < 200; i++) {
      const x = (i * 37.3) % 128,
        z = (i * 71.9) % 128;
      expect(heightAt(x, z)).toBeCloseTo(heightAt(128 - x, 128 - z), 5);
    }
    // Each side owns a main, a natural and a contested gold mine.
    expect(all.filter((p) => p.kind === "gold")).toHaveLength(6);
  });
});
