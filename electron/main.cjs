// Desktop shell: serves the Vite build from a private app:// scheme and opens it
// in a fullscreen window. The game itself is unchanged web code.
const { app, BrowserWindow, ipcMain, protocol, net } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const DIST = path.join(__dirname, "..", "dist");

// The page needs nothing beyond its own files: no network, no plugins.
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

// A standard, secure scheme gives the page a real origin: ES modules,
// localStorage and Pointer Lock behave as they do on https.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);

function serve() {
  protocol.handle("app", async (request) => {
    const { pathname } = new URL(request.url);
    const file = path.normalize(
      path.join(
        DIST,
        decodeURIComponent(pathname === "/" ? "/index.html" : pathname),
      ),
    );
    // Never serve anything outside the build output.
    if (path.relative(DIST, file).startsWith(".."))
      return new Response("Not found", { status: 404 });
    const response = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(response.headers);
    headers.set("Content-Security-Policy", CSP);
    return new Response(response.body, { status: response.status, headers });
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    fullscreen: !process.argv.includes("--windowed"),
    backgroundColor: "#111a16",
    autoHideMenuBar: true,
    title: "Emberfront",
    icon: path.join(__dirname, "..", "build", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.setMenu(null);
  // The game is self-contained: no pop-ups, no navigation away from it.
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  const notify = () =>
    win.webContents.send("fullscreen-changed", win.isFullScreen());
  win.on("enter-full-screen", notify);
  win.on("leave-full-screen", notify);
  win.loadURL("app://game/index.html");
  return win;
}

ipcMain.handle("set-fullscreen", (event, on) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  win?.setFullScreen(!!on);
  return win?.isFullScreen() ?? false;
});
ipcMain.handle(
  "is-fullscreen",
  (event) =>
    BrowserWindow.fromWebContents(event.sender)?.isFullScreen() ?? false,
);

app.whenReady().then(() => {
  serve();
  createWindow();
});
app.on("window-all-closed", () => app.quit());
