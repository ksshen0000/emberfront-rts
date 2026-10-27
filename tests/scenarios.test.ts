import { it, expect } from "vitest";
import { World, type Entity } from "../src/simulation/world";
import {
  distance,
  STEP,
  SPECS,
  FOOD_MAX,
  GOLD_MINE,
  isUnit,
} from "../src/simulation/config";
const advance = (w: World, seconds: number) => {
  for (let i = 0; i < seconds / STEP; i++) w.step();
};
it("100 units reach an open destination 30 units away within 60 seconds", () => {
  const w = new World();
  w.aiEnabled = false;
  const units: Entity[] = [];
  for (let i = 0; i < 100; i++)
    units.push(
      w.spawn(
        "soldier",
        0,
        45.5 + (i % 10) * 1.2,
        12.5 + Math.floor(i / 10) * 1.2,
      ),
    );
  w.submit({
    player: 0,
    ids: units.map((e) => e.id),
    type: "move",
    point: { x: 87.5, z: 19.5 },
  });
  advance(w, 60);
  expect(
    units.filter((e) => distance(e, { x: 87.5, z: 19.5 }) < 10),
  ).toHaveLength(100);
  w.assertInvariants();
}, 20000);
it("20 units pass a four-cell-wide 20-cell corridor within 30 seconds", () => {
  const w = new World();
  w.aiEnabled = false;
  // Isolated test map preserving the two bases so victory stays active.
  for (const e of [...w.entities.values()])
    if (e.kind !== "base") w.entities.delete(e.id);
  w.rebuild();
  for (let x = 50; x < 70; x++)
    for (let z = 35; z < 55; z++)
      if (z < 43 || z >= 47) w.nav.cells[w.nav.index(x, z)] = 1;
  w.nav.version++;
  const units: Entity[] = [];
  for (let i = 0; i < 20; i++)
    units.push(
      w.spawn(
        "soldier",
        0,
        43.5 + (i % 4) * 1.1,
        42.5 + Math.floor(i / 4) * 1.1,
      ),
    );
  w.submit({
    player: 0,
    ids: units.map((e) => e.id),
    type: "move",
    point: { x: 76.5, z: 45.5 },
  });
  advance(w, 30);
  expect(units.filter((e) => e.x > 70)).toHaveLength(20);
  w.assertInvariants();
}, 20000);
it("foundation progress pauses after worker interruption and can be resumed", () => {
  const w = new World();
  w.aiEnabled = false;
  const u = w.own(0).find((e) => e.kind === "worker")!;
  w.submit({
    player: 0,
    ids: [u.id],
    type: "build",
    kind: "farm",
    point: { x: 34.5, z: 24.5 },
  });
  advance(w, 8);
  const b = w.own(0).find((e) => e.kind === "farm")!;
  w.submit({ player: 0, ids: [u.id], type: "stop" });
  w.step();
  const progress = b.progress;
  advance(w, 5);
  expect(b.progress).toBe(progress);
  b.hp -= 20;
  w.submit({ player: 0, ids: [u.id], type: "resume", target: b.id });
  advance(w, SPECS.farm.time);
  expect(b.progress).toBe(1);
  expect(b.hp).toBeCloseTo(SPECS.farm.hp - 20);
});
it("30 simulated minutes retain invariants with economy, production and combat", () => {
  const w = new World();
  for (const e of w.entities.values()) if (e.kind === "base") e.hp = 1e8;
  const workers = w.own(0).filter((e) => e.kind === "worker"),
    resources = [...w.entities.values()];
  for (const [i, e] of workers.entries()) {
    const target = resources.find((r) => r.kind === (i < 2 ? "tree" : "gold"))!;
    w.submit({ player: 0, ids: [e.id], type: "gather", target: target.id });
  }
  for (let i = 0; i < 36000; i++) {
    w.step();
    if (i % 200 === 0) w.assertInvariants();
  }
  expect(w.time).toBe(1800);
  expect(w.result).toBeNull();
  expect(w.population(1).used).toBeLessThanOrEqual(FOOD_MAX);
  expect(w.players[0].gold).toBeGreaterThan(500);
}, 120000);
it("same commands and steps reproduce the same world state", () => {
  const a = new World(),
    b = new World();
  for (const w of [a, b]) {
    const workers = w.own(0).filter((e) => e.kind === "worker");
    w.submit({
      player: 0,
      ids: workers.map((e) => e.id),
      type: "move",
      point: { x: 40, z: 30 },
    });
    advance(w, 60);
  }
  const snapshot = (w: World) =>
    JSON.stringify({
      players: w.players,
      entities: [...w.entities.values()].map((e) => ({
        id: e.id,
        x: e.x,
        z: e.z,
        hp: e.hp,
        queue: e.queue,
        order: e.order,
      })),
    });
  expect(snapshot(a)).toBe(snapshot(b));
});
it("depleted gold mine is removed and the worker moves on to the next mine", () => {
  const w = new World();
  w.aiEnabled = false;
  const home = w.own(0).find((e) => e.kind === "base")!,
    mines = [...w.entities.values()]
      .filter((e) => e.kind === "gold")
      .sort((a, b) => distance(a, home) - distance(b, home));
  // The main mine runs dry; the next closest is the natural expansion.
  const near = mines[0],
    far = mines[1];
  near.amount = 20;
  const u = w.own(0).find((e) => e.kind === "worker")!;
  w.submit({ player: 0, ids: [u.id], type: "gather", target: near.id });
  advance(w, 60);
  expect(w.entities.has(near.id)).toBe(false);
  // Every unit of gold is credited exactly once: the 20 from the empty mine
  // plus whatever has left the next mine, minus what the worker still carries.
  expect(w.players[0].gold).toBe(500 + 20 + (GOLD_MINE - far.amount) - u.carry);
  expect(u.order).toEqual({ type: "gather", target: far.id });
  // The freed cells are walkable again.
  expect(w.nav.canStand(near.x, near.z)).toBe(true);
  w.assertInvariants();
});
it("production waits while every spawn point is occupied and resumes once cleared", () => {
  const w = new World();
  w.aiEnabled = false;
  const b = w.own(0).find((e) => e.kind === "base")!;
  // Remote farms lift the food cap so blockers do not stall production on supply.
  for (let i = 0; i < 12; i++)
    w.spawn("farm", 0, 44.5 + (i % 6) * 5, 100.5 + Math.floor(i / 6) * 5);
  for (const e of w.own(0)) if (e.kind === "worker") w.remove(e);
  w.rebuild();
  const h = SPECS.base.size / 2 + 0.8,
    blockers: Entity[] = [];
  for (let r = h; r < h + 3; r += 1)
    for (let i = 0; i < 24; i++) {
      const p = {
        x: b.x + Math.cos((i * Math.PI) / 12) * r,
        z: b.z + Math.sin((i * Math.PI) / 12) * r,
      };
      if (w.nav.canStand(p.x, p.z))
        blockers.push(w.spawn("worker", 0, p.x, p.z));
    }
  expect(blockers.length).toBeGreaterThan(40);
  w.submit({ player: 0, ids: [b.id], type: "train", kind: "worker" });
  advance(w, SPECS.worker.time + 5);
  expect(b.queue).toHaveLength(1);
  expect(w.own(0).filter((e) => e.kind === "worker")).toHaveLength(
    blockers.length,
  );
  expect(w.population(0).reserved).toBe(1);
  for (const e of blockers) w.remove(e);
  advance(w, 1);
  expect(b.queue).toHaveLength(0);
  expect(w.own(0).filter((e) => isUnit(e.kind))).toHaveLength(1);
  expect(w.population(0).reserved).toBe(0);
  w.assertInvariants();
});
it("attack-move fights an enemy on the way and then continues to its destination", () => {
  const w = new World();
  w.aiEnabled = false;
  const squad: Entity[] = [];
  for (let i = 0; i < 5; i++)
    squad.push(w.spawn("soldier", 0, 47.5, 28.5 + i * 1.2));
  const enemy = w.spawn("soldier", 1, 56.5, 31);
  const goal = { x: 80.5, z: 31 };
  w.submit({
    player: 0,
    ids: squad.map((e) => e.id),
    type: "assault",
    point: goal,
  });
  advance(w, 60);
  expect(w.entities.has(enemy.id)).toBe(false);
  expect(w.stats[0].kills).toBe(1);
  const alive = squad.filter((e) => w.entities.has(e.id));
  expect(alive.length).toBeGreaterThan(0);
  for (const e of alive) {
    expect(distance(e, goal)).toBeLessThan(6);
    expect(e.order.type).toBe("idle");
  }
  w.assertInvariants();
}, 20000);
it("a reversed move command replaces the first and units return", () => {
  const w = new World();
  w.aiEnabled = false;
  const units: Entity[] = [];
  for (let i = 0; i < 20; i++)
    units.push(
      w.spawn(
        "soldier",
        0,
        45.5 + (i % 5) * 1.2,
        14.5 + Math.floor(i / 5) * 1.2,
      ),
    );
  const ids = units.map((e) => e.id),
    home = { x: 47.5, z: 16.5 };
  w.submit({ player: 0, ids, type: "move", point: { x: 85.5, z: 16.5 } });
  advance(w, 3);
  expect(units.every((e) => e.x > 46)).toBe(true);
  w.submit({ player: 0, ids, type: "move", point: home });
  advance(w, 30);
  expect(units.filter((e) => distance(e, home) < 6)).toHaveLength(20);
  expect(units.every((e) => e.order.type === "idle")).toBe(true);
  w.assertInvariants();
}, 20000);
