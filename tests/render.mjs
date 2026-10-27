import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
// Draw-call budget for a mid-game AI vs AI scene. Entity models are instanced,
// so the count should stay roughly flat as armies grow.
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
  await page.goto("http://127.0.0.1:5173/?spectate");
  await page.waitForFunction(() => window.rts?.view);
  const result = await page.evaluate(async () => {
    const w = window.rts.world,
      v = window.rts.view;
    for (let i = 0; i < 3600; i++) w.step();
    w.paused = true;
    const units = w.own(0);
    v.focus = {
      x: units.reduce((s, e) => s + e.x, 0) / units.length,
      z: units.reduce((s, e) => s + e.z, 0) / units.length,
    };
    v.zoom = 30;
    v.updateCamera();
    await new Promise((r) => setTimeout(r, 1500));
    const gl = v.engine._gl,
      names = ["drawElements", "drawElementsInstanced", "drawArrays"],
      originals = names.map((n) => gl[n]);
    let calls = 0;
    names.forEach((n, i) => {
      gl[n] = (...args) => {
        calls++;
        return originals[i].apply(gl, args);
      };
    });
    // Count rendered frames only; paused frames are throttled and skipped.
    let frames = 0;
    const counter = v.scene.onAfterRenderObservable.add(() => frames++);
    await new Promise((r) => setTimeout(r, 3000));
    v.scene.onAfterRenderObservable.remove(counter);
    names.forEach((n, i) => (gl[n] = originals[i]));
    return {
      entities: w.entities.size,
      meshes: v.scene.meshes.length,
      frames,
      drawCalls: Math.round(calls / frames),
    };
  });
  console.log(result);
  assert.ok(result.frames > 0, "no frames rendered");
  assert.ok(result.drawCalls < 200, `${result.drawCalls} draw calls per frame`);
  assert.deepEqual(errors, []);
  console.log("PASS: mid-game draw calls within budget");
} finally {
  await browser.close();
}
