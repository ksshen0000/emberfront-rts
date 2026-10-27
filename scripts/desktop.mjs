// Runs the Electron shell on the current build, natively on Wayland when available
// (the packaged app does the same in its launcher, see build/after-pack.cjs).
import { spawn } from "node:child_process";
import electron from "electron";

const args = [".", ...process.argv.slice(2)];
if (
  process.env.WAYLAND_DISPLAY &&
  !args.some((a) => a.startsWith("--ozone-platform="))
)
  args.push("--ozone-platform=wayland");
spawn(electron, args, { stdio: "inherit" }).on("exit", (code) =>
  process.exit(code ?? 0),
);
