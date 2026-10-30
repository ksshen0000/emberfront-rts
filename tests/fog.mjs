import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Fog of war in the real renderer: hidden enemies, remembered buildings,
// picking, minimap fog and spectator mode. Needs the dev server on 5173.
const browser = await chromium.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
// Entity views are rebuilt on rendered frames; wait for a couple of them.
const frames = (n = 3) =>
  page.evaluate(
    (n) =>
      new Promise((resolve) => {
        let left = n;
        const o = window.rts.view.scene.onAfterRenderObservable.add(() => {
          if (--left === 0) {
            window.rts.view.scene.onAfterRenderObservable.remove(o);
            resolve();
          }
        });
      }),
    n,
  );
const shown = (id) =>
  page.evaluate((id) => {
    const v = window.rts.view.views.get(id);
    return v ? v.root.isEnabled() : null;
  }, id);
try {
  await page.goto("http://127.0.0.1:5173/?play");
  await page.waitForFunction(() => window.rts?.view);
  await frames();
  const start = await page.evaluate(() => {
    const w = window.rts.world;
    w.aiEnabled = false;
    const base = w.own(1).find((e) => e.kind === "base");
    return {
      base: base.id,
      workers: w
        .own(1)
        .filter((e) => e.kind === "worker")
        .map((e) => e.id),
    };
  });
  // Nothing of the enemy is drawn before scouting.
  assert.equal(await shown(start.base), false, "enemy base hidden at start");
  for (const id of start.workers) assert.equal(await shown(id), false);
  // Minimap: the enemy corner is fogged, the home corner is clear.
  const pixel = (x, y) =>
    page.evaluate(
      ([x, y]) => [
        ...document
          .getElementById("minimap")
          .getContext("2d")
          .getImageData(x, y, 1, 1).data,
      ],
      [x, y],
    );
  const home = await pixel(34, 146),
    enemy = await pixel(146, 34);
  assert.ok(
    home[0] + home[1] + home[2] > 3 * (enemy[0] + enemy[1] + enemy[2]),
    `minimap fog ${home} vs ${enemy}`,
  );
  // A hidden enemy unit cannot be picked, even when the camera looks right at it.
  const hiddenPick = await page.evaluate(() => {
    const w = window.rts.world,
      v = window.rts.view,
      e = w.spawn("soldier", 1, 76, 32);
    v.focus = { x: 76, z: 32 };
    v.updateCamera();
    return e.id;
  });
  await frames();
  const picked = await page.evaluate((id) => {
    const v = window.rts.view,
      p = v.project(window.rts.world.entities.get(id));
    return v.pick(p.x, p.y - 15).id;
  }, hiddenPick);
  assert.notEqual(picked, hiddenPick, "hidden enemy is not pickable");
  // Scouting reveals the settlement and its workers.
  const scout = await page.evaluate(() => {
    const w = window.rts.world,
      v = window.rts.view,
      farm = w.spawn("farm", 1, 96.5, 110.5);
    w.rebuild();
    const s = w.spawn("archer", 0, 92, 100);
    w.updateFog();
    v.focus = { x: 98, z: 100 };
    v.updateCamera();
    return { scout: s.id, farm: farm.id };
  });
  await frames();
  assert.equal(await shown(start.base), true, "base visible when scouted");
  assert.equal(await shown(scout.farm), true);
  assert.ok(
    (await Promise.all(start.workers.map(shown))).some(Boolean),
    "a worker seen",
  );
  await page.screenshot({ path: join(tmpdir(), "rts-fog-scouted.png") });
  // The scout leaves and the farm burns down unseen: units vanish, buildings
  // stay as last seen, and the farm only disappears once the spot is seen again.
  await page.evaluate(({ scout, farm }) => {
    const w = window.rts.world;
    w.remove(w.entities.get(scout));
    w.remove(w.entities.get(farm));
    w.updateFog();
  }, scout);
  await frames();
  for (const id of start.workers)
    assert.equal(await shown(id), false, "workers hidden again");
  assert.equal(await shown(start.base), true, "base remembered");
  assert.equal(
    await shown(scout.farm),
    true,
    "destroyed farm still remembered",
  );
  await page.evaluate(() => {
    window.rts.world.spawn("archer", 0, 92, 104);
    window.rts.world.updateFog();
  });
  await frames();
  assert.equal(await shown(scout.farm), null, "re-scouted farm is gone");
  // Spectators see everything.
  await page.goto("http://127.0.0.1:5173/?spectate");
  await page.waitForFunction(() => window.rts?.view);
  await frames();
  const spectated = await page.evaluate(() => {
    const w = window.rts.world,
      v = window.rts.view;
    return w.own(1).every((e) => v.views.get(e.id)?.root.isEnabled());
  });
  assert.equal(spectated, true, "spectator sees the enemy");
  assert.deepEqual(errors, []);
  console.log(
    "PASS: fog hides enemies, scouting reveals, last-seen buildings, picking, minimap, spectator view",
  );
} finally {
  await browser.close();
}
