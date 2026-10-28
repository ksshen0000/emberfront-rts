import {
  SPECS,
  SIZE,
  STEP,
  distance,
  damageAgainst,
  isUnit,
  FOOD_MAX,
  START,
  GOLD_MINE,
  QUEUE_MAX,
  GOLD_TRIP,
  GOLD_TIME,
  WOOD_TRIP,
  WOOD_CHOP,
  WOOD_TIME,
  isBuilding,
  type Kind,
  type UnitKind,
  type BuildingKind,
  type Point,
} from "./config";
import { Navigation } from "./navigation";
import {
  SLAM,
  XP_RANGE,
  gainXp,
  heroRegen,
  heroSpec,
  killXp,
  newHero,
  reviveCost,
  slamLevel,
  specOf,
  type Hero,
} from "./hero";
import {
  WADE_SPEED,
  buildable,
  layout,
  mirror,
  terrainBlocking,
  terrainTiers,
  terrainWet,
  tierAt,
} from "./terrain";
export const VISIBLE = 1,
  EXPLORED = 2;
/** Chance that an archer shooting up onto higher ground misses. */
export const UPHILL_MISS = 0.25;
// Just outside each stronghold, on the side facing the map centre.
const START_SPOTS = [{ x: 28.5, z: 30.5 }, mirror({ x: 28.5, z: 30.5 })];
const STEPS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
// AI tuning: WC3-like build — five miners, a small lumber crew, two barracks.
// Waves grow so armies accumulate instead of trading six-for-six forever.
const AI = {
  miners: 5,
  lumberjacks: 3,
  // Barracks per finished stronghold.
  barracks: 2,
  expandGold: 300,
  // A mine this close to a finished stronghold is worked from it.
  mineReach: 14,
  halls: 2,
  foodBuffer: 6,
  wave: 6,
  waveGrowth: 2,
  waveMax: 16,
  // Gold kept for troops when placing the altar after the first barracks.
  altarReserve: 120,
  // Enemy units around the hero worth a Quake Slam.
  slamTargets: 3,
  // A hurt hero falls back home below this share of its health and rejoins
  // the army once it has regenerated past the second.
  heroFlee: 0.3,
  heroRejoin: 0.5,
};
export type Owner = 0 | 1 | 2;
export type Order =
  | { type: "idle" }
  | { type: "move" | "assault"; point: Point }
  | { type: "attack" | "gather" | "build"; target: number };
export interface Entity extends Point {
  id: number;
  kind: Kind;
  owner: Owner;
  hp: number;
  progress: number;
  queue: QueueItem[];
  rally?: Point;
  order: Order;
  path: Point[];
  pathVersion: number;
  pathGoal?: Point;
  retryAt: number;
  stuck: number;
  failures: number;
  cooldown: number;
  work: number;
  carry: number;
  carryKind: "gold" | "wood";
  amount: number;
  born: number;
  heading: number;
  anchor: Point;
  autoTarget?: number;
  approach?: { target: number; point: Point };
  lastHit?: { id: number; kind: Kind; owner: Owner };
  /** Seconds left stunned: a stunned unit neither moves nor attacks. */
  stun: number;
  /** Level, experience, mana and abilities; heroes only. */
  hero?: Hero;
}
export interface QueueItem {
  kind: UnitKind;
  elapsed: number;
  /** Reviving a fallen hero, at a price and duration set by its level. */
  revive?: { gold: number; time: number };
}
/** Seconds a queue item takes to finish. */
export const queueTime = (q: QueueItem) => q.revive?.time ?? SPECS[q.kind].time;
export interface LogEntry {
  t: number;
  owner: Owner;
  event: string;
  detail: string;
}
export interface Stats {
  gold: number;
  wood: number;
  spent: number;
  trained: number;
  lost: number;
  kills: number;
  damage: number;
}
export interface Player {
  gold: number;
  wood: number;
}
export interface Command {
  player: 0 | 1;
  ids: number[];
  type:
    | "move"
    | "assault"
    | "attack"
    | "gather"
    | "build"
    | "stop"
    | "train"
    | "cancel"
    | "rally"
    | "resume"
    | "learn"
    | "cast";
  point?: Point;
  target?: number;
  kind?: UnitKind | BuildingKind;
  index?: number;
}
export interface Effect {
  from: Point;
  to: Point;
  owner: Owner;
  ranged: boolean;
  /** The shot missed (fired uphill); the renderer drops it beside the target. */
  miss?: boolean;
  /** A burst at `to` instead of a shot: a Quake Slam or a hero levelling up. */
  burst?: "slam" | "levelup";
}
export class World {
  entities = new Map<number, Entity>();
  players: Player[] = [{ ...START }, { ...START }];
  nav = new Navigation();
  time = 0;
  tick = 0;
  seed = 0x9e3779b9;
  paused = false;
  result: null | "win" | "loss" | "draw" = null;
  aiEnabled = true;
  messages: string[] = [];
  effects: Effect[] = [];
  commands: Command[] = [];
  nextId = 1;
  pathBudget = 0;
  // Players the built-in AI commands; the browser adds 0 for spectator mode.
  aiPlayers: (0 | 1)[] = [1];
  aiWaves = [0, 0];
  /** AI heroes pulled out of the fight to regenerate. */
  aiResting = [false, false];
  /** A player's dead hero, kept with its level until revived at an altar. */
  fallen: (Hero | null)[] = [null, null];
  /** Heroes whose Quake Slam lands this step. */
  casting: Entity[] = [];
  // Battle log for headless AI-vs-AI runs; off in normal play to bound memory.
  logging = false;
  log: LogEntry[] = [];
  stats: Stats[] = [0, 1].map(() => ({
    gold: 0,
    wood: 0,
    spent: 0,
    trained: 0,
    lost: 0,
    kills: 0,
    damage: 0,
  }));
  // Fog of war per player, one byte per map cell: VISIBLE now and/or EXPLORED
  // at some point. Simulation rules ignore it; the renderer and minimap read it.
  fog = [new Uint8Array(SIZE * SIZE), new Uint8Array(SIZE * SIZE)];
  fogVersion = 0;
  constructor() {
    this.setup();
    this.updateFog();
  }
  updateFog() {
    const tiers = terrainTiers();
    for (const owner of [0, 1] as const) {
      const fog = this.fog[owner];
      for (let i = 0; i < fog.length; i++) fog[i] &= ~VISIBLE;
      for (const e of this.roster().actors) {
        if (e.owner !== owner) continue;
        const r = SPECS[e.kind].sight ?? 0,
          // Nobody sees up a cliff: ground above the viewer's tier stays dark.
          tier = tiers[Math.floor(e.z) * SIZE + Math.floor(e.x)];
        // Each row of the sight circle is one contiguous run of cells whose
        // centres lie within the radius.
        for (
          let z = Math.max(0, Math.floor(e.z - r));
          z <= Math.min(SIZE - 1, e.z + r);
          z++
        ) {
          const dz = z + 0.5 - e.z;
          if (dz * dz > r * r) continue;
          const half = Math.sqrt(r * r - dz * dz),
            x0 = Math.max(0, Math.ceil(e.x - half - 0.5)),
            x1 = Math.min(SIZE - 1, Math.floor(e.x + half - 0.5));
          if (x1 < x0) continue;
          if (tier === 2)
            fog.fill(VISIBLE | EXPLORED, z * SIZE + x0, z * SIZE + x1 + 1);
          else
            for (let i = z * SIZE + x0; i <= z * SIZE + x1; i++)
              if (tiers[i] <= tier) fog[i] = VISIBLE | EXPLORED;
        }
      }
    }
    this.fogVersion++;
  }
  /** Fog bits of the map cell under a point (0 outside the map). */
  fogAt(owner: 0 | 1, x: number, z: number) {
    const cx = Math.floor(x),
      cz = Math.floor(z);
    return cx < 0 || cz < 0 || cx >= SIZE || cz >= SIZE
      ? 0
      : this.fog[owner][cz * SIZE + cx];
  }
  /** Whether a player currently sees any part of an entity's footprint. */
  sees(owner: 0 | 1, e: Entity) {
    return (
      e.owner === owner ||
      this.seesArea(owner, e, isUnit(e.kind) ? 0 : SPECS[e.kind].size / 2)
    );
  }
  /** Whether any cell of a square of half-width `half` around a point is visible. */
  seesArea(owner: 0 | 1, p: Point, half: number) {
    const h = Math.max(0, half - 0.01);
    for (let z = Math.floor(p.z - h); z <= Math.floor(p.z + h); z++)
      for (let x = Math.floor(p.x - h); x <= Math.floor(p.x + h); x++)
        if (this.fogAt(owner, x, z) & VISIBLE) return true;
    return false;
  }
  spawn(kind: Kind, owner: Owner, x: number, z: number, complete = true) {
    const e: Entity = {
      id: this.nextId++,
      kind,
      owner,
      x,
      z,
      hp: SPECS[kind].hp * (complete ? 1 : 0.1),
      progress: complete ? 1 : 0,
      queue: [],
      order: { type: "idle" },
      path: [],
      pathVersion: -1,
      retryAt: 0,
      stuck: 0,
      failures: 0,
      cooldown: 0,
      work: 0,
      carry: 0,
      carryKind: "gold",
      amount: kind === "gold" ? GOLD_MINE : kind === "tree" ? 500 : 0,
      born: this.tick,
      heading: 0,
      anchor: { x, z },
      stun: 0,
      hero: kind === "hero" ? newHero() : undefined,
    };
    this.entities.set(e.id, e);
    return e;
  }
  setup() {
    this.nav.terrain.set(terrainBlocking());
    // Build the cached terrain maps now rather than inside the first step.
    terrainTiers();
    terrainWet();
    for (const owner of [0, 1] as const) {
      const side = (x: number, z: number) =>
        owner ? mirror({ x, z }) : { x, z };
      const base = side(24, 24);
      this.spawn("base", owner, base.x, base.z);
      for (let i = 0; i < 5; i++) {
        const p = side(20 + i * 1.5, 30);
        this.spawn("worker", owner, p.x, p.z);
      }
    }
    for (const p of layout()) this.spawn(p.kind, 2, p.x, p.z);
    this.rebuild();
  }
  rebuild() {
    this.nav.cells.set(this.nav.terrain);
    for (const e of this.entities.values())
      if (!isUnit(e.kind)) this.nav.occupy(e, SPECS[e.kind].size);
    this.nav.version++;
  }
  own(owner: Owner) {
    return owner === 2
      ? [...this.entities.values()].filter((e) => e.owner === 2)
      : this.roster().actors.filter((e) => e.owner === owner);
  }
  // Food: units consume it, completed Stronghold and farms provide it.
  population(owner: Owner) {
    const all = this.own(owner);
    return {
      used: all.reduce(
        (n, e) => n + (isUnit(e.kind) ? SPECS[e.kind].food : 0),
        0,
      ),
      reserved: all.reduce(
        (n, e) => n + e.queue.reduce((m, q) => m + SPECS[q.kind].food, 0),
        0,
      ),
      cap: Math.min(
        FOOD_MAX,
        all.reduce(
          (n, e) =>
            n +
            (isBuilding(e.kind) && e.progress === 1 ? -SPECS[e.kind].food : 0),
          0,
        ),
      ),
    };
  }
  // Deterministic damage roll (mulberry32) so replays stay reproducible.
  random() {
    let t = (this.seed = (this.seed + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  record(owner: Owner, event: string, detail = "") {
    if (this.logging)
      this.log.push({
        t: Math.round(this.time * 100) / 100,
        owner,
        event,
        detail,
      });
  }
  label(e: Entity) {
    return `${e.kind}#${e.id}`;
  }
  notify(text: string, owner: Owner = 0) {
    this.record(owner, "warn", text);
    this.tell(text, owner);
  }
  /** Shows a message to the human player without logging it as a warning. */
  tell(text: string, owner: Owner = 0) {
    if (owner === 0 && !this.aiPlayers.includes(0)) {
      this.messages.push(text);
      if (this.messages.length > 8) this.messages.shift();
    }
  }
  submit(command: Command) {
    if (!this.paused && !this.result) this.commands.push(command);
  }
  setOrder(e: Entity, order: Order) {
    e.order = order;
    e.path = [];
    e.pathGoal = undefined;
    e.retryAt = 0;
    e.stuck = 0;
    e.failures = 0;
    e.work = 0;
    e.autoTarget = undefined;
    e.approach = undefined;
    e.anchor = { x: e.x, z: e.z };
  }
  pay(owner: 0 | 1, kind: Kind) {
    return this.payCost(owner, SPECS[kind]);
  }
  payCost(owner: 0 | 1, cost: { gold: number; wood: number }) {
    const p = this.players[owner];
    if (p.gold < cost.gold || p.wood < cost.wood) {
      this.notify("Not enough gold or wood.", owner);
      return false;
    }
    p.gold -= cost.gold;
    p.wood -= cost.wood;
    this.stats[owner].spent += cost.gold + cost.wood;
    return true;
  }
  /** A player's living hero. */
  heroOf(owner: 0 | 1) {
    return this.roster().units.find((e) => e.owner === owner && e.hero);
  }
  /** Whether a hero is alive, fallen or in training: each side gets one. */
  hasHero(owner: 0 | 1) {
    return (
      !!this.heroOf(owner) ||
      !!this.fallen[owner] ||
      this.own(owner).some((b) => b.queue.some((q) => q.kind === "hero"))
    );
  }
  gap(a: Entity, b: Entity) {
    if (isUnit(b.kind)) return Math.max(0, distance(a, b) - 0.7);
    const half = SPECS[b.kind].size / 2;
    return Math.max(
      0,
      Math.hypot(
        Math.max(0, Math.abs(a.x - b.x) - half),
        Math.max(0, Math.abs(a.z - b.z) - half),
      ) - 0.35,
    );
  }
  snap(kind: BuildingKind, p: Point) {
    const half = SPECS[kind].size / 2;
    return {
      x: Math.round(p.x - half) + half,
      z: Math.round(p.z - half) + half,
    };
  }
  placement(kind: BuildingKind, p: Point): string | null {
    const s = SPECS[kind].size / 2;
    if (p.x - s < 3 || p.z - s < 3 || p.x + s > SIZE - 3 || p.z + s > SIZE - 3)
      return "Outside the buildable area.";
    for (let x = Math.floor(p.x - s); x < Math.ceil(p.x + s); x++)
      for (let z = Math.floor(p.z - s); z < Math.ceil(p.z + s); z++)
        if (this.nav.blocked(x, z))
          return "Blocked by terrain, a building or a resource.";
    if (!buildable(p, SPECS[kind].size))
      return "The ground here is too steep or wet to build on.";
    // A stronghold leaves room for workers between it and a gold mine.
    if (kind === "base")
      for (const g of this.entities.values()) {
        if (g.kind !== "gold") continue;
        const reach = s + SPECS.gold.size / 2;
        if (
          Math.hypot(
            Math.max(0, Math.abs(g.x - p.x) - reach),
            Math.max(0, Math.abs(g.z - p.z) - reach),
          ) < 3
        )
          return "Too close to a gold mine.";
      }
    for (const e of this.entities.values())
      if (
        isUnit(e.kind) &&
        Math.abs(e.x - p.x) < s + 0.5 &&
        Math.abs(e.z - p.z) < s + 0.5
      )
        return "A unit is standing here.";
    if (this.seals(p, SPECS[kind].size))
      return "This would wall off the route between the strongholds.";
    return null;
  }
  /** Whether all open cells around a rectangle connect within a margin around it. */
  locallyConnected(
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    solid: (x: number, z: number) => boolean,
  ) {
    const m = 10,
      wx0 = Math.max(0, x0 - m),
      wz0 = Math.max(0, z0 - m),
      wx1 = Math.min(SIZE, x1 + m),
      wz1 = Math.min(SIZE, z1 + m),
      ring: number[] = [];
    for (let x = x0 - 1; x <= x1; x++)
      for (let z = z0 - 1; z <= z1; z++) {
        const edge = x === x0 - 1 || x === x1 || z === z0 - 1 || z === z1;
        if (edge && x >= 0 && z >= 0 && x < SIZE && z < SIZE && !solid(x, z))
          ring.push(z * SIZE + x);
      }
    if (ring.length <= 1) return ring.length === 1;
    const reach = this.reach.fill(0),
      queue = this.queue;
    let head = 0,
      tail = 0;
    reach[ring[0]] = 1;
    queue[tail++] = ring[0];
    while (head < tail) {
      const id = queue[head++],
        x = id % SIZE,
        z = (id - x) / SIZE;
      for (const [dx, dz] of STEPS) {
        const nx = x + dx,
          nz = z + dz;
        if (nx < wx0 || nz < wz0 || nx >= wx1 || nz >= wz1 || solid(nx, nz))
          continue;
        const n = nz * SIZE + nx;
        if (reach[n]) continue;
        reach[n] = 1;
        queue[tail++] = n;
      }
    }
    return ring.every((id) => reach[id]);
  }
  // Scratch buffers for the reachability check, reused between calls.
  private reach = new Uint8Array(SIZE * SIZE);
  private queue = new Int32Array(SIZE * SIZE);
  /**
   * Whether a footprint would cut the two starting positions off from each
   * other. Ramps and fords are chokepoints, so a wall there could otherwise
   * seal a base for good. Flood fill from one start, footprint treated as solid.
   */
  seals(p: Point, size: number) {
    const s = size / 2,
      x0 = Math.floor(p.x - s),
      x1 = Math.ceil(p.x + s),
      z0 = Math.floor(p.z - s),
      z1 = Math.ceil(p.z + s),
      solid = (x: number, z: number) =>
        this.nav.blocked(x, z) || (x >= x0 && x < x1 && z >= z0 && z < z1);
    const open = (q: Point) => {
      const c = this.nav.nearest(q, 8);
      return c && !solid(Math.floor(c.x), Math.floor(c.z)) ? c : null;
    };
    // Local test first: if the open cells hugging the footprint still reach
    // each other within a small window, no route can have been cut.
    if (this.locallyConnected(x0, z0, x1, z1, solid)) return false;
    // Spawn rings beside each stronghold's starting position.
    const a = open(START_SPOTS[0]),
      b = open(START_SPOTS[1]);
    if (!a || !b) return false;
    const reach = this.reach.fill(0),
      queue = this.queue;
    let head = 0,
      tail = 0;
    const start = Math.floor(a.z) * SIZE + Math.floor(a.x),
      goal = Math.floor(b.z) * SIZE + Math.floor(b.x);
    reach[start] = 1;
    queue[tail++] = start;
    while (head < tail) {
      const id = queue[head++];
      if (id === goal) return false;
      const x = id % SIZE,
        z = (id - x) / SIZE;
      for (const [dx, dz] of STEPS) {
        const nx = x + dx,
          nz = z + dz;
        if (solid(nx, nz)) continue;
        const n = nz * SIZE + nx;
        if (reach[n]) continue;
        reach[n] = 1;
        queue[tail++] = n;
      }
    }
    return true;
  }
  private lists: {
    tick: number;
    size: number;
    units: Entity[];
    actors: Entity[];
  } | null = null;
  /**
   * Units and player-owned entities, cached per tick. Trees and mines are most
   * of the map, so scanning only these keeps per-unit queries cheap.
   */
  roster() {
    const l = this.lists;
    if (l && l.tick === this.tick && l.size === this.entities.size) return l;
    const units: Entity[] = [],
      actors: Entity[] = [];
    for (const e of this.entities.values()) {
      if (e.owner !== 2) actors.push(e);
      if (isUnit(e.kind)) units.push(e);
    }
    return (this.lists = {
      tick: this.tick,
      size: this.entities.size,
      units,
      actors,
    });
  }
  interactPoint(unit: Entity, target: Entity): Point | null {
    const others = this.roster().units.filter((e) => e.id !== unit.id);
    const free = (p: Point) =>
      this.nav.canStand(p.x, p.z) && !others.some((e) => distance(e, p) < 0.7);
    if (unit.approach?.target === target.id && free(unit.approach.point))
      return unit.approach.point;
    const h = SPECS[target.kind].size / 2 + 0.65,
      candidates: Point[] = [];
    for (let side = 0; side < 4; side++)
      for (let t = -h + 0.5; t < h; t += 1) {
        const p =
          side === 0
            ? { x: target.x + t, z: target.z - h }
            : side === 1
              ? { x: target.x + h, z: target.z + t }
              : side === 2
                ? { x: target.x + t, z: target.z + h }
                : { x: target.x - h, z: target.z + t };
        if (free(p)) candidates.push(p);
      }
    const point =
      candidates.sort((a, b) => distance(unit, a) - distance(unit, b))[0] ??
      null;
    unit.approach = point ? { target: target.id, point } : undefined;
    return point;
  }
  apply(c: Command) {
    const units = c.ids
      .map((id) => this.entities.get(id))
      .filter((e): e is Entity => !!e && e.owner === c.player);
    if (!units.length) return;
    if (c.type === "train") {
      const b = units[0],
        kind = c.kind;
      if (
        !kind ||
        !isUnit(kind) ||
        b.progress < 1 ||
        !(
          (b.kind === "base" && kind === "worker") ||
          (b.kind === "barracks" &&
            (kind === "soldier" || kind === "archer")) ||
          (b.kind === "altar" && kind === "hero")
        )
      )
        return;
      const p = this.population(c.player),
        fallen = kind === "hero" ? this.fallen[c.player] : null;
      if (
        kind === "hero" &&
        (this.heroOf(c.player) ||
          this.own(c.player).some((e) => e.queue.some((q) => q.kind === kind)))
      ) {
        this.notify("Your commander is already in the field.", c.player);
        return;
      }
      if (b.queue.length >= QUEUE_MAX) {
        this.notify("Training queue is full.", c.player);
        return;
      }
      if (p.used + p.reserved + SPECS[kind].food > p.cap) {
        this.notify("Not enough food. Build more farms.", c.player);
        return;
      }
      // A fallen hero is revived with its level instead of trained anew.
      const revive = fallen ? reviveCost(fallen.level) : undefined;
      if (
        revive
          ? this.payCost(c.player, { gold: revive.gold, wood: 0 })
          : this.pay(c.player, kind)
      ) {
        b.queue.push({ kind, elapsed: 0, revive });
        this.record(
          c.player,
          "queue",
          `${revive ? "revive " : ""}${kind} at ${this.label(b)}`,
        );
      }
      return;
    }
    if (c.type === "learn" || c.type === "cast") {
      const e = units.find((u) => u.hero),
        h = e?.hero;
      if (!e || !h) return;
      if (c.type === "learn") {
        if (
          h.points > 0 &&
          h.slam < SLAM.ranks &&
          h.level >= slamLevel(h.slam + 1)
        ) {
          h.points--;
          h.slam++;
          this.record(c.player, "learn", `${SLAM.name} ${h.slam}`);
        }
        return;
      }
      const error = !h.slam
        ? `${SLAM.name} has not been learned.`
        : e.stun > 0
          ? "Your commander is stunned."
          : h.recharge > 0
            ? `${SLAM.name} is not ready yet.`
            : h.mana < SLAM.mana
              ? "Not enough mana."
              : null;
      if (error) {
        this.notify(error, c.player);
        return;
      }
      h.mana -= SLAM.mana;
      h.recharge = SLAM.cooldown;
      this.casting.push(e);
      return;
    }
    if (c.type === "cancel") {
      const b = units[0];
      if (b.progress < 1 && isBuilding(b.kind)) {
        const s = SPECS[b.kind];
        this.players[c.player].gold += Math.floor(s.gold * 0.75);
        this.players[c.player].wood += Math.floor(s.wood * 0.75);
        this.record(c.player, "cancel", this.label(b));
        this.remove(b);
      } else {
        const index = c.index ?? 0;
        if (index < 0 || index >= b.queue.length) return;
        const [q] = b.queue.splice(index, 1);
        this.players[c.player].gold += q.revive?.gold ?? SPECS[q.kind].gold;
        this.players[c.player].wood += q.revive ? 0 : SPECS[q.kind].wood;
      }
      return;
    }
    if (c.type === "build" && c.point && c.kind && isBuilding(c.kind)) {
      const kind = c.kind as BuildingKind,
        p = this.snap(kind, c.point),
        error = this.placement(kind, p);
      if (error) {
        this.notify(error, c.player);
        return;
      }
      const candidates = units
        .filter((e) => e.kind === "worker")
        .sort((a, b) => distance(a, p) - distance(b, p) || a.id - b.id);
      const mock = { ...candidates[0], ...p, kind } as Entity;
      let worker: Entity | undefined;
      for (const w of candidates) {
        const access = this.interactPoint(w, mock);
        if (access && this.nav.path(w, access)) {
          worker = w;
          break;
        }
      }
      if (!worker) {
        this.notify(
          "No selected worker can reach this construction site.",
          c.player,
        );
        return;
      }
      if (!this.pay(c.player, kind)) return;
      const b = this.spawn(kind, c.player, p.x, p.z, false);
      this.record(
        c.player,
        "build",
        `${this.label(b)} at (${p.x},${p.z}) by ${this.label(worker)}`,
      );
      this.rebuild();
      this.setOrder(worker, { type: "build", target: b.id });
      return;
    }
    const movable = units.filter((e) => isUnit(e.kind));
    let i = 0;
    for (const e of units) {
      if (c.type === "rally" && isBuilding(e.kind) && c.point) {
        e.rally = { ...c.point };
        continue;
      }
      if (!isUnit(e.kind)) continue;
      if (c.type === "stop") {
        this.setOrder(e, { type: "idle" });
        continue;
      }
      if ((c.type === "move" || c.type === "assault") && c.point) {
        const columns = Math.ceil(Math.sqrt(movable.length));
        const index = i++;
        const p = {
          x: c.point.x + ((index % columns) - (columns - 1) / 2) * 1.25,
          z:
            c.point.z +
            (Math.floor(index / columns) -
              (Math.ceil(movable.length / columns) - 1) / 2) *
              1.25,
        };
        const dest = this.nav.nearest(p);
        if (dest) this.setOrder(e, { type: c.type, point: dest });
        continue;
      }
      const target = this.entities.get(c.target ?? -1);
      if (!target) continue;
      if (c.type === "attack" && target.owner !== e.owner && target.owner !== 2)
        this.setOrder(e, { type: "attack", target: target.id });
      if (
        c.type === "gather" &&
        e.kind === "worker" &&
        (target.kind === "gold" || target.kind === "tree")
      ) {
        this.setOrder(e, { type: "gather", target: target.id });
      }
      if (
        c.type === "resume" &&
        e.kind === "worker" &&
        target.owner === e.owner &&
        target.progress < 1
      ) {
        if (
          !this.own(e.owner).some(
            (w) => w.order.type === "build" && w.order.target === target.id,
          )
        ) {
          this.setOrder(e, { type: "build", target: target.id });
          break;
        }
      }
    }
  }
  remove(e: Entity) {
    this.entities.delete(e.id);
    if (!isUnit(e.kind)) this.rebuild();
  }
  step() {
    if (this.paused || this.result) return;
    this.tick++;
    this.time = this.tick * STEP;
    this.pathBudget = 5;
    for (const c of this.commands.splice(0)) this.apply(c);
    if (this.aiEnabled && this.tick % 10 === 0)
      for (const owner of this.aiPlayers) this.ai(owner);
    if (this.logging && this.tick % Math.round(30 / STEP) === 0)
      for (const owner of [0, 1] as const) this.snapshot(owner);
    const hits = new Map<number, number>();
    for (const e of this.casting.splice(0))
      if (this.entities.has(e.id)) this.slam(e, hits);
    for (const e of this.entities.values()) {
      if (e.born === this.tick) continue;
      if (isBuilding(e.kind)) {
        this.produce(e);
        continue;
      }
      if (!isUnit(e.kind)) continue;
      e.cooldown = Math.max(0, e.cooldown - STEP);
      if (e.hero) {
        const h = e.hero,
          s = heroSpec(h.level),
          regen = heroRegen(h.level);
        if (e.hp > 0) e.hp = Math.min(s.hp, e.hp + regen.hp * STEP);
        h.mana = Math.min(s.mana, h.mana + regen.mana * STEP);
        h.recharge = Math.max(0, h.recharge - STEP);
      }
      if (e.stun > 0) {
        e.stun = Math.max(0, e.stun - STEP);
        continue;
      }
      if (e.order.type === "gather") {
        this.gather(e);
        continue;
      }
      if (e.order.type === "build") {
        this.build(e);
        continue;
      }
      if (e.order.type === "move") {
        if (this.travel(e, e.order.point)) this.setOrder(e, { type: "idle" });
        continue;
      }
      let target =
        e.order.type === "attack"
          ? this.entities.get(e.order.target)
          : undefined;
      if (e.order.type === "attack" && !target) {
        this.setOrder(e, { type: "idle" });
        continue;
      }
      if (e.order.type === "idle" || e.order.type === "assault") {
        target = this.entities.get(e.autoTarget ?? -1);
        if (
          target &&
          (distance(e.anchor, e) > 10 || target.owner === e.owner)
        ) {
          target = undefined;
          e.autoTarget = undefined;
        }
        if (!target && this.tick % 5 === e.id % 5) {
          target = this.roster()
            .actors.filter(
              (t) =>
                t.owner !== e.owner &&
                this.gap(e, t) <= 6 &&
                distance(e.anchor, t) < 12,
            )
            .sort((a, b) => this.gap(e, a) - this.gap(e, b) || a.id - b.id)[0];
          if (target) e.autoTarget = target.id;
        }
      }
      if (target) {
        const s = specOf(e);
        if (this.gap(e, target) <= s.range!) {
          e.path = [];
          e.heading = Math.atan2(target.x - e.x, target.z - e.z);
          if (e.cooldown <= 0) {
            // Shots up a cliff miss a quarter of the time.
            const miss =
              e.kind === "archer" &&
              tierAt(target.x, target.z) > tierAt(e.x, e.z) &&
              this.random() < UPHILL_MISS;
            const damage = miss
              ? 0
              : damageAgainst(s, this.random(), specOf(target));
            hits.set(target.id, (hits.get(target.id) ?? 0) + damage);
            target.lastHit = { id: e.id, kind: e.kind, owner: e.owner };
            if (e.owner !== 2) this.stats[e.owner].damage += damage;
            e.cooldown = s.cooldown!;
            this.effects.push({
              from: { x: e.x, z: e.z },
              to: { x: target.x, z: target.z },
              owner: e.owner,
              ranged: e.kind === "archer",
              miss,
            });
          }
        } else {
          const p = isUnit(target.kind)
            ? target
            : this.interactPoint(e, target);
          if (p) this.travel(e, p, 0.35);
        }
      } else if (e.order.type === "assault") {
        e.anchor = { x: e.x, z: e.z };
        if (this.travel(e, e.order.point)) this.setOrder(e, { type: "idle" });
      }
    }
    for (const [id, damage] of hits) {
      const e = this.entities.get(id);
      if (e) e.hp -= damage;
    }
    const dead = [...this.entities.values()].filter((e) => e.hp <= 0);
    for (const e of dead) {
      const k = e.lastHit;
      // Heroes of the killing side near the kill share its experience.
      if (k && k.owner !== 2 && k.owner !== e.owner && isUnit(e.kind)) {
        const heroes = this.roster().units.filter(
          (h) =>
            h.hero &&
            h.owner === k.owner &&
            h.hp > 0 &&
            distance(h, e) <= XP_RANGE,
        );
        for (const h of heroes) this.reward(h, killXp(e) / heroes.length);
      }
    }
    for (const e of dead) {
      const k = e.lastHit;
      if (e.owner !== 2) this.stats[e.owner].lost++;
      if (k && k.owner !== 2) this.stats[k.owner].kills++;
      if (e.hero && e.owner !== 2) {
        this.fallen[e.owner] = e.hero;
        this.tell(
          "Your commander has fallen. Revive them at the altar.",
          e.owner,
        );
      }
      this.record(
        e.owner,
        "death",
        `${this.label(e)} at (${e.x.toFixed(1)},${e.z.toFixed(1)}) by ${k ? `${k.kind}#${k.id}` : "?"}`,
      );
      this.remove(e);
    }
    const a = this.own(0).some((e) => e.kind === "base"),
      b = this.own(1).some((e) => e.kind === "base");
    if (!a || !b) {
      this.result = !a && !b ? "draw" : a ? "win" : "loss";
      this.record(2, "result", this.result);
    }
    if (this.tick % 4 === 0) this.updateFog();
    // A bounded event queue lets headless tests run without a renderer.
    if (this.effects.length > 200)
      this.effects.splice(0, this.effects.length - 200);
  }
  /** Quake Slam: damages and stuns every enemy unit around the hero. */
  slam(e: Entity, hits: Map<number, number>) {
    const rank = e.hero!.slam - 1,
      damage = SLAM.damage[rank];
    for (const t of this.roster().units) {
      if (t.owner === e.owner || t.owner === 2) continue;
      if (distance(e, t) > SLAM.radius + 0.35) continue;
      hits.set(t.id, (hits.get(t.id) ?? 0) + damage);
      t.lastHit = { id: e.id, kind: e.kind, owner: e.owner };
      t.stun = Math.max(t.stun, SLAM.stun[rank] * (t.hero ? 0.5 : 1));
      if (e.owner !== 2) this.stats[e.owner].damage += damage;
    }
    this.record(e.owner, "slam", `${this.label(e)} rank ${rank + 1}`);
    this.effects.push({
      from: { x: e.x, z: e.z },
      to: { x: e.x, z: e.z },
      owner: e.owner,
      ranged: false,
      burst: "slam",
    });
  }
  /** Grants experience; each level raises health along with the maximum. */
  reward(e: Entity, xp: number) {
    const h = e.hero!,
      before = heroSpec(h.level);
    if (!gainXp(h, xp)) return;
    const after = heroSpec(h.level);
    e.hp += after.hp - before.hp;
    h.mana += after.mana - before.mana;
    this.record(e.owner, "level", `${this.label(e)} reached level ${h.level}`);
    this.tell(`Your commander reached level ${h.level}.`, e.owner);
    this.effects.push({
      from: { x: e.x, z: e.z },
      to: { x: e.x, z: e.z },
      owner: e.owner,
      ranged: false,
      burst: "levelup",
    });
  }
  travel(e: Entity, goal: Point, tolerance = 0.25): boolean {
    if (distance(e, goal) <= tolerance) return true;
    if (e.retryAt > this.time) return false;
    if (
      e.pathVersion !== this.nav.version ||
      !e.pathGoal ||
      distance(e.pathGoal, goal) > 1.3 ||
      !e.path.length
    ) {
      if (this.pathBudget <= 0) return false;
      this.pathBudget--;
      const path = this.nav.path(e, goal);
      e.pathVersion = this.nav.version;
      e.pathGoal = { ...goal };
      if (!path) {
        this.failedMove(e);
        return false;
      }
      e.path = path;
    }
    const point = e.path[0];
    if (!point) return false;
    const d = distance(e, point),
      wade = terrainWet()[Math.floor(e.z) * SIZE + Math.floor(e.x)],
      step = Math.min(SPECS[e.kind].speed! * STEP * (wade ? WADE_SPEED : 1), d);
    if (d < 0.12) {
      e.path.shift();
      return !e.path.length && distance(e, goal) < 0.8;
    }
    const dx = (point.x - e.x) / d,
      dz = (point.z - e.z) / d;
    // Avoidance yields once a unit has waited a moment, so two units that
    // want the same spot cannot deadlock each other into a failed move.
    const neighbors =
      e.stuck >= 0.5
        ? []
        : this.roster().units.filter(
            (o) => o.id !== e.id && distance(e, o) < 1.5,
          );
    let moved = false;
    // Steer around neighbours first; the last two candidates slide along a
    // single axis so a body clipping a building corner can still get free.
    const candidates = [0, 0.55, -0.55, 1.05, -1.05].map((angle) => ({
      vx: dx * Math.cos(angle) - dz * Math.sin(angle),
      vz: dx * Math.sin(angle) + dz * Math.cos(angle),
    }));
    if (Math.abs(dx) > 0.05) candidates.push({ vx: Math.sign(dx), vz: 0 });
    if (Math.abs(dz) > 0.05) candidates.push({ vx: 0, vz: Math.sign(dz) });
    for (const { vx, vz } of candidates) {
      const next = { x: e.x + vx * step, z: e.z + vz * step };
      if (!this.nav.segment(e, next)) continue;
      if (
        neighbors.some(
          (o) =>
            distance(next, o) < 0.67 &&
            distance(next, o) < distance(e, o) - 0.001,
        )
      )
        continue;
      e.x = next.x;
      e.z = next.z;
      e.heading = Math.atan2(vx, vz);
      moved = true;
      break;
    }
    // Progress, not mere motion, clears the stuck timer: two units sliding
    // sideways around each other forever would otherwise never yield.
    if (moved && d - distance(e, point) > step * 0.25) {
      e.stuck = 0;
      e.failures = 0;
    } else {
      e.stuck += STEP;
      if (e.stuck > 2) {
        e.path = [];
        e.stuck = 0;
        this.failedMove(e);
      }
    }
    return false;
  }
  failedMove(e: Entity) {
    e.failures++;
    e.retryAt = this.time + 0.5;
    e.path = [];
    this.record(
      e.owner,
      "stuck",
      `${this.label(e)} at (${e.x.toFixed(1)},${e.z.toFixed(1)}) order ${e.order.type} try ${e.failures}`,
    );
    if (e.failures >= 3) {
      this.notify(
        "Some units cannot reach their destination. Try a different route.",
        e.owner,
      );
      this.setOrder(e, { type: "idle" });
    }
  }
  gather(e: Entity) {
    if (e.order.type !== "gather") return;
    let resource = this.entities.get(e.order.target);
    if (
      e.carry >= (e.carryKind === "gold" ? GOLD_TRIP : WOOD_TRIP) ||
      (!resource && e.carry > 0) ||
      (resource &&
        e.carry > 0 &&
        e.carryKind !== (resource.kind === "gold" ? "gold" : "wood"))
    ) {
      // Deliver to the nearest finished stronghold.
      const base = this.own(e.owner)
        .filter((b) => b.kind === "base" && b.progress >= 1)
        .sort((a, b) => distance(e, a) - distance(e, b) || a.id - b.id)[0];
      if (!base) return;
      if (this.gap(e, base) <= 0.6) {
        this.players[e.owner][e.carryKind] += e.carry;
        if (e.owner !== 2) this.stats[e.owner][e.carryKind] += e.carry;
        e.carry = 0;
        e.path = [];
        e.pathGoal = undefined;
      } else {
        const p = this.interactPoint(e, base);
        if (p) this.travel(e, p);
      }
      return;
    }
    if (!resource) {
      resource = [...this.entities.values()]
        .filter((r) => r.kind === (e.carryKind === "gold" ? "gold" : "tree"))
        .sort((a, b) => distance(e, a) - distance(e, b))[0];
      if (!resource) {
        this.setOrder(e, { type: "idle" });
        this.notify("No resources of this type remain.", e.owner);
        return;
      }
      e.order = { type: "gather", target: resource.id };
    }
    if (this.gap(e, resource) > 0.6) {
      const p = this.interactPoint(e, resource);
      if (p) this.travel(e, p);
      return;
    }
    e.path = [];
    e.work += STEP;
    e.heading = Math.atan2(resource.x - e.x, resource.z - e.z);
    const gold = resource.kind === "gold";
    if (e.work + 1e-9 >= (gold ? GOLD_TIME : WOOD_TIME)) {
      e.work = 0;
      const take = Math.min(
        gold ? GOLD_TRIP : WOOD_CHOP,
        (gold ? GOLD_TRIP : WOOD_TRIP) - e.carry,
        resource.amount,
      );
      resource.amount -= take;
      e.carry += take;
      e.carryKind = resource.kind === "gold" ? "gold" : "wood";
      if (resource.amount <= 0) {
        this.record(e.owner, "depleted", this.label(resource));
        this.remove(resource);
      }
    }
  }
  build(e: Entity) {
    if (e.order.type !== "build") return;
    const b = this.entities.get(e.order.target);
    if (!b || b.progress === 1) {
      this.setOrder(e, { type: "idle" });
      return;
    }
    if (this.gap(e, b) > 0.8) {
      const p = this.interactPoint(e, b);
      if (p) this.travel(e, p);
      return;
    }
    const increment = Math.min(1 - b.progress, STEP / SPECS[b.kind].time);
    b.progress = Math.min(1, b.progress + increment);
    if (b.progress > 1 - 1e-9) {
      b.progress = 1;
      this.record(b.owner, "complete", this.label(b));
    }
    b.hp = Math.min(
      SPECS[b.kind].hp,
      b.hp + SPECS[b.kind].hp * 0.9 * increment,
    );
  }
  produce(b: Entity) {
    if (b.progress < 1 || !b.queue.length || b.owner === 2) return;
    const q = b.queue[0];
    q.elapsed = Math.min(queueTime(q), q.elapsed + STEP);
    if (q.elapsed + 1e-8 < queueTime(q)) return;
    const pop = this.population(b.owner);
    if (pop.used + SPECS[q.kind].food > pop.cap) return;
    const h = SPECS[b.kind].size / 2 + 0.8;
    for (let r = h; r < h + 3; r += 1)
      for (let i = 0; i < 24; i++) {
        const angle = (i * Math.PI) / 12,
          p = { x: b.x + Math.cos(angle) * r, z: b.z + Math.sin(angle) * r };
        if (
          !this.nav.canStand(p.x, p.z) ||
          this.roster().units.some((e) => distance(e, p) < 0.8)
        )
          continue;
        if (b.rally && !this.nav.path(p, b.rally)) continue;
        const e = this.spawn(q.kind, b.owner, p.x, p.z),
          fallen = q.revive ? this.fallen[b.owner] : null;
        if (fallen) {
          // Revived at full health and mana, keeping level and abilities.
          const s = heroSpec(fallen.level);
          e.hero = { ...fallen, mana: s.mana, recharge: 0 };
          e.hp = s.hp;
          this.fallen[b.owner] = null;
        }
        b.queue.shift();
        this.stats[b.owner].trained++;
        this.record(b.owner, "born", `${this.label(e)} from ${this.label(b)}`);
        if (b.rally) this.setOrder(e, { type: "move", point: { ...b.rally } });
        return;
      }
  }
  snapshot(owner: 0 | 1) {
    const all = this.own(owner),
      p = this.players[owner],
      pop = this.population(owner),
      count = (f: (e: Entity) => boolean) => all.filter(f).length,
      workers = all.filter((e) => e.kind === "worker"),
      job = (type: string, res?: Kind) =>
        workers.filter(
          (w) =>
            w.order.type === type &&
            (!res ||
              (w.order.type === "gather" &&
                this.entities.get(w.order.target)?.kind === res)),
        ).length;
    this.record(
      owner,
      "snapshot",
      `gold ${Math.floor(p.gold)} wood ${Math.floor(p.wood)} food ${pop.used}+${pop.reserved}/${pop.cap} ` +
        `workers ${workers.length} (gold ${job("gather", "gold")} wood ${job("gather", "tree")} build ${job("build")} idle ${job("idle")}) ` +
        `soldier ${count((e) => e.kind === "soldier")} archer ${count((e) => e.kind === "archer")} ` +
        `farm ${count((e) => e.kind === "farm")} barracks ${count((e) => e.kind === "barracks")}`,
    );
  }
  // Built-in opponent. Decisions read the live state and track what they have
  // already ordered this tick, because submitted commands apply next step.
  ai(owner: 0 | 1) {
    const enemy = owner === 0 ? 1 : 0,
      all = this.own(owner),
      base = all.find((e) => e.kind === "base");
    if (!base) return;
    const p = this.players[owner],
      pop = this.population(owner);
    let gold = p.gold,
      wood = p.wood,
      food = pop.cap - pop.used - pop.reserved;
    const order = (c: Omit<Command, "player">) =>
      this.submit({ ...c, player: owner });
    const buy = (kind: Kind) => {
      const s = SPECS[kind];
      if (gold < s.gold || wood < s.wood || (isUnit(kind) && food < s.food))
        return false;
      gold -= s.gold;
      wood -= s.wood;
      if (isUnit(kind)) food -= s.food;
      return true;
    };
    const nearest = (kind: Kind, from: Point) =>
      [...this.entities.values()]
        .filter((e) => e.kind === kind)
        .sort((a, b) => distance(from, a) - distance(from, b))[0];
    const job = (w: Entity) =>
      w.order.type === "gather"
        ? this.entities.get(w.order.target)?.kind
        : w.order.type;

    // Economy: saturate each mine beside a finished stronghold, the rest cut
    // wood. With no mine at home, miners walk to the nearest one.
    const halls = all.filter((e) => e.kind === "base" && e.progress >= 1),
      hallGap = (g: Entity) =>
        Math.min(...halls.map((h) => distance(g, h)), Infinity),
      golds = [...this.entities.values()].filter((e) => e.kind === "gold"),
      homeMines = golds
        .filter((g) => hallGap(g) < AI.mineReach)
        .sort((a, b) => hallGap(a) - hallGap(b) || a.id - b.id),
      mines = homeMines.length
        ? homeMines
        : [nearest("gold", base)].filter((g): g is Entity => !!g),
      mine = mines[0];
    const workers = all.filter((e) => e.kind === "worker"),
      crews = new Map(
        mines.map((g) => [
          g.id,
          workers.filter(
            (w) => w.order.type === "gather" && w.order.target === g.id,
          ).length,
        ]),
      ),
      short = () => mines.find((g) => crews.get(g.id)! < AI.miners);
    for (const w of workers.filter((e) => e.order.type === "idle")) {
      const target = short() ?? nearest("tree", w);
      if (!target) continue;
      if (target.kind === "gold")
        crews.set(target.id, crews.get(target.id)! + 1);
      order({ ids: [w.id], type: "gather", target: target.id });
    }
    const lumberjacks = workers.filter((w) => job(w) === "tree"),
      understaffed = short();
    if (understaffed && lumberjacks.length) {
      order({
        ids: [lumberjacks[0].id],
        type: "gather",
        target: understaffed.id,
      });
      lumberjacks.shift();
    }
    const queuedWorkers = base.queue.length;
    if (
      workers.length + queuedWorkers <
        AI.miners * Math.max(1, mines.length) + AI.lumberjacks + 1 &&
      queuedWorkers === 0 &&
      buy("worker")
    )
      order({ ids: [base.id], type: "train", kind: "worker" });

    // Construction: finish abandoned sites, then farms ahead of the food cap.
    const sites = all.filter((e) => isBuilding(e.kind) && e.progress < 1),
      builder = () =>
        lumberjacks.shift() ?? workers.find((w) => job(w) === "gold");
    for (const site of sites)
      if (
        !workers.some(
          (w) => w.order.type === "build" && w.order.target === site.id,
        )
      ) {
        const w = builder();
        if (w) order({ ids: [w.id], type: "resume", target: site.id });
      }
    const barracks = all.filter((e) => e.kind === "barracks"),
      altar = all.find((e) => e.kind === "altar"),
      farmsPending = sites.filter((e) => e.kind === "farm").length,
      upcoming = food - SPECS.farm.food * farmsPending;
    const want: BuildingKind | undefined = !barracks.length
      ? "barracks"
      : upcoming < AI.foodBuffer && pop.cap < FOOD_MAX && farmsPending < 2
        ? "farm"
        : !altar && gold > SPECS.altar.gold + AI.altarReserve
          ? "altar"
          : barracks.length < AI.barracks * Math.max(1, halls.length) &&
              !sites.some((e) => e.kind === "barracks") &&
              gold > AI.expandGold
            ? "barracks"
            : undefined;
    if (want) {
      const w = builder();
      if (w) {
        const pos = this.aiSite(want, [
          base,
          ...halls.filter((h) => h !== base),
        ]);
        if (pos && buy(want))
          order({ ids: [w.id], type: "build", kind: want, point: pos });
      }
    }
    // Expansion: once both barracks stand and a wave is out, a second
    // stronghold at the nearest free mine away from the enemy. Production
    // pauses while the hall is saved for, as a human player would.
    let saving = false;
    if (
      !want &&
      barracks.length >= AI.barracks &&
      halls.length < AI.halls &&
      !sites.some((e) => e.kind === "base") &&
      all.filter((e) => e.kind === "soldier" || e.kind === "archer").length >=
        AI.wave
    ) {
      const foes = this.own(enemy).filter((e) => e.kind === "base"),
        target = golds
          .filter(
            (g) =>
              hallGap(g) >= AI.mineReach &&
              g.amount > GOLD_MINE / 2 &&
              foes.every((f) => distance(g, f) > 45),
          )
          .sort(
            (a, b) => distance(a, base) - distance(b, base) || a.id - b.id,
          )[0],
        pos = target && this.aiExpansion(target, base);
      if (pos) {
        saving = true;
        const w = buy("base") && builder();
        if (w) order({ ids: [w.id], type: "build", kind: "base", point: pos });
      }
    }

    // Hero: train it at the altar, revive it when it falls, spend every
    // skill point and slam whenever enough enemies stand close.
    const hero = all.find((e) => e.hero),
      fallen = this.fallen[owner];
    if (altar?.progress === 1 && !altar.queue.length) {
      // Troops wait while the gold for the hero or its revival is saved.
      if (!this.hasHero(owner)) {
        if (buy("hero"))
          order({ ids: [altar.id], type: "train", kind: "hero" });
        else saving = true;
      } else if (fallen) {
        const cost = reviveCost(fallen.level);
        if (gold >= cost.gold && food >= SPECS.hero.food) {
          gold -= cost.gold;
          food -= SPECS.hero.food;
          order({ ids: [altar.id], type: "train", kind: "hero" });
        } else saving = true;
      }
    }
    if (hero?.hero) {
      const h = hero.hero;
      if (h.points && h.slam < SLAM.ranks && h.level >= slamLevel(h.slam + 1))
        order({ ids: [hero.id], type: "learn" });
      if (
        h.slam &&
        !h.recharge &&
        !hero.stun &&
        h.mana >= SLAM.mana &&
        this.roster().units.filter(
          (t) => t.owner === enemy && distance(t, hero) <= SLAM.radius,
        ).length >= AI.slamTargets
      )
        order({ ids: [hero.id], type: "cast" });
      // Losing the hero costs its revival and its experience lead, so a
      // badly hurt one retreats behind the stronghold and recovers.
      const max = specOf(hero).hp;
      if (!this.aiResting[owner] && hero.hp < max * AI.heroFlee) {
        this.aiResting[owner] = true;
        order({
          ids: [hero.id],
          type: "move",
          point: {
            x: base.x - Math.sign(SIZE / 2 - base.x) * 2,
            z: base.z - Math.sign(SIZE / 2 - base.z) * 6,
          },
        });
        this.record(owner, "retreat", this.label(hero));
      } else if (this.aiResting[owner] && hero.hp >= max * AI.heroRejoin)
        this.aiResting[owner] = false;
    } else this.aiResting[owner] = false;

    // Production: keep every barracks busy with a footman/archer mix.
    const army = all.filter(
        (e) =>
          e.kind === "soldier" ||
          e.kind === "archer" ||
          (e.kind === "hero" && !this.aiResting[owner]),
      ),
      archers = army.filter((e) => e.kind === "archer").length,
      rally = {
        x: base.x + Math.sign(SIZE / 2 - base.x) * 10,
        z: base.z + Math.sign(SIZE / 2 - base.z) * 10,
      };
    for (const b of barracks) {
      if (b.progress < 1 || saving) continue;
      if (!b.rally) order({ ids: [b.id], type: "rally", point: rally });
      if (b.queue.length >= 2) continue;
      const kind = archers * 2 < army.length ? "archer" : "soldier";
      if (buy(kind)) order({ ids: [b.id], type: "train", kind });
    }

    // Defence uses units near home; a raid only recalls the field army when
    // it outnumbers the defenders.
    const raiders = this.own(enemy).filter(
        (e) => isUnit(e.kind) && distance(e, base) < 20,
      ),
      home = army.filter((e) => distance(e, base) < 30),
      defenders = raiders.length > home.length ? army : home;
    if (raiders.length) {
      const free = defenders.filter((e) => e.order.type !== "attack");
      if (free.length)
        order({
          ids: free.map((e) => e.id),
          type: "attack",
          target: raiders[0].id,
        });
      return;
    }
    // Attack in growing groups; once the gold is gone, everything goes.
    const ready = home.filter((e) => e.order.type !== "assault"),
      broke = !mine && gold < SPECS.soldier.gold,
      size = Math.min(
        AI.waveMax,
        AI.wave + AI.waveGrowth * this.aiWaves[owner],
      );
    if (ready.length && (ready.length >= size || broke)) {
      const target = this.own(enemy).find((e) => e.kind === "base");
      if (target) {
        order({ ids: ready.map((e) => e.id), type: "assault", point: target });
        this.aiWaves[owner]++;
        this.record(
          owner,
          "wave",
          `${ready.length} units to ${this.label(target)} (army ${army.length}${broke ? ", all-in" : ""})`,
        );
      }
    }
  }
  // First legal spot on rings around a stronghold, on its own level: a site
  // below the plateau leaves the builder walking round the cliffs, and the
  // strips between cliffs and the map edge are narrow enough to trap it. When
  // the main base is full the next stronghold is tried. Sites are chosen in
  // the blue player's frame and point-reflected for red, so both sides lay out
  // identically (snap() rounds .5 upward, which would otherwise differ), and a
  // one-cell margin keeps AI buildings from sealing pockets that trap workers.
  aiSite(kind: BuildingKind, halls: Entity[]) {
    const half = SPECS[kind].size / 2;
    for (const base of halls) {
      const flip = base.x > SIZE / 2,
        frame = (p: Point) => (flip ? { x: SIZE - p.x, z: SIZE - p.z } : p),
        home = frame(base),
        tier = tierAt(base.x, base.z);
      for (let r = 8; r < 18; r += 2)
        for (let i = 0; i < 24; i++) {
          const pos = frame(
            this.snap(kind, {
              x: home.x + Math.cos((i * Math.PI) / 12) * r,
              z: home.z + Math.sin((i * Math.PI) / 12) * r,
            }),
          );
          if (tierAt(pos.x, pos.z) !== tier || this.placement(kind, pos))
            continue;
          let clear = true;
          for (let x = pos.x - half - 1; x < pos.x + half + 1 && clear; x++)
            for (let z = pos.z - half - 1; z < pos.z + half + 1 && clear; z++)
              if (this.nav.blocked(Math.floor(x), Math.floor(z))) clear = false;
          if (clear) return pos;
        }
    }
    return null;
  }
  // Closest legal stronghold spot beside a mine, on the mine's own level so
  // workers never walk round a cliff. Searched in the blue player's frame, like
  // aiSite, so both sides pick mirrored spots.
  aiExpansion(mine: Entity, home: Point) {
    const flip = home.x > SIZE / 2,
      frame = (p: Point) => (flip ? { x: SIZE - p.x, z: SIZE - p.z } : p),
      centre = frame(mine),
      from = frame(home),
      tier = tierAt(mine.x, mine.z),
      spots: Point[] = [];
    for (let r = 7; r <= 11; r += 2)
      for (let i = 0; i < 16; i++) {
        const blue = this.snap("base", {
            x: centre.x + Math.cos((i * Math.PI) / 8) * r,
            z: centre.z + Math.sin((i * Math.PI) / 8) * r,
          }),
          pos = frame(blue);
        if (tierAt(pos.x, pos.z) === tier && !this.placement("base", pos))
          spots.push(blue);
      }
    spots.sort(
      (a, b) => distance(a, from) - distance(b, from) || a.x - b.x || a.z - b.z,
    );
    return spots.length ? frame(spots[0]) : null;
  }
  assertInvariants() {
    for (const p of this.players)
      if (p.gold < 0 || p.wood < 0) throw Error("negative resources");
    for (const e of this.entities.values()) {
      if (
        !Number.isFinite(e.x + e.z + e.hp) ||
        e.carry < 0 ||
        e.carry > Math.max(GOLD_TRIP, WOOD_TRIP) ||
        e.amount < 0
      )
        throw Error(`invalid entity ${e.id}`);
      if (isUnit(e.kind) && !this.nav.canStand(e.x, e.z, 0.25))
        throw Error(`unit in obstacle ${e.id}`);
    }
  }
}
