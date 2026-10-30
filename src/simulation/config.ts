export type Kind =
  | "worker"
  | "soldier"
  | "archer"
  | "hero"
  | "base"
  | "farm"
  | "barracks"
  | "altar"
  | "gold"
  | "tree"
  | "rock";
export type UnitKind = "worker" | "soldier" | "archer" | "hero";
export type BuildingKind = "farm" | "barracks" | "base" | "altar";
export type AttackType = "normal" | "pierce" | "hero";
export type ArmorType = "medium" | "heavy" | "fortified" | "hero" | "none";
export interface Spec {
  name: string;
  hp: number;
  size: number;
  gold: number;
  wood: number;
  time: number;
  food: number;
  armor: number;
  armorType: ArmorType;
  speed?: number;
  damage?: [number, number];
  attack?: AttackType;
  range?: number;
  cooldown?: number;
  /** Fog-of-war reveal radius in world units, tuned for this 128-unit map. */
  sight?: number;
  /** WC3 unit level; decides the experience a hero earns for the kill. */
  level?: number;
}
// Stats follow Warcraft III (Reforged): Worker = Peasant, Soldier = Footman,
// Archer = Night Elf Archer, Commander = a strength hero such as the Paladin,
// Stronghold = Town Hall, Altar = Altar of Kings. Distances and speeds are
// given in WC3 units and scaled to world units.
export const WC3 = 1 / 80;
const MELEE = 90 * WC3;
export const SPECS: Record<Kind, Spec> = {
  worker: {
    name: "Worker",
    hp: 240,
    size: 0.7,
    gold: 75,
    wood: 0,
    time: 15,
    food: 1,
    armor: 0,
    armorType: "medium",
    speed: 190 * WC3,
    damage: [5, 6],
    attack: "normal",
    range: MELEE,
    cooldown: 2,
    sight: 9,
    level: 1,
  },
  soldier: {
    name: "Soldier",
    hp: 420,
    size: 0.7,
    gold: 135,
    wood: 0,
    time: 20,
    food: 2,
    armor: 2,
    armorType: "heavy",
    speed: 270 * WC3,
    damage: [12, 13],
    attack: "normal",
    range: MELEE,
    cooldown: 1.35,
    sight: 11,
    level: 2,
  },
  archer: {
    name: "Archer",
    hp: 275,
    size: 0.7,
    gold: 130,
    wood: 10,
    time: 20,
    food: 2,
    armor: 0,
    armorType: "medium",
    speed: 270 * WC3,
    damage: [16, 18],
    attack: "pierce",
    range: 500 * WC3,
    cooldown: 1.5,
    sight: 13,
    level: 2,
  },
  // Level 1 figures; heroSpec() in hero.ts grows them with each level.
  hero: {
    name: "Commander",
    hp: 650,
    size: 0.7,
    gold: 425,
    wood: 100,
    time: 55,
    food: 5,
    armor: 4,
    armorType: "hero",
    speed: 270 * WC3,
    damage: [24, 34],
    attack: "hero",
    range: MELEE,
    cooldown: 2.2,
    sight: 14,
  },
  base: {
    name: "Stronghold",
    hp: 1500,
    size: 6,
    // Town Hall: built by workers to open an expansion and as a drop-off.
    gold: 385,
    wood: 205,
    time: 180,
    food: -12,
    armor: 5,
    armorType: "fortified",
    sight: 14,
  },
  farm: {
    name: "Farm",
    hp: 500,
    size: 3,
    gold: 80,
    wood: 20,
    time: 35,
    food: -6,
    armor: 5,
    armorType: "fortified",
    sight: 8,
  },
  barracks: {
    name: "Barracks",
    hp: 1500,
    size: 5,
    gold: 160,
    wood: 60,
    time: 60,
    food: 0,
    armor: 5,
    armorType: "fortified",
    sight: 10,
  },
  altar: {
    name: "Altar",
    hp: 900,
    size: 4,
    gold: 180,
    wood: 50,
    time: 60,
    food: 0,
    armor: 5,
    armorType: "fortified",
    sight: 9,
  },
  gold: resource("Gold mine", 4),
  tree: resource("Trees", 2),
  rock: resource("Rock", 3),
};
function resource(name: string, size: number): Spec {
  return {
    name,
    hp: 1,
    size,
    gold: 0,
    wood: 0,
    time: 0,
    food: 0,
    armor: 0,
    armorType: "none",
  };
}
// WC3 attack type vs armor type table.
const MULTIPLIER: Record<AttackType, Record<ArmorType, number>> = {
  normal: { medium: 1.5, heavy: 1, fortified: 0.7, hero: 1, none: 1 },
  pierce: { medium: 0.75, heavy: 1, fortified: 0.35, hero: 0.5, none: 1.5 },
  hero: { medium: 1, heavy: 1, fortified: 0.5, hero: 1, none: 1 },
};
export const FOOD_MAX = 100,
  START = { gold: 500, wood: 150 },
  GOLD_MINE = 12500,
  QUEUE_MAX = 7,
  // Peasant harvesting: 10 gold per trip; lumber at 1 per chop, 10 per trip.
  GOLD_TRIP = 10,
  GOLD_TIME = 1,
  WOOD_TRIP = 10,
  WOOD_CHOP = 1,
  WOOD_TIME = 1;
export function damageAgainst(attacker: Spec, roll: number, target: Spec) {
  const [min, max] = attacker.damage!,
    base = min + Math.floor(roll * (max - min + 1)),
    a = target.armor,
    reduction = a >= 0 ? (0.06 * a) / (1 + 0.06 * a) : -(1 - 0.94 ** -a);
  return (
    base * MULTIPLIER[attacker.attack!][target.armorType] * (1 - reduction)
  );
}
export const SIZE = 128,
  STEP = 0.05;
export interface Point {
  x: number;
  z: number;
}
export const distance = (a: Point, b: Point) =>
  Math.hypot(a.x - b.x, a.z - b.z);
export const isUnit = (kind: Kind): kind is UnitKind => !!SPECS[kind].speed;
const BUILDINGS = new Set<Kind>(["base", "farm", "barracks", "altar"]);
export const isBuilding = (kind: Kind) => BUILDINGS.has(kind);
// Factions share one tech layout (worker, melee, ranged and hero; hall, food
// building, barracks and altar), so every rule and the AI work for all of
// them. Each overrides names, stats and costs on top of the Crownguard values
// above. Footprints and food stay common so placement and supply match.
export type FactionId = "crown" | "orc" | "elf";
export interface Faction {
  id: FactionId;
  name: string;
  crest: string;
  blurb: string;
  specs: Partial<Record<Kind, Partial<Spec>>>;
}
export const FACTIONS: Record<FactionId, Faction> = {
  crown: {
    id: "crown",
    name: "Crownguard",
    crest: "♜",
    blurb: "Sturdy footmen and archers led by a hammer-wielding Commander.",
    specs: {},
  },
  orc: {
    id: "orc",
    name: "Ironhide Clans",
    crest: "⚒",
    blurb: "Hard-hitting brutes and spear throwers; the Warlord's War Cry.",
    specs: {
      worker: { name: "Laborer", hp: 250 },
      soldier: {
        name: "Brute",
        hp: 520,
        gold: 150,
        armor: 2,
        damage: [15, 18],
        cooldown: 1.5,
        speed: 250 * WC3,
      },
      archer: {
        name: "Spear Thrower",
        hp: 320,
        gold: 135,
        wood: 20,
        damage: [21, 25],
        range: 450 * WC3,
        cooldown: 1.9,
        speed: 260 * WC3,
      },
      hero: {
        name: "Warlord",
        hp: 720,
        armor: 3,
        damage: [27, 37],
        cooldown: 2.3,
        speed: 260 * WC3,
      },
      base: { name: "Warhold", hp: 1700 },
      farm: { name: "Longhouse", hp: 550 },
      barracks: { name: "War Camp", hp: 1600 },
      altar: { name: "Totem Ring", hp: 950 },
    },
  },
  elf: {
    id: "elf",
    name: "Sylvan Wardens",
    crest: "❦",
    blurb: "Swift bladedancers and far-reaching longbows; the Moonseer heals.",
    specs: {
      worker: { name: "Tender", hp: 220, speed: 200 * WC3 },
      soldier: {
        name: "Bladedancer",
        hp: 360,
        gold: 125,
        time: 18,
        armor: 1,
        armorType: "medium",
        damage: [11, 13],
        cooldown: 1.1,
        speed: 300 * WC3,
        sight: 12,
      },
      archer: {
        name: "Longbow",
        hp: 245,
        gold: 135,
        wood: 20,
        damage: [15, 17],
        range: 600 * WC3,
        cooldown: 1.45,
        speed: 280 * WC3,
        sight: 15,
      },
      hero: {
        name: "Moonseer",
        hp: 560,
        armor: 3,
        damage: [20, 28],
        range: 500 * WC3,
        cooldown: 1.8,
        speed: 290 * WC3,
        sight: 15,
      },
      base: { name: "Heartwood", hp: 1400 },
      farm: { name: "Seedhome", hp: 450 },
      barracks: { name: "Glade Hall", hp: 1400 },
      altar: { name: "Starstone", hp: 850 },
    },
  },
};
const merged = new Map<string, Spec>();
/** Stats of a kind as fielded by a faction. */
export function spec(kind: Kind, faction: FactionId = "crown"): Spec {
  const key = `${faction}:${kind}`;
  let s = merged.get(key);
  if (!s) {
    s = { ...SPECS[kind], ...FACTIONS[faction].specs[kind] };
    merged.set(key, s);
  }
  return s;
}
