import { _electron as electron } from "@playwright/test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
// Launches the Electron shell on the current build (npm run build first).
// DESKTOP_EXECUTABLE=path/to/Emberfront.AppImage tests a packaged app instead.
// Without DISPLAY the app can only reach a Wayland compositor, so a passing run
// on a Wayland session proves it renders natively there.
const env = { ...process.env };
const wayland = !!env.WAYLAND_DISPLAY && !process.argv.includes("--x11");
if (wayland) delete env.DISPLAY;
// Packaged builds pick the platform in their launcher; the bare binary needs the flag.
const platformArgs = wayland ? ["--ozone-platform=wayland"] : [];
const executable = process.env.DESKTOP_EXECUTABLE;
const app = await electron.launch({
  ...(executable
    ? { executablePath: executable, args: ["--windowed"] }
    : { args: [".", "--windowed", ...platformArgs] }),
  env,
});
const errors = [];
try {
  const page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.waitForFunction(
    () => document.querySelector("#stats")?.textContent?.includes("FPS"),
    null,
    { timeout: 60000 },
  );
  const info = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    const debug = gl?.getExtension("WEBGL_debug_renderer_info");
    return {
      origin: location.origin,
      webgl2: !!gl,
      renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : "?",
      bridge: typeof window.desktop?.setFullscreen,
      node: typeof window.require,
      storage: (() => {
        localStorage.setItem("probe", "1");
        return localStorage.getItem("probe");
      })(),
    };
  });
  const platform = await app.evaluate(({ app }) => ({
    electron: process.versions.electron,
    wayland: !!process.env.WAYLAND_DISPLAY,
    display: process.env.DISPLAY ?? null,
    ozone: app.commandLine.getSwitchValue("ozone-platform") || "default",
  }));
  console.log({ ...info, ...platform });
  assert.equal(info.origin, "app://game");
  assert.ok(info.webgl2, "WebGL2 available");
  assert.equal(info.bridge, "function");
  assert.equal(info.node, "undefined", "no Node.js in the page");
  assert.equal(info.storage, "1");
  // Fullscreen goes through the window, not the page's Fullscreen API.
  const isFull = () =>
    app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isFullScreen(),
    );
  assert.equal(await isFull(), false);
  await page.locator("#fullscreen").click();
  await page.waitForFunction(() =>
    document.querySelector("#fullscreen").classList.contains("active"),
  );
  assert.equal(await isFull(), true);
  assert.equal(await page.evaluate(() => !!document.fullscreenElement), false);
  await page.keyboard.press("Alt+Enter");
  await page.waitForFunction(
    () => !document.querySelector("#fullscreen").classList.contains("active"),
  );
  assert.equal(await isFull(), false);
  // Navigation away from the game is blocked.
  await page.evaluate(() => (location.href = "https://example.com"));
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => location.origin), "app://game");
  await page.screenshot({ path: join(tmpdir(), "emberfront-desktop.png") });
  assert.deepEqual(errors, []);
  console.log(
    `PASS: desktop shell (${platform.display ? "X11" : "Wayland"}): boot, WebGL2, app:// origin, sandboxed bridge, window fullscreen toggle, navigation lock`,
  );
} finally {
  await app.close();
}
