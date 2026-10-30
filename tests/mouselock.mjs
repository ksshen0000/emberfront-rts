import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
// Pointer Lock path: virtual cursor, edge panning, HUD routing and Esc handling.
// Headless Chromium's real lock floods the page with emulated warp events and
// starves it, so the Pointer Lock API is stubbed: requestPointerLock/exit fire
// pointerlockchange, and movement arrives as pointermove events with deltas.
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
await page.addInitScript(() => {
  // The game skips auto-lock under automation; this test wants the real path.
  Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false });
  // Fullscreen would resize the headless window mid-test.
  Element.prototype.requestFullscreen = () => Promise.resolve();
  let lockElement = null;
  Object.defineProperty(Document.prototype, "pointerLockElement", {
    get: () => lockElement,
  });
  const change = (el) => {
    lockElement = el;
    document.dispatchEvent(new Event("pointerlockchange"));
  };
  Element.prototype.requestPointerLock = function () {
    if (!navigator.userActivation.isActive)
      return Promise.reject(new Error("gesture required"));
    setTimeout(() => change(this));
    return Promise.resolve();
  };
  Document.prototype.exitPointerLock = () => setTimeout(() => change(null));
  // Browsers release the lock themselves when Esc is pressed.
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape" && lockElement) change(null);
    },
    { capture: true },
  );
});
const state = () =>
  page.evaluate(() => {
    const t = getComputedStyle(
      document.getElementById("soft-cursor"),
    ).transform;
    return {
      locked: document.pointerLockElement?.id ?? null,
      confined: document.body.classList.contains("confined"),
      paused: window.rts.world.paused,
      modal: !document.getElementById("modal").hidden,
      focus: { ...window.rts.view.focus },
      cursor: t === "none" ? null : new DOMMatrix(t).m41,
    };
  });
// Moves the virtual pointer by a delta, split into plausible per-event steps.
const nudge = (dx, dy) =>
  page.evaluate(
    ([dx, dy]) => {
      const c = document.getElementById("battlefield"),
        n = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 200) || 1;
      for (let i = 0; i < n; i++)
        c.dispatchEvent(
          new PointerEvent("pointermove", {
            bubbles: true,
            movementX: dx / n,
            movementY: dy / n,
          }),
        );
    },
    [dx, dy],
  );
const press = (type, button = 0) =>
  page.evaluate(
    ([type, button]) =>
      document.getElementById("battlefield").dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          button,
          buttons: type === "pointerdown" ? 1 : 0,
          pointerId: 1,
        }),
      ),
    [type, button],
  );
// Locator geometry waits hang while the pointer is locked; read rects directly.
const rect = (selector) =>
  page.evaluate((selector) => {
    const r = document.querySelector(selector).getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }, selector);
const relock = async () => {
  await page.mouse.click(720, 420);
  await page.waitForFunction(
    () => document.pointerLockElement?.id === "battlefield",
  );
};
try {
  await page.goto("http://127.0.0.1:5173/?play");
  await page.waitForFunction(() => window.rts?.view);
  await page.mouse.move(720, 420);
  await relock();
  let s = await state();
  assert.equal(s.confined, true);
  assert.equal(s.paused, false);
  // Virtual pointer is clamped to the window and pans at the right edge.
  await nudge(5000, 0);
  const before = (await state()).focus;
  await page.waitForFunction(
    (x) => window.rts.view.focus.x > x + 0.5,
    before.x,
    { timeout: 10000 },
  );
  s = await state();
  assert.ok(s.cursor <= 1440 && s.cursor > 1400, `cursor x ${s.cursor}`);
  // Back in the middle the camera holds still.
  await nudge(-720, 0);
  await page.waitForTimeout(300);
  const held = (await state()).focus;
  await page.waitForTimeout(500);
  assert.deepEqual((await state()).focus, held);
  // A click on the HUD is routed to the button under the virtual pointer.
  const pauseBtn = await rect("#pause");
  const vp = await page.evaluate(() => {
    const t = new DOMMatrix(
      getComputedStyle(document.getElementById("soft-cursor")).transform,
    );
    return { x: t.m41 + 3, y: t.m42 + 2 };
  });
  await nudge(
    pauseBtn.x + pauseBtn.width / 2 - vp.x,
    pauseBtn.y + pauseBtn.height / 2 - vp.y,
  );
  await press("pointerdown");
  await press("pointerup");
  await page.waitForFunction(() => !document.pointerLockElement);
  s = await state();
  assert.equal(s.paused, true, "pause button via virtual pointer");
  assert.equal(s.modal, true);
  // Resuming re-confines the mouse.
  await page.getByRole("button", { name: "Resume battle" }).click();
  await page.waitForFunction(
    () => document.pointerLockElement?.id === "battlefield",
  );
  assert.equal((await state()).paused, false);
  // Minimap clicks through the lock move the camera.
  const map = await rect("#minimap");
  const vp2 = await page.evaluate(() => {
    const t = new DOMMatrix(
      getComputedStyle(document.getElementById("soft-cursor")).transform,
    );
    return { x: t.m41 + 3, y: t.m42 + 2 };
  });
  await nudge(
    map.x + map.width * 0.75 - vp2.x,
    map.y + map.height * 0.25 - vp2.y,
  );
  await press("pointerdown");
  await press("pointerup");
  s = await state();
  assert.ok(
    Math.abs(s.focus.x - 96) < 3 && Math.abs(s.focus.z - 96) < 3,
    JSON.stringify(s.focus),
  );
  // Esc releases the mouse and pauses exactly once.
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.pointerLockElement);
  await page.waitForTimeout(200);
  s = await state();
  assert.equal(s.paused, true, "Esc pauses");
  assert.equal(s.confined, false);
  // The option turns confinement off.
  await page.locator("#confine").uncheck();
  await page.getByRole("button", { name: "Resume battle" }).click();
  await page.mouse.click(720, 420);
  await page.waitForTimeout(500);
  assert.equal((await state()).locked, null);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: mouse lock, virtual cursor, edge pan, HUD and minimap routing, Esc pause, opt-out",
  );
} finally {
  await browser.close();
}
