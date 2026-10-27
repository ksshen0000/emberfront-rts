import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
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
try {
  await page.goto("http://127.0.0.1:5173");
  await page.waitForFunction(() => window.rts?.view);
  await page.mouse.move(900, 400);
  const snapshot = () =>
    page.evaluate(() => {
      const v = window.rts.view,
        c = v.camera;
      c.getViewMatrix(true);
      return {
        alpha: c.alpha,
        beta: c.beta,
        radius: c.radius,
        focus: { ...v.focus },
        zoom: v.zoom,
        position: { x: c.position.x, y: c.position.y, z: c.position.z },
        offset: c.position.subtract(c.target).asArray(),
        ortho: [c.orthoLeft, c.orthoRight, c.orthoTop, c.orthoBottom],
      };
    });
  const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);
  const initial = await snapshot();
  const fixed = (s) => {
    near(s.alpha, initial.alpha);
    near(s.beta, initial.beta);
    near(s.radius, initial.radius);
    s.offset.forEach((n, i) => near(n, initial.offset[i]));
  };
  for (const [key, axis, sign] of [
    ["ArrowRight", "x", 1],
    ["ArrowLeft", "x", -1],
    ["ArrowUp", "z", 1],
    ["ArrowDown", "z", -1],
  ]) {
    const before = await snapshot();
    await page.keyboard.down(key);
    await page.waitForFunction(
      ({ axis, start, sign }) =>
        (window.rts.view.focus[axis] - start) * sign > 0,
      { axis, start: before.focus[axis], sign },
      { timeout: 10000 },
    );
    await page.keyboard.up(key);
    const after = await snapshot();
    fixed(after);
    assert.ok((after.focus[axis] - before.focus[axis]) * sign > 0);
    near(
      after.focus[axis === "x" ? "z" : "x"],
      before.focus[axis === "x" ? "z" : "x"],
    );
    near(after.zoom, before.zoom);
  }
  for (const delta of [400, -800, 100000, -100000]) {
    const before = await snapshot();
    await page.mouse.wheel(0, delta);
    await page.waitForFunction(
      (expected) => Math.abs(window.rts.view.zoom - expected) < 1e-6,
      Math.max(10, Math.min(45, before.zoom + delta * 0.02)),
    );
    const after = await snapshot();
    fixed(after);
    assert.deepEqual(after.focus, before.focus);
    near(after.position.x, before.position.x);
    near(after.position.y, before.position.y);
    near(after.position.z, before.position.z);
    near(after.zoom, Math.max(10, Math.min(45, before.zoom + delta * 0.02)));
    near(after.ortho[2], after.zoom);
    near(after.ortho[3], -after.zoom);
  }
  const map = await page.locator("#minimap").boundingBox();
  await page.mouse.click(map.x + map.width * 0.8, map.y + map.height * 0.25);
  fixed(await snapshot());
  await page.locator("#home").click();
  fixed(await snapshot());
  await page.keyboard.press("Space");
  fixed(await snapshot());
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.waitForTimeout(150);
  fixed(await snapshot());
  // Edge panning and map limits must translate the same fixed camera offset.
  await page.mouse.move(1196, 400);
  await page.waitForTimeout(300);
  fixed(await snapshot());
  await page.mouse.move(700, 400);
  await page.evaluate(() => {
    window.rts.view.focus = { x: 1000, z: -1000 };
    window.rts.view.updateCamera();
  });
  const clamped = await snapshot();
  fixed(clamped);
  assert.deepEqual(clamped.focus, { x: 125, z: 3 });
  await page.getByRole("button", { name: "Pause game" }).click();
  await page.getByRole("button", { name: "New battle" }).click();
  fixed(await snapshot());
  assert.deepEqual(errors, []);
  console.log(
    "PASS: fixed camera angles and distance across four arrows, scroll zoom/limits, minimap, home, focus, resize, edge pan, map limits and restart.",
  );
} finally {
  await browser.close();
}
