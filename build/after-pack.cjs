// electron-builder afterPack hook (Linux): put a launcher script in front of the
// Electron binary. Chromium chooses X11 or Wayland before any app code runs, and
// its own auto-detection also requires XDG_SESSION_TYPE=wayland, which some
// sessions do not set. The launcher picks native Wayland whenever a compositor
// is reachable; passing --ozone-platform=x11 (or =wayland) overrides it.
const fs = require("node:fs");
const path = require("node:path");

exports.default = async (context) => {
  if (context.electronPlatformName !== "linux") return;
  const name = context.packager.executableName,
    exe = path.join(context.appOutDir, name);
  fs.renameSync(exe, `${exe}.bin`);
  fs.writeFileSync(
    exe,
    `#!/bin/sh
HERE="$(dirname "$(readlink -f "$0")")"
case " $* " in
  *" --ozone-platform="*) exec "$HERE/${name}.bin" "$@" ;;
esac
if [ -n "$WAYLAND_DISPLAY" ]; then
  exec "$HERE/${name}.bin" --ozone-platform=wayland "$@"
fi
exec "$HERE/${name}.bin" "$@"
`,
    { mode: 0o755 },
  );
};
