import { it, expect } from "vitest";
import { World } from "../src/simulation/world";
it("records simulation performance at the 100-unit budget", () => {
  const world = new World();
  world.aiEnabled = false;
  for (const e of [...world.entities.values()])
    if (e.kind === "worker") world.entities.delete(e.id);
  const ids: number[] = [];
  for (let i = 0; i < 100; i++)
    ids.push(
      world.spawn(
        "soldier",
        i < 50 ? 0 : 1,
        48.5 + (i % 10) * 1.1,
        12.5 + Math.floor(i / 10) * 1.1,
      ).id,
    );
  world.submit({
    player: 0,
    ids: ids.slice(0, 50),
    type: "assault",
    point: { x: 65, z: 30 },
  });
  world.submit({
    player: 1,
    ids: ids.slice(50),
    type: "assault",
    point: { x: 65, z: 15 },
  });
  const timings: number[] = [];
  for (let i = 0; i < 1800; i++) {
    const start = performance.now();
    world.step();
    timings.push(performance.now() - start);
    if (i % 100 === 0) world.assertInvariants();
  }
  timings.sort((a, b) => a - b);
  console.log(
    JSON.stringify({
      scenario: "100-unit battle, 90 simulated seconds",
      p50ms: timings[900],
      p95ms: timings[1710],
      maxMs: timings.at(-1),
    }),
  );
  expect(timings[1710]).toBeLessThan(50);
});
