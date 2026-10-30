import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
// Start menu: faction and map choice, starting, returning to the menu and
// switching maps (which reloads the page with the choice carried over).
const browser = await chromium.launch({
  headless: true,
  args: [
    "--no-sandbox",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const time = () => page.evaluate(() => window.rts.world.time);
try {
  await page.goto("http://127.0.0.1:5173/");
  await page.waitForFunction(() => window.rts?.world);
  assert.equal(await page.locator("#menu").isVisible(), true);
  assert.equal(await page.locator("#menu-factions .menu-card").count(), 3);
  assert.equal(await page.locator("#menu-enemy .menu-card").count(), 3);
  assert.equal(await page.locator("#menu-maps .menu-card").count(), 2);
  await page.waitForTimeout(800);
  assert.equal(await time(), 0, "the battle waits behind the menu");
  // Same map: the battle starts in place, with the chosen factions.
  await page
    .locator("#menu-factions .menu-card", { hasText: "Ironhide" })
    .click();
  await page.locator("#menu-enemy .menu-card", { hasText: "Sylvan" }).click();
  await page.locator("#menu-maps .menu-card", { hasText: "Emerald" }).click();
  await page.locator("#menu-start").click();
  assert.equal(await page.locator("#menu").isVisible(), false);
  assert.deepEqual(await page.evaluate(() => window.rts.world.factions), [
    "orc",
    "elf",
  ]);
  assert.match(
    await page.locator(".statusline").innerText(),
    /Ironhide Clans \(Azure\) vs Sylvan Wardens \(Ember\)/,
  );
  assert.equal(
    await page.evaluate(
      () => window.rts.world.own(0).find((e) => e.kind === "base").faction,
    ),
    "orc",
  );
  await page.waitForFunction(() => window.rts.world.time > 0.5);
  assert.equal(await page.locator("#modal").isVisible(), false);
  // Pause, back to the menu, and on to the other map.
  await page.keyboard.press("Escape");
  await page.locator("#main-menu").click();
  assert.equal(await page.locator("#menu").isVisible(), true);
  assert.equal(await page.locator("#modal").isVisible(), false);
  await page
    .locator("#menu-maps .menu-card", { hasText: "Stonewatch" })
    .click();
  await Promise.all([
    page.waitForEvent("load"),
    page.locator("#menu-start").click(),
  ]);
  await page.waitForFunction(() => window.rts?.world?.map === "stonewatch");
  assert.equal(await page.locator("#menu").isVisible(), false);
  // The factions survive the reload.
  assert.deepEqual(await page.evaluate(() => window.rts.world.factions), [
    "orc",
    "elf",
  ]);
  await page.waitForFunction(() => window.rts.world.time > 0.5);
  assert.match(
    await page.locator(".minimap-panel .panel-heading").innerText(),
    /Stonewatch Basin/,
  );
  // A fresh visit opens the menu on the map chosen last time.
  await page.reload();
  await page.waitForFunction(() => window.rts?.world);
  assert.equal(await page.locator("#menu").isVisible(), true);
  assert.equal(await page.evaluate(() => window.rts.world.map), "stonewatch");
  assert.equal(
    await page
      .locator("#menu-maps .menu-card", { hasText: "Stonewatch" })
      .getAttribute("aria-pressed"),
    "true",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: start menu, faction/opponent/map choice, main menu, map switch, remembered choices",
  );
} finally {
  await browser.close();
}
