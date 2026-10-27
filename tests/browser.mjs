import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
const browser = await chromium.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto("http://127.0.0.1:5173");
  await page.waitForFunction(() => window.rts?.world);
  await page.waitForTimeout(2000);
  console.log(
    "boot",
    await page.evaluate(() => ({
      entities: window.rts.world.entities.size,
      meshes: window.rts.view.scene.meshes.length,
      webgl: window.rts.view.engine.webGLVersion,
    })),
  );
  await page.screenshot({ path: join(tmpdir(), "rts-initial.png") });
  const base = await page.evaluate(() => {
    const e = window.rts.world.own(0).find((e) => e.kind === "base");
    return window.rts.view.project(e);
  });
  await page.mouse.click(base.x, base.y - 25);
  await page.waitForTimeout(200);
  assert.match(
    await page.locator("#selection-content").innerText(),
    /Stronghold/,
  );
  await page.getByRole("button", { name: "Train worker" }).click();
  await page.waitForTimeout(200);
  assert.equal(
    await page.evaluate(() => window.rts.world.population(0).reserved),
    1,
  );
  await page.locator("#queue button").click();
  // Software WebGL renders only a few frames per second; wait on state, not time.
  await page.waitForFunction(
    () => window.rts.world.population(0).reserved === 0,
    null,
    { timeout: 5000 },
  );
  // Real pointer selects a worker and right clicks the gold mine.
  const points = await page.evaluate(() => {
    const r = window.rts,
      w = r.world;
    return {
      worker: r.view.project(w.own(0).find((e) => e.kind === "worker")),
      mine: r.view.project(
        [...w.entities.values()].find((e) => e.kind === "gold"),
      ),
    };
  });
  await page.mouse.click(points.worker.x, points.worker.y - 6);
  await page.waitForTimeout(150);
  assert.match(await page.locator("#selection-content").innerText(), /Worker/);
  await page.mouse.click(points.mine.x, points.mine.y - 12, {
    button: "right",
  });
  // Orders apply on the next simulation step; wait for it rather than a fixed delay.
  await page.waitForFunction(
    () =>
      window.rts.world.own(0).find((e) => e.kind === "worker").order.type ===
      "gather",
    null,
    { timeout: 5000 },
  );
  // Placement UI, then advance the same simulation clock to avoid waiting 80 real seconds.
  await page.getByRole("button", { name: /Barracks/ }).click();
  const place = await page.evaluate(() =>
    window.rts.view.project({ x: 34.5, z: 24.5 }),
  );
  await page.mouse.move(place.x, place.y);
  await page.mouse.click(place.x, place.y);
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    for (let i = 0; i < 1600; i++) window.rts.world.step();
  });
  await page.waitForTimeout(200);
  assert.equal(
    await page.evaluate(
      () =>
        window.rts.world.own(0).find((e) => e.kind === "barracks")?.progress,
    ),
    1,
  );
  const barracks = await page.evaluate(() =>
    window.rts.view.project(
      window.rts.world.own(0).find((e) => e.kind === "barracks"),
    ),
  );
  await page.mouse.click(barracks.x, barracks.y - 20);
  await page.waitForTimeout(200);
  await page.getByRole("button", { name: /Train soldier/ }).click();
  await page.waitForTimeout(100);
  await page.evaluate(() => {
    for (let i = 0; i < 440; i++) window.rts.world.step();
  });
  assert.equal(
    await page.evaluate(
      () => window.rts.world.own(0).filter((e) => e.kind === "soldier").length,
    ),
    1,
  );
  await page.getByRole("button", { name: "Pause game" }).click();
  const t = await page.evaluate(() => window.rts.world.time);
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.rts.world.time), t);
  await page.getByRole("button", { name: "Resume battle" }).click();
  await page.screenshot({ path: join(tmpdir(), "rts-gameplay.png") });
  // Result screen is connected to the real death/victory system.
  await page.evaluate(() => {
    const w = window.rts.world;
    w.own(1).find((e) => e.kind === "base").hp = 0;
    w.step();
  });
  await page.waitForTimeout(200);
  assert.match(
    await page.locator("#modal-title").innerText(),
    /frontier is yours/,
  );
  // Entity meshes are rebuilt by the next rendered frame after a restart.
  const synced = () =>
    page.waitForFunction(
      () =>
        window.rts.world.entities.size > 0 &&
        window.rts.view.views.size === window.rts.world.entities.size,
      null,
      { timeout: 10000 },
    );
  await page.getByRole("button", { name: "New battle" }).click();
  await synced();
  const count = await page.evaluate(() => window.rts.view.scene.meshes.length);
  for (let i = 0; i < 10; i++) {
    await page.getByRole("button", { name: "Pause game" }).click();
    await page.getByRole("button", { name: "New battle" }).click();
    await page.waitForTimeout(100);
  }
  await synced();
  assert.equal(
    await page.evaluate(() => window.rts.world.population(0).used),
    5,
  );
  assert.equal(
    await page.evaluate(() => window.rts.view.scene.meshes.length),
    count,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: pointer selection, gather, build, train/cancel, pause, victory, ten restarts; no page errors",
  );
} finally {
  await browser.close();
}
