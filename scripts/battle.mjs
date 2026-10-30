// Headless AI-vs-AI battle: runs the real simulation with both sides on the
// built-in AI and writes a readable battle log for debugging.
// Usage: npm run battle -- [--minutes 30] [--seed 1] [--games 1] [--map emerald] [--factions crown,orc]
import { createServer } from "vite";
import { mkdirSync, writeFileSync } from "node:fs";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
};
const minutes = arg("minutes", 30),
  firstSeed = arg("seed", 1),
  games = arg("games", 1),
  mapIndex = process.argv.indexOf("--map"),
  map = mapIndex > 0 ? process.argv[mapIndex + 1] : "emerald",
  factionIndex = process.argv.indexOf("--factions"),
  factions =
    factionIndex > 0
      ? process.argv[factionIndex + 1].split(",")
      : ["crown", "crown"];

const vite = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  logLevel: "error",
});
const { World } = await vite.ssrLoadModule("/src/simulation/world.ts");
const { STEP } = await vite.ssrLoadModule("/src/simulation/config.ts");
mkdirSync("logs", { recursive: true });

const fmt = (t) =>
  `${String(Math.floor(t / 60)).padStart(2, "0")}:${(t % 60).toFixed(2).padStart(5, "0")}`;
const side = ["BLUE", "RED ", "----"];

for (let g = 0; g < games; g++) {
  const seed = firstSeed + g,
    w = new World(map, factions);
  w.seed = seed;
  w.aiPlayers = [0, 1];
  w.logging = true;
  const started = performance.now(),
    steps = Math.round((minutes * 60) / STEP);
  let error = null;
  for (let i = 0; i < steps && !w.result; i++) {
    w.step();
    if (i % 200 === 0)
      try {
        w.assertInvariants();
      } catch (e) {
        error = e;
        w.record(2, "invariant", String(e.message));
        break;
      }
  }
  for (const owner of [0, 1]) w.snapshot(owner);
  const lines = w.log.map(
    (e) => `${fmt(e.t)} ${side[e.owner]} ${e.event.padEnd(9)} ${e.detail}`,
  );
  const file = `logs/battle-${seed}.log`;
  writeFileSync(file, lines.join("\n") + "\n");

  const counts = {};
  for (const e of w.log) {
    const key = `${side[e.owner].trim()} ${e.event}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  const warnings = {};
  for (const e of w.log.filter((e) => e.event === "warn")) {
    const key = `${side[e.owner].trim()}: ${e.detail}`;
    warnings[key] = (warnings[key] ?? 0) + 1;
  }
  console.log(
    `\n=== game ${g + 1} seed ${seed}: ${w.result ? `${w.result === "win" ? "BLUE wins" : w.result === "loss" ? "RED wins" : "draw"}` : "no result"} at ${fmt(w.time)} (${((performance.now() - started) / 1000).toFixed(1)}s real) → ${file}`,
  );
  if (error) console.log("INVARIANT FAILED:", error.message);
  console.table(
    Object.fromEntries(
      [0, 1].map((o) => [
        side[o].trim(),
        { ...w.stats[o], damage: Math.round(w.stats[o].damage) },
      ]),
    ),
  );
  console.log("events:", JSON.stringify(counts));
  console.log("warnings:", JSON.stringify(warnings, null, 1));
}
await vite.close();
