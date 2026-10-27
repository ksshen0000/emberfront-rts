// Minimal bridge: the page may toggle and observe window fullscreen, nothing else.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  setFullscreen: (on) => ipcRenderer.invoke("set-fullscreen", !!on),
  isFullscreen: () => ipcRenderer.invoke("is-fullscreen"),
  onFullscreenChange: (callback) =>
    ipcRenderer.on("fullscreen-changed", (_event, on) => callback(!!on)),
});
