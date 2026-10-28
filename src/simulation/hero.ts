import { SPECS, WC3, type Kind, type Spec } from "./config";
// Hero rules after Warcraft III: experience from nearby kills, ten levels,
// one skill point per level and a mana-fuelled active ability.
export interface Hero {
  level: number;
  xp: number;
  /** Unspent skill points. */
  points: number;
  /** Learned rank of the Quake Slam ability, 0 until learned. */
  slam: number;
  mana: number;
  /** Seconds until Quake Slam can be cast again. */
  recharge: number;
}
export const HERO_MAX_LEVEL = 10;
/** Total experience needed to reach each level (index 0 is level 1). */
export const HERO_XP = [0, 200, 500, 900, 1400, 2000, 2700, 3500, 4400, 5400];
/** Experience for a kill by the victim's unit level, and by a hero's level. */
const UNIT_XP = [0, 25, 40, 60, 85, 115];
const HERO_KILL_XP = [100, 120, 160, 220, 300, 400, 500, 600, 700, 800];
/** Heroes of the killer's side within this range share the experience. */
export const XP_RANGE = 1200 * WC3;
// Quake Slam: the hero strikes the ground, damaging and stunning enemy units
// around it. Spell damage ignores armour; heroes are stunned for half as long.
export const SLAM = {
  name: "Quake Slam",
  ranks: 3,
  damage: [70, 120, 170],
  stun: [2, 2.5, 3],
  radius: 250 * WC3,
  mana: 90,
  cooldown: 8,
};
/** A rank needs hero level 1, 3 and 5 respectively, as in WC3. */
export const slamLevel = (rank: number) => rank * 2 - 1;
export function heroSpec(level: number): Spec & { mana: number } {
  const s = SPECS.hero,
    n = level - 1;
  return {
    ...s,
    hp: s.hp + 65 * n,
    armor: s.armor + 0.5 * n,
    damage: [s.damage![0] + 2 * n, s.damage![1] + 2 * n],
    mana: 225 + 30 * n,
  };
}
/** Regeneration per second: unlike regular troops, heroes recover over time. */
export const heroRegen = (level: number) => ({
  hp: 1 + 0.1 * (level - 1),
  mana: 0.7 + 0.05 * (level - 1),
});
export function newHero(): Hero {
  return {
    level: 1,
    xp: 0,
    points: 1,
    slam: 0,
    mana: heroSpec(1).mana,
    recharge: 0,
  };
}
/** Stats of any entity: heroes use their level, everything else its kind. */
export function specOf(e: { kind: Kind; hero?: Hero }): Spec {
  return e.hero ? heroSpec(e.hero.level) : SPECS[e.kind];
}
export function killXp(victim: { kind: Kind; hero?: Hero }) {
  return victim.hero
    ? HERO_KILL_XP[victim.hero.level - 1]
    : UNIT_XP[SPECS[victim.kind].level ?? 0];
}
/** Adds experience and returns the number of levels gained. */
export function gainXp(hero: Hero, xp: number) {
  if (hero.level >= HERO_MAX_LEVEL) return 0;
  hero.xp = Math.min(HERO_XP[HERO_MAX_LEVEL - 1], hero.xp + xp);
  let gained = 0;
  while (hero.level < HERO_MAX_LEVEL && hero.xp >= HERO_XP[hero.level]) {
    hero.level++;
    hero.points++;
    gained++;
  }
  return gained;
}
/** Revival at the altar: price and time grow with the hero's level. */
export function reviveCost(level: number) {
  return {
    gold: Math.round(SPECS.hero.gold * (0.4 + 0.1 * (level - 1))),
    time: Math.min(110, SPECS.hero.time * (0.5 + 0.15 * (level - 1))),
  };
}
