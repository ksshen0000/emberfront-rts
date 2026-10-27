export type Kind =
  | "worker"
  | "soldier"
  | "archer"
  | "base"
  | "farm"
  | "barracks"
  | "gold"
  | "tree"
  | "rock";
export type UnitKind = "worker" | "soldier" | "archer";
export type BuildingKind = "farm" | "barracks";
export type AttackType = "normal" | "pierce";
export type ArmorType = "medium" | "heavy" | "fortified" | "none";
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
}
// Stats follow Warcraft III (Reforged): Worker = Peasant, Soldier = Footman,
// Archer = Night Elf Archer, Stronghold = Town Hall. Distances and speeds are
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
  },
  base: {
    name: "Stronghold",
    hp: 1500,
    size: 6,
    gold: 0,
    wood: 0,
    time: 0,
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
  normal: { medium: 1.5, heavy: 1, fortified: 0.7, none: 1 },
  pierce: { medium: 0.75, heavy: 1, fortified: 0.35, none: 1.5 },
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
const BUILDINGS = new Set<Kind>(["base", "farm", "barracks"]);
export const isBuilding = (kind: Kind) => BUILDINGS.has(kind);
