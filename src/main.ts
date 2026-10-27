import "./style.css";
import { World, VISIBLE, EXPLORED, type Entity } from "./simulation/world";
import {
  SPECS,
  STEP,
  SIZE,
  WC3,
  isUnit,
  isBuilding,
  type BuildingKind,
  type UnitKind,
  type Point,
} from "./simulation/config";
import { Battlefield } from "./rendering/battlefield";
import { WATER_LEVEL } from "./simulation/terrain";
import { CURSORS, cursorImage } from "./cursors";
const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
// ?spectate hands the blue side to the built-in AI as well (AI vs AI).
const spectate = new URLSearchParams(location.search).has("spectate");
function newWorld() {
  const w = new World();
  if (spectate) w.aiPlayers = [0, 1];
  return w;
}
let world = newWorld();
let view: Battlefield;
try {
  view = new Battlefield($<HTMLCanvasElement>("battlefield"));
  // Spectators watching AI vs AI see the whole map.
  if (spectate) view.fogOwner = null;
} catch (error) {
  $("modal").hidden = false;
  $("modal-title").textContent = "Unable to start the battlefield";
  $("modal-body").textContent =
    "Use a desktop browser with WebGL2 and hardware acceleration enabled.";
  $("resume").hidden = true;
  $("restart").onclick = () => location.reload();
  throw error;
}
const canvas = view.canvas,
  selected = view.selection,
  groups = new Map<string, number[]>(),
  keys = new Set<string>();
let mode: "normal" | "assault" | BuildingKind = "normal",
  pointer = { x: -1, y: -1 },
  // Window coordinates for edge panning; the HUD covers the canvas edges.
  screen = { x: -1, y: -1 },
  pan: { x: number; y: number; focus: Point } | null = null,
  drag: { x: number; y: number; shift: boolean } | null = null,
  accumulator = 0,
  lastTime = performance.now(),
  uiTime = 0,
  toastUntil = 0,
  signature: string | null = null,
  cursorDirty = true,
  cursor = "default",
  help = false,
  lastResult: string | null = null;
// Mouse confinement. Pointer Lock keeps the cursor inside the game even in a
// window or on multiple monitors; the game then draws its own cursor and tracks
// a virtual pointer from raw mouse movement.
let locked = false,
  confine = true,
  lockLostAt = 0,
  vp = { x: innerWidth / 2, y: innerHeight / 2 },
  hudTarget: Element | null = null,
  hoverEl: Element | null = null;
const softCursor = $("soft-cursor");
/** Client coordinates of a mouse event, virtual while the mouse is confined. */
function at(e: MouseEvent) {
  return locked ? { ...vp } : { x: e.clientX, y: e.clientY };
}
/** Pointer capture is unavailable while the pointer is locked (or a lock is pending). */
function capture(el: Element, id: number) {
  if (locked) return;
  try {
    el.setPointerCapture(id);
  } catch {
    /* Locked pointers already deliver every event to the canvas. */
  }
}
function requestLock() {
  if (!confine || locked || navigator.webdriver || !canvas.requestPointerLock)
    return;
  try {
    // Older browsers return undefined instead of a promise.
    (
      canvas.requestPointerLock() as unknown as Promise<void> | undefined
    )?.catch(() => {});
  } catch {
    /* Lock is retried on the next click. */
  }
}
function drawSoftCursor() {
  if (!locked) return;
  const overHud = document.elementFromPoint(vp.x, vp.y) !== canvas,
    img = cursorImage(overHud ? CURSORS.arrow : cursor);
  softCursor.style.backgroundImage = `url("${img.url}")`;
  softCursor.style.transform = `translate(${vp.x - img.x}px, ${vp.y - img.y}px)`;
  // Mirror :hover on the HUD control under the virtual pointer.
  const hover = overHud
    ? (document.elementFromPoint(vp.x, vp.y)?.closest("button") ?? null)
    : null;
  if (hover !== hoverEl) {
    hoverEl?.classList.remove("soft-hover");
    hover?.classList.add("soft-hover");
    hoverEl = hover;
  }
}
document.addEventListener("pointerlockchange", () => {
  const now = document.pointerLockElement === canvas;
  if (now === locked) return;
  locked = now;
  document.body.classList.toggle("confined", locked);
  if (locked) {
    if (screen.x >= 0) vp = { ...screen };
    drawSoftCursor();
    return;
  }
  hoverEl?.classList.remove("soft-hover");
  hoverEl = null;
  hudTarget = null;
  // Losing the lock mid-game means Esc or a window switch: treat it as Esc.
  if (!world.paused && !world.result) {
    lockLostAt = performance.now();
    if (mode !== "normal") setMode("normal");
    else pause();
  }
});
window.addEventListener(
  "pointermove",
  (e) => {
    // Some platforms report one huge spurious delta right after locking.
    if (!locked || Math.abs(e.movementX) > 400 || Math.abs(e.movementY) > 400)
      return;
    vp = {
      x: Math.max(0, Math.min(innerWidth - 1, vp.x + e.movementX)),
      y: Math.max(0, Math.min(innerHeight - 1, vp.y + e.movementY)),
    };
    drawSoftCursor();
  },
  { capture: true },
);
// While confined every mouse event lands on the canvas; route those aimed at the HUD.
const forward = (type: string, target: Element, e: PointerEvent) =>
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      clientX: vp.x,
      clientY: vp.y,
      button: e.button,
      buttons: e.buttons,
      pointerId: e.pointerId,
    }),
  );
canvas.addEventListener(
  "pointerdown",
  (e) => {
    if (!locked) return;
    const el = document.elementFromPoint(vp.x, vp.y);
    if (!el || el === canvas) return;
    e.stopImmediatePropagation();
    hudTarget = el;
    if (mini.contains(el)) forward("pointerdown", mini, e);
  },
  { capture: true },
);
canvas.addEventListener(
  "pointermove",
  (e) => {
    if (!locked || !hudTarget) return;
    e.stopImmediatePropagation();
    if (mini.contains(hudTarget)) forward("pointermove", mini, e);
  },
  { capture: true },
);
canvas.addEventListener(
  "pointerup",
  (e) => {
    if (!locked || !hudTarget) return;
    e.stopImmediatePropagation();
    const down = hudTarget.closest("button, label, a"),
      up = document.elementFromPoint(vp.x, vp.y)?.closest("button, label, a");
    hudTarget = null;
    if (e.button === 0 && down && down === up) (down as HTMLElement).click();
  },
  { capture: true },
);
canvas.addEventListener(
  "wheel",
  (e) => {
    // Panels do not scroll; ignore the wheel over them instead of zooming.
    if (locked && document.elementFromPoint(vp.x, vp.y) !== canvas)
      e.stopImmediatePropagation();
  },
  { capture: true },
);
const symbols: Record<string, string> = {
  worker: "⚒",
  soldier: "⚔",
  archer: "➶",
  base: "♜",
  farm: "⌂",
  barracks: "⚑",
  gold: "◆",
  tree: "♠",
  rock: "◇",
};
const selection = () =>
  [...selected]
    .map((id) => world.entities.get(id))
    .filter((e): e is Entity => !!e);
function toast(message: string) {
  $("toast").textContent = message;
  $("toast").classList.add("visible");
  toastUntil = performance.now() + 3500;
}
function setMode(next: typeof mode) {
  mode = next;
  view.preview(null);
  $("mode-hint").style.display = next === "normal" ? "none" : "block";
  $("mode-hint").textContent =
    next === "assault"
      ? "Choose an attack destination · Left click to confirm / Esc to cancel"
      : next !== "normal"
        ? `Place ${SPECS[next].name} · Left click to confirm / Esc to cancel`
        : "";
  cursorDirty = true;
}
function select(ids: number[], toggle = false) {
  if (!toggle) selected.clear();
  for (const id of ids) {
    if (toggle && selected.has(id)) selected.delete(id);
    else selected.add(id);
  }
  setMode("normal");
  signature = null;
  cursorDirty = true;
  renderUI();
}
function issue(
  type: "move" | "assault" | "attack" | "gather" | "resume" | "rally",
  point?: Point,
  target?: number,
) {
  world.submit({ player: 0, ids: [...selected], type, point, target });
  if (point) view.marker(point, type === "attack" || type === "assault");
}
canvas.addEventListener("contextmenu", (e) => e.preventDefault());
canvas.addEventListener("pointerdown", (e) => {
  // Lock first: entering fullscreen consumes the click's user activation.
  if (!world.paused && !world.result) requestLock();
  if (autoFullscreen && !navigator.webdriver) {
    autoFullscreen = false;
    void setFullscreen(true);
  }
  if (world.paused || world.result) return;
  const rect = canvas.getBoundingClientRect(),
    x = at(e).x - rect.left,
    y = at(e).y - rect.top;
  if (e.button === 1) {
    // Middle-drag grabs the ground and pans with the mouse hand only.
    e.preventDefault();
    pan = { x: at(e).x, y: at(e).y, focus: { ...view.focus } };
    capture(canvas, e.pointerId);
    canvas.style.cursor = cursor = "grabbing";
    return;
  }
  if (e.button === 2) {
    if (mode !== "normal") {
      setMode("normal");
      return;
    }
    const hit = view.pick(x, y);
    if (!hit.point) return;
    const target = world.entities.get(hit.id ?? -1),
      chosen = selection();
    if (chosen.length === 1 && isBuilding(chosen[0].kind)) {
      issue("rally", hit.point);
      toast("Rally point set");
    } else if (target?.owner === 1) issue("attack", hit.point, target.id);
    else if (target && (target.kind === "gold" || target.kind === "tree"))
      issue("gather", hit.point, target.id);
    else if (target?.owner === 0 && target.progress < 1)
      issue("resume", hit.point, target.id);
    else issue("move", hit.point);
    return;
  }
  if (e.button !== 0) return;
  if (mode !== "normal") {
    const p = view.groundPoint(x, y);
    if (!p) return;
    if (mode === "assault") {
      issue("assault", p);
      setMode("normal");
    } else {
      const kind = mode,
        pos = world.snap(kind, p),
        error = world.placement(kind, pos);
      if (error) {
        toast(error);
        return;
      }
      world.submit({
        player: 0,
        ids: [...selected],
        type: "build",
        kind,
        point: pos,
      });
      setMode("normal");
    }
    return;
  }
  drag = { x, y, shift: e.shiftKey };
  capture(canvas, e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
  const rect = canvas.getBoundingClientRect();
  pointer = { x: at(e).x - rect.left, y: at(e).y - rect.top };
  if (pan) {
    // Orthographic: screen pixels map linearly to ground; vertical spans are foreshortened.
    const k = (2 * view.zoom) / rect.height;
    view.focus = {
      x: pan.focus.x - (at(e).x - pan.x) * k,
      z: pan.focus.z + ((at(e).y - pan.y) * k) / Math.cos(view.camera.beta),
    };
    view.updateCamera();
    return;
  }
  cursorDirty = true;
  if (drag && Math.hypot(pointer.x - drag.x, pointer.y - drag.y) > 5) {
    const b = $("selection-box");
    b.style.display = "block";
    b.style.left = `${Math.min(pointer.x, drag.x)}px`;
    b.style.top = `${Math.min(pointer.y, drag.y)}px`;
    b.style.width = `${Math.abs(pointer.x - drag.x)}px`;
    b.style.height = `${Math.abs(pointer.y - drag.y)}px`;
  }
});
canvas.addEventListener("pointerleave", () => {
  pointer = { x: -1, y: -1 };
});
canvas.addEventListener("pointerup", (e) => {
  if (e.button === 1 && pan) {
    pan = null;
    cursorDirty = true;
    cursor = "";
    return;
  }
  if (e.button !== 0 || !drag) return;
  const start = drag;
  drag = null;
  $("selection-box").style.display = "none";
  const rect = canvas.getBoundingClientRect(),
    x = at(e).x - rect.left,
    y = at(e).y - rect.top;
  if (Math.hypot(x - start.x, y - start.y) > 5) {
    const ids = world
      .own(0)
      .filter((u) => {
        if (!isUnit(u.kind)) return false;
        const p = view.project(u);
        return (
          p.x >= Math.min(x, start.x) &&
          p.x <= Math.max(x, start.x) &&
          p.y >= Math.min(y, start.y) &&
          p.y <= Math.max(y, start.y)
        );
      })
      .map((e) => e.id);
    select(ids, start.shift);
  } else {
    const hit = view.pick(x, y),
      entity = world.entities.get(hit.id ?? -1);
    select(entity?.owner === 0 ? [entity.id] : [], start.shift);
  }
});
canvas.addEventListener("dblclick", (e) => {
  if (world.paused || world.result || mode !== "normal") return;
  const rect = canvas.getBoundingClientRect(),
    hit = view.pick(at(e).x - rect.left, at(e).y - rect.top),
    kind = world.entities.get(hit.id ?? -1);
  if (kind?.owner !== 0 || !isUnit(kind.kind)) return;
  // Double-click picks every unit of that type on screen.
  select(
    world
      .own(0)
      .filter((u) => {
        if (u.kind !== kind.kind) return false;
        const p = view.project(u);
        return p.x >= 0 && p.y >= 0 && p.x <= rect.width && p.y <= rect.height;
      })
      .map((u) => u.id),
    e.shiftKey,
  );
});
canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    view.zoom = Math.max(
      Battlefield.ZOOM_MIN,
      Math.min(Battlefield.ZOOM_MAX, view.zoom + e.deltaY * 0.02),
    );
    view.updateCamera();
  },
  { passive: false },
);
function showModal() {
  const end = world.result;
  const m = $("modal");
  m.hidden = !world.paused && !end;
  if (!m.hidden && locked) document.exitPointerLock();
  if (m.hidden) return;
  $("modal-title").textContent = end
    ? end === "win"
      ? "The frontier is yours."
      : end === "loss"
        ? "Your stronghold has fallen."
        : "Both strongholds have fallen."
    : help
      ? "Field manual"
      : "Battle paused";
  $("modal-eyebrow").textContent = end
    ? end === "win"
      ? "VICTORY / Azure Guard"
      : "BATTLE COMPLETE"
    : "EMBERFRONT / EMBERFRONT";
  $("modal-body").innerHTML =
    help && !end
      ? '<div class="help-grid"><span>Left click / Drag</span><span>Select a unit / Box-select your troops</span><span>Shift + Select</span><span>Add or remove units from selection</span><span>RMB</span><span>Move, attack, gather or resume construction</span><span>A + Click / S</span><span>Attack move / Stop</span><span>Edges / MMB drag</span><span>Pan the camera (also arrows); scroll to zoom</span><span>Double-click</span><span>Select all units of that type on screen</span><span>Space / Minimap</span><span>Focus selection / Click or drag to move camera, right-click to send units</span><span>Alt + Enter</span><span>Toggle fullscreen</span><span>Mouse lock</span><span>Clicking the battlefield confines the cursor to the game; Esc releases it and pauses</span><span>Ctrl + 1–5</span><span>Create control group; number keys recall it</span><span>B / F</span><span>Build barracks / farm with a worker</span><span>Esc</span><span>Cancel targeting / Pause</span></div><p>Select workers and right-click a gold mine or trees. Build a barracks and farms, train an army, then destroy the enemy stronghold in the northeast.</p>'
      : `<p>${end ? `Battle duration: ${formatTime(world.time)}. ${end === "win" ? "The enemy stronghold has been destroyed. The Azure Guard holds the frontier." : "Regroup your forces and challenge the Ember Legion again."}` : "Your troops and production are paused. Resume when you are ready to command."}</p>`;
  $("resume").hidden = !!end;
}
function pause() {
  if (world.result) return;
  world.paused = !world.paused;
  help = false;
  accumulator = 0;
  keys.clear();
  showModal();
}
$("pause").onclick = pause;
$("resume").onclick = () => {
  requestLock();
  world.paused = false;
  help = false;
  accumulator = 0;
  showModal();
};
$("help").onclick = () => {
  world.paused = true;
  help = true;
  showModal();
};
$("restart").onclick = () => {
  world = newWorld();
  view.reset();
  selected.clear();
  groups.clear();
  keys.clear();
  lastResult = null;
  help = false;
  signature = null;
  setMode("normal");
  accumulator = 0;
  showModal();
  renderUI();
  toast("A new battle has begun.");
};
$("effects").onchange = () => {
  view.fx = $<HTMLInputElement>("effects").checked;
};
try {
  confine = localStorage.getItem("confine-mouse") !== "off";
} catch {
  /* Storage may be blocked; keep the default. */
}
$<HTMLInputElement>("confine").checked = confine;
$("confine").onchange = () => {
  confine = $<HTMLInputElement>("confine").checked;
  try {
    localStorage.setItem("confine-mouse", confine ? "on" : "off");
  } catch {
    /* Preference just won't persist. */
  }
};
$("shadows").onchange = () => {
  view.sun.shadowEnabled = $<HTMLInputElement>("shadows").checked;
};
$("home").onclick = () => {
  const base = world.own(0).find((e) => e.kind === "base");
  if (base) {
    view.focus = { x: base.x, z: base.z };
    view.updateCamera();
    select([base.id]);
  }
};
window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement) return;
  const key = e.key.toLowerCase();
  if (
    [
      "arrowup",
      "arrowdown",
      "arrowleft",
      "arrowright",
      " ",
      "1",
      "2",
      "3",
      "4",
      "5",
    ].includes(key)
  )
    e.preventDefault();
  if (key === "enter" && e.altKey) {
    e.preventDefault();
    void setFullscreen(!fullscreen);
    return;
  }
  // The same Esc press that released the mouse has already been handled.
  if (key === "escape" && performance.now() - lockLostAt < 400) return;
  if (key === "escape") {
    if (mode !== "normal") setMode("normal");
    else pause();
    return;
  }
  if (world.paused || world.result) return;
  keys.add(key);
  if (e.repeat) return;
  if (/^[1-5]$/.test(key)) {
    if (e.ctrlKey) {
      groups.set(key, [...selected]);
      toast(`Control group ${key} assigned`);
    } else select(groups.get(key) ?? []);
    return;
  }
  if (key === "a") setMode("assault");
  if (key === "s") {
    world.submit({ player: 0, ids: [...selected], type: "stop" });
    setMode("normal");
  }
  if (
    (key === "b" || key === "f") &&
    selection().some((e) => e.kind === "worker")
  )
    setMode(key === "b" ? "barracks" : "farm");
  if (key === " ") {
    const units = selection();
    if (units.length) {
      view.focus = {
        x: units.reduce((n, e) => n + e.x, 0) / units.length,
        z: units.reduce((n, e) => n + e.z, 0) / units.length,
      };
      view.updateCamera();
    }
  }
});
window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener("blur", () => {
  keys.clear();
  drag = null;
  $("selection-box").style.display = "none";
  pointer = { x: -1, y: -1 };
  screen = { x: -1, y: -1 };
  pan = null;
});
window.addEventListener("pointermove", (e) => {
  screen = at(e);
});
window.addEventListener("mouseout", (e) => {
  if (!e.relatedTarget) screen = { x: -1, y: -1 };
});
// RTS play keeps one hand on the mouse. Fullscreen confines the cursor so edge
// panning works, and keyboard lock (Chromium) keeps Esc for the game: holding
// Esc still leaves fullscreen.
// The Electron shell (electron/preload.cjs) owns a real fullscreen window instead.
const desktop = (
  window as Window & {
    desktop?: {
      setFullscreen(on: boolean): Promise<boolean>;
      isFullscreen(): Promise<boolean>;
      onFullscreenChange(callback: (on: boolean) => void): void;
    };
  }
).desktop;
let autoFullscreen = !desktop,
  fullscreen = false;
function showFullscreen(on: boolean) {
  fullscreen = on;
  $("fullscreen").classList.toggle("active", on);
  $("fullscreen").setAttribute("aria-pressed", String(on));
}
async function setFullscreen(on: boolean) {
  if (desktop) {
    showFullscreen(await desktop.setFullscreen(on));
    return;
  }
  try {
    if (on && !document.fullscreenElement)
      await document.documentElement.requestFullscreen({
        navigationUI: "hide",
      });
    else if (!on && document.fullscreenElement) await document.exitFullscreen();
  } catch {
    toast("The browser blocked fullscreen. Press F11 instead.");
  }
}
if (desktop) {
  desktop.onFullscreenChange(showFullscreen);
  void desktop.isFullscreen().then(showFullscreen);
}
document.addEventListener("fullscreenchange", () => {
  const on = !!document.fullscreenElement,
    keyboard = (
      navigator as Navigator & {
        keyboard?: { lock(keys: string[]): Promise<void>; unlock(): void };
      }
    ).keyboard;
  if (on) keyboard?.lock(["Escape"]).catch(() => {});
  else keyboard?.unlock();
  showFullscreen(on);
  if (on) toast("Fullscreen · hold Esc to exit");
});
$("fullscreen").onclick = () => {
  autoFullscreen = false;
  void setFullscreen(!fullscreen);
};
document.addEventListener("visibilitychange", () => {
  if (document.hidden && !world.result) {
    world.paused = true;
    accumulator = 0;
    keys.clear();
    showModal();
  }
});
window.addEventListener("resize", () => {
  view.engine.resize();
  view.updateCamera();
});
function action(
  name: string,
  symbol: string,
  cost: string,
  callback: () => void,
  key = "",
  disabled = false,
) {
  const b = document.createElement("button");
  b.className = "action";
  b.disabled = disabled;
  b.innerHTML = `<kbd>${key}</kbd><span class="symbol">${symbol}</span><span class="name">${name}</span><span class="cost">${cost}</span>`;
  b.onclick = callback;
  $("actions").append(b);
}
function train(kind: UnitKind) {
  world.submit({ player: 0, ids: [...selected], type: "train", kind });
}
function cost(kind: UnitKind | BuildingKind) {
  const s = SPECS[kind];
  return `${s.gold}g${s.wood ? ` · ${s.wood}w` : ""} · ${s.time}s`;
}
function formatTime(t: number) {
  return `${Math.floor(t / 60)
    .toString()
    .padStart(2, "0")}:${Math.floor(t % 60)
    .toString()
    .padStart(2, "0")}`;
}
// Hovering shows what a right-click would order the current selection to do.
function cursorFor(x: number, y: number) {
  if (world.paused || world.result) return "default";
  if (mode === "assault") return CURSORS.assault;
  if (mode !== "normal") return CURSORS.place;
  if (drag) return "default";
  const target = world.entities.get(view.pick(x, y).id ?? -1),
    chosen = selection(),
    units = chosen.some((e) => isUnit(e.kind)),
    workers = chosen.some((e) => e.kind === "worker");
  if (chosen.length === 1 && isBuilding(chosen[0].kind)) return CURSORS.rally;
  if (target?.owner === 1 && units) return CURSORS.attack;
  if (target?.kind === "gold" && workers) return CURSORS.mine;
  if (target?.kind === "tree" && workers) return CURSORS.chop;
  if (target?.owner === 0 && target.progress < 1 && workers)
    return CURSORS.build;
  return target?.owner === 0 ? "pointer" : "default";
}
function updateCursor() {
  cursorDirty = false;
  if (pointer.x < 0) return;
  const next = cursorFor(pointer.x, pointer.y);
  if (next !== cursor) canvas.style.cursor = cursor = next;
  drawSoftCursor();
}
function renderUI() {
  for (const id of selected) if (!world.entities.has(id)) selected.delete(id);
  const p = world.players[0],
    pop = world.population(0);
  $("gold").textContent = Math.floor(p.gold).toString();
  $("wood").textContent = Math.floor(p.wood).toString();
  $("population").textContent =
    `${pop.used}${pop.reserved ? `+${pop.reserved}` : ""} / ${pop.cap}`;
  $("clock").textContent = formatTime(world.time);
  const units = selection(),
    e = units[0];
  $("selection-count").textContent = units.length
    ? `${units.length} selected`
    : "No selection";
  const next = units
    .map(
      (e) =>
        `${e.id}:${Math.floor(e.hp)}:${Math.round(e.progress * 100)}:${e.queue.map((q) => q.kind + Math.floor(q.elapsed)).join(",")}:${e.carry}`,
    )
    .join("|");
  if (next !== signature || !$("selection-content").innerHTML) {
    signature = next;
    $("actions").replaceChildren();
    $("queue").replaceChildren();
    if (!e) {
      $("selection-content").innerHTML =
        '<div class="portrait">♜</div><div class="empty-selection"><strong>Awaiting your orders.</strong>Select your stronghold or workers<br>and build your frontier army.</div>';
      action("Stronghold", "♜", "Focus base", () =>
        ($("home") as HTMLButtonElement).click(),
      );
      action("Worker", "⚒", "Select idle", () =>
        select(
          world
            .own(0)
            .filter((e) => e.kind === "worker" && e.order.type === "idle")
            .map((e) => e.id),
        ),
      );
      action("Army", "⚔", "Select all", () =>
        select(
          world
            .own(0)
            .filter((e) => e.kind === "soldier" || e.kind === "archer")
            .map((e) => e.id),
        ),
      );
    } else {
      const spec = SPECS[e.kind],
        hp = Math.max(0, Math.ceil(e.hp));
      $("selection-content").innerHTML =
        `<div class="portrait">${symbols[e.kind]}</div><div class="unit-details"><h2>${units.length > 1 ? `${units.length} units` : spec.name}</h2><span class="role">Azure Guard · ${isUnit(e.kind) ? (e.kind === "worker" ? "Gatherer & builder" : "Combat unit") : "Settlement"}</span><div class="health-track"><i style="width:${(e.hp / spec.hp) * 100}%"></i></div><div class="health-label"><span>Health</span><span>${hp} / ${spec.hp}</span></div><div class="unit-stats">${isUnit(e.kind) ? `<span>⚔ ${spec.damage!.join("–")} ${spec.attack}</span><span>◎ ${Math.round(spec.range! / WC3)} range</span><span>◈ ${spec.armor} ${spec.armorType}</span>${e.kind === "worker" ? `<span>Carrying ${e.carry}</span>` : ""}` : `<span>◈ ${spec.armor} ${spec.armorType}</span><span>${e.progress < 1 ? `Building ${Math.floor(e.progress * 100)}%` : e.kind === "farm" ? `Food +${-spec.food}` : "Right-click to set a rally point"}</span>`}</div></div>`;
      if (units.some((e) => e.kind === "worker")) {
        action(
          "Barracks",
          "⚑",
          cost("barracks"),
          () => setMode("barracks"),
          "B",
        );
        action("Farm", "⌂", cost("farm"), () => setMode("farm"), "F");
      }
      if (units.some((e) => isUnit(e.kind))) {
        action(
          "Attack move",
          "⚔",
          "Set destination",
          () => setMode("assault"),
          "A",
        );
        action(
          "Stop",
          "◼",
          "Hold position",
          () => world.submit({ player: 0, ids: [...selected], type: "stop" }),
          "S",
        );
      }
      if (e.progress === 1 && units.length === 1) {
        if (e.kind === "base")
          action("Train worker", "⚒", cost("worker"), () => train("worker"));
        if (e.kind === "barracks") {
          action("Train soldier", "⚔", cost("soldier"), () => train("soldier"));
          action("Train archer", "➶", cost("archer"), () => train("archer"));
        }
      }
      if (e.progress < 1)
        action("Cancel build", "×", "75% refund", () =>
          world.submit({ player: 0, ids: [e.id], type: "cancel" }),
        );
      for (const [index, q] of e.queue.entries()) {
        const b = document.createElement("button");
        b.title = "Click to cancel training for a full refund";
        b.innerHTML = `${symbols[q.kind]} ${SPECS[q.kind].name} ${index === 0 ? `${Math.min(100, Math.floor((q.elapsed / SPECS[q.kind].time) * 100))}%` : "Queued"} ×<i style="width:${(q.elapsed / SPECS[q.kind].time) * 100}%"></i>`;
        b.onclick = () =>
          world.submit({ player: 0, ids: [e.id], type: "cancel", index });
        $("queue").append(b);
      }
    }
  }
  const army = world
      .own(0)
      .filter((e) => e.kind === "soldier" || e.kind === "archer"),
    barracks = world.own(0).find((e) => e.kind === "barracks");
  $("phase").textContent = army.length >= 3 ? "03" : barracks ? "02" : "01";
  $("phase-title").textContent =
    army.length >= 3
      ? "Your army is ready"
      : barracks
        ? "Raise your first army"
        : "Put your settlement to work";
  $("phase-desc").textContent =
    army.length >= 3
      ? "Select troops. A + click to advance northeast."
      : barracks
        ? "Train troops at the barracks. Farms add food."
        : "Select workers. Right-click gold or trees to gather.";
  drawMap();
}
const mini = $<HTMLCanvasElement>("minimap"),
  ctx = mini.getContext("2d")!;
// The painted terrain is scaled down once and reused as the minimap backdrop.
const backdrop = document.createElement("canvas");
backdrop.width = backdrop.height = 180;
{
  const b = backdrop.getContext("2d")!;
  b.imageSmoothingQuality = "high";
  b.drawImage(view.terrain, 0, 0, 180, 180);
  // The ground texture shows the riverbed; paint the water surface over it.
  b.fillStyle = "#2f6f7d";
  for (let y = 0; y < 180; y++)
    for (let x = 0; x < 180; x++)
      if (
        view.height(((x + 0.5) / 180) * SIZE, (1 - (y + 0.5) / 180) * SIZE) <
        WATER_LEVEL
      )
        b.fillRect(x, y, 1, 1);
  b.fillStyle = "#1a261c40";
  b.fillRect(0, 0, 180, 180);
  b.strokeStyle = "#c4cca81a";
  for (let i = 1; i < 4; i++) {
    b.beginPath();
    b.moveTo(i * 45, 0);
    b.lineTo(i * 45, 180);
    b.moveTo(0, i * 45);
    b.lineTo(180, i * 45);
    b.stroke();
  }
}
// Minimap fog: one pixel per map cell, scaled up with smoothing like the 3D fog.
const fogCanvas = document.createElement("canvas");
fogCanvas.width = fogCanvas.height = SIZE;
const fogCtx = fogCanvas.getContext("2d")!,
  fogImage = fogCtx.createImageData(SIZE, SIZE);
let fogDrawn = -1;
function drawMap() {
  ctx.drawImage(backdrop, 0, 0);
  const fogged = view.fogOwner !== null;
  for (const e of world.entities.values()) {
    if (e.owner !== 2) continue;
    const size = e.kind === "gold" ? 5 : e.kind === "tree" ? 3 : 4;
    ctx.fillStyle =
      e.kind === "gold" ? "#e6c06a" : e.kind === "tree" ? "#2b4a37" : "#8d9584";
    ctx.fillRect(
      (e.x / SIZE) * 180 - size / 2,
      (1 - e.z / SIZE) * 180 - size / 2,
      size,
      size,
    );
  }
  if (fogged) {
    if (fogDrawn !== world.fogVersion) {
      fogDrawn = world.fogVersion;
      const fog = world.fog[0],
        px = fogImage.data;
      for (let z = 0; z < SIZE; z++)
        for (let x = 0; x < SIZE; x++) {
          const cell = fog[z * SIZE + x],
            i = ((SIZE - 1 - z) * SIZE + x) * 4;
          px[i] = 8;
          px[i + 1] = 12;
          px[i + 2] = 9;
          px[i + 3] = cell & VISIBLE ? 0 : cell & EXPLORED ? 125 : 228;
        }
      fogCtx.putImageData(fogImage, 0, 0);
    }
    ctx.drawImage(fogCanvas, 0, 0, 180, 180);
  }
  const mark = (owner: number, building: boolean, p: Point, base = false) => {
    const x = (p.x / SIZE) * 180,
      y = (1 - p.z / SIZE) * 180;
    ctx.fillStyle = owner === 0 ? "#8fe0d6" : "#f08d6f";
    ctx.strokeStyle = "#0d1410";
    ctx.lineWidth = 1;
    if (building) {
      const size = base ? 8 : 6;
      ctx.fillRect(x - size / 2, y - size / 2, size, size);
      ctx.strokeRect(x - size / 2, y - size / 2, size, size);
    } else {
      ctx.beginPath();
      ctx.arc(x, y, 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  };
  for (const e of world.entities.values()) {
    if (e.owner === 2) continue;
    // Enemy buildings come from the renderer below, as last seen.
    if (fogged && e.owner === 1 && (isBuilding(e.kind) || !world.sees(0, e)))
      continue;
    mark(e.owner, isBuilding(e.kind), e, e.kind === "base");
  }
  if (fogged)
    for (const v of view.views.values())
      if (v.remembered)
        mark(
          1,
          true,
          { x: v.root.position.x, z: v.root.position.z },
          v.half >= 3,
        );
  ctx.strokeStyle = "#d5d8b0";
  ctx.lineWidth = 1;
  const a = view.engine.getRenderWidth() / view.engine.getRenderHeight(),
    w = ((view.zoom * a) / SIZE) * 180,
    h = (view.zoom / Math.cos(view.camera.beta) / SIZE) * 180;
  ctx.strokeRect(
    (view.focus.x / SIZE) * 180 - w,
    (1 - view.focus.z / SIZE) * 180 - h,
    w * 2,
    h * 2,
  );
}
const miniPoint = (e: PointerEvent): Point => {
  const r = mini.getBoundingClientRect();
  return {
    x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * SIZE,
    z: (1 - Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))) * SIZE,
  };
};
mini.addEventListener("contextmenu", (e) => e.preventDefault());
mini.addEventListener("pointerdown", (e) => {
  if (e.button === 2) {
    // Right-click on the minimap orders the selection there, like on the ground.
    if (
      world.paused ||
      world.result ||
      !selection().some((u) => isUnit(u.kind))
    )
      return;
    issue("move", miniPoint(e));
    return;
  }
  if (e.button !== 0) return;
  capture(mini, e.pointerId);
  view.focus = miniPoint(e);
  view.updateCamera();
});
mini.addEventListener("pointermove", (e) => {
  if (!(e.buttons & 1)) return;
  view.focus = miniPoint(e);
  view.updateCamera();
});
view.engine.runRenderLoop(() => {
  const now = performance.now(),
    dt = Math.min(0.25, (now - lastTime) / 1000);
  lastTime = now;
  if (!world.paused && !world.result) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= STEP && steps++ < 5) {
      world.step();
      accumulator -= STEP;
    }
    if (steps > 5) accumulator = 0;
    // Pan speed follows zoom so the view crosses the screen at the same rate.
    const speed = dt * view.zoom * 1.4,
      edge = 6;
    let dx = 0,
      dz = 0;
    if (!pan) {
      const sx = screen.x,
        sy = screen.y,
        inside = sx >= 0 && sy >= 0;
      if (keys.has("arrowleft") || (inside && sx < edge)) dx--;
      if (keys.has("arrowright") || (inside && sx > innerWidth - edge)) dx++;
      if (keys.has("arrowup") || (inside && sy < edge)) dz++;
      if (keys.has("arrowdown") || (inside && sy > innerHeight - edge)) dz--;
    }
    if (dx || dz) {
      view.focus.x += dx * speed;
      view.focus.z += dz * speed;
      view.updateCamera();
    }
  }
  if (mode === "farm" || mode === "barracks") {
    const p = view.groundPoint(pointer.x, pointer.y);
    if (p) {
      const pos = world.snap(mode, p);
      view.preview(mode, pos, !world.placement(mode, pos));
    }
  }
  view.sync(world, dt);
  view.scene.render();
  if (cursorDirty) updateCursor();
  if (now - uiTime > 100) {
    renderUI();
    updateCursor();
    uiTime = now;
    $("stats").textContent =
      `${Math.round(view.engine.getFps())} FPS · ${world.own(0).length + world.own(1).length} entities · 20 Hz simulation`;
  }
  if (world.messages.length) toast(world.messages.splice(0).at(-1)!);
  if (now > toastUntil) $("toast").classList.remove("visible");
  if (world.result !== lastResult) {
    lastResult = world.result;
    showModal();
  }
});
renderUI();
toast("Welcome to the frontier. Select workers and right-click a gold mine.");
// Local development only: deterministic scenario hooks for browser integration tests.
if (import.meta.env.DEV)
  (window as unknown as { rts: unknown }).rts = {
    get world() {
      return world;
    },
    view,
    select,
  };
