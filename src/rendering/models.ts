import type { Mesh } from "@babylonjs/core/Meshes/mesh";
import type { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { SPECS, type FactionId, type Kind } from "../simulation/config";

/** Primitive builders handed to a model; each part is merged into one mesh. */
export type Part = {
  box: (
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    m: StandardMaterial,
  ) => Mesh;
  cone: (
    diameter: number,
    height: number,
    x: number,
    y: number,
    z: number,
    m: StandardMaterial,
    top?: number,
    sides?: number,
  ) => Mesh;
  torus: (
    diameter: number,
    thickness: number,
    x: number,
    y: number,
    z: number,
    m: StandardMaterial,
  ) => Mesh;
};
export interface Palette {
  /** Team colour of the owning player. */
  team: StandardMaterial;
  mat: (name: string, hex: string, emissive?: boolean) => StandardMaterial;
}

/**
 * Units and buildings for each faction, built from primitives. Every faction
 * fills the same roles, so models differ in silhouette and materials while
 * the team colour marks the owner.
 */
export function buildModel(
  part: Part,
  kind: Kind,
  faction: FactionId,
  palette: Palette,
) {
  const { box, cone, torus } = part,
    { team, mat } = palette,
    stone = mat("stone", "#c0b49a"),
    dark = mat("dark", "#544b3c"),
    wood = mat("wood", "#85694a"),
    metal = mat("metal", "#d1d9ce"),
    gold = mat("gold", "#e0b65e");
  if (SPECS[kind].speed) {
    // Shared figure: feet, team-coloured torso, head. Ironhide figures are
    // broad with green skin, Sylvan figures slender and hooded.
    const broad = faction === "orc" ? 1.25 : faction === "elf" ? 0.85 : 1,
      skin =
        faction === "orc"
          ? mat("orc-skin", "#6f8d4a")
          : faction === "elf"
            ? mat("elf-skin", "#e6d3b2")
            : mat("skin", "#d5b28c");
    box(0.5 * broad, 0.18, 0.45, 0, 0.1, 0, dark);
    box(0.5 * broad, 0.65, 0.35 * broad, 0, 0.55, 0, team);
    cone(
      0.37,
      0.36,
      0,
      1.06,
      0,
      faction === "crown" && kind !== "worker" ? metal : skin,
      0.32,
      6,
    );
    if (faction === "crown") crownUnit(part, kind, team, wood, metal, gold);
    else if (faction === "orc") {
      const bone = mat("bone", "#e8e0c8");
      if (kind === "worker") {
        box(0.42, 0.42, 0.32, 0, 0.62, -0.3, mat("hide", "#8a6a45"));
        box(0.1, 0.85, 0.1, 0.42, 0.65, 0.05, wood).rotation.z = -0.3;
        cone(0.3, 0.3, 0.55, 1.02, 0.05, metal, 0.05, 3).rotation.z = 1.2;
      }
      if (kind === "soldier") {
        // Brute: spiked pauldrons and a broad axe.
        for (const x of [-0.36, 0.36]) cone(0.26, 0.3, x, 0.98, 0, bone, 0, 4);
        box(0.1, 1.1, 0.1, 0.46, 0.8, 0.12, wood).rotation.z = -0.15;
        box(0.42, 0.34, 0.06, 0.58, 1.24, 0.12, metal).rotation.z = -0.15;
      }
      if (kind === "archer") {
        // Spear thrower: a quiver of javelins and one held overhead.
        box(0.06, 1.5, 0.06, 0.36, 1, 0, wood).rotation.x = 0.5;
        cone(0.12, 0.25, 0.36, 1.75, 0.38, metal, 0, 4).rotation.x = 0.5;
        for (const x of [-0.1, 0, 0.1])
          box(0.04, 0.8, 0.04, x, 0.8, -0.26, wood);
      }
      if (kind === "hero") {
        // Warlord: horned helm, tusk pauldrons, cape and great axe.
        box(0.6, 0.85, 0.06, 0, 0.6, -0.26, team).rotation.x = 0.15;
        for (const x of [-0.2, 0.2])
          cone(0.12, 0.42, x, 1.4, 0, bone, 0, 4).rotation.z = x * -2;
        for (const x of [-0.4, 0.4]) cone(0.3, 0.36, x, 1, 0, bone, 0, 4);
        box(0.1, 1.3, 0.1, 0.5, 0.85, 0.12, wood).rotation.z = -0.15;
        box(0.5, 0.42, 0.06, 0.62, 1.36, 0.12, metal).rotation.z = -0.15;
      }
    } else {
      const leaf = mat("leaf", "#5f9a5a");
      // Pointed hood in the team colour.
      cone(0.42, 0.42, 0, 1.36, -0.03, team, 0, 6);
      if (kind === "worker")
        box(0.36, 0.3, 0.3, 0, 0.6, -0.27, mat("wicker", "#b49562"));
      if (kind === "soldier")
        for (const x of [-0.36, 0.36])
          box(0.05, 0.08, 0.7, x, 0.62, 0.25, metal).rotation.y = x * 0.6;
      if (kind === "archer") {
        torus(0.95, 0.06, 0.38, 0.75, 0, wood).rotation.z = Math.PI / 2;
        box(0.18, 0.5, 0.18, 0, 0.75, -0.25, leaf);
      }
      if (kind === "hero") {
        // Moonseer: long robe, staff crowned with a moonstone.
        cone(0.8, 0.9, 0, 0.45, 0, team, 0.4, 8);
        box(0.06, 1.7, 0.06, 0.38, 0.9, 0.1, wood);
        cone(
          0.26,
          0.3,
          0.38,
          1.85,
          0.1,
          mat("moonstone", "#d7f0ff", true),
          0,
          5,
        );
        torus(0.4, 0.05, 0, 1.3, 0, leaf);
      }
    }
    return;
  }
  const s = SPECS[kind].size;
  // Deep footing so the building sits flush on gently sloping ground.
  box(s, 0.8, s, 0, -0.1, 0, dark);
  if (faction === "crown")
    crownBuilding(part, kind, palette, stone, dark, wood);
  else if (faction === "orc") {
    const timber = mat("timber", "#6e5236"),
      thatch = mat("thatch", "#9a7b45"),
      bone = mat("bone", "#e8e0c8");
    if (kind === "base") {
      // Warhold: timber keep under a steep spiked roof, tusks at the corners.
      box(4.6, 3, 4.6, 0, 1.6, 0, timber);
      cone(6.2, 3, 0, 4.5, 0, thatch, 0, 4).rotation.y = Math.PI / 4;
      cone(1.6, 1.8, 0, 6.6, 0, team, 0, 4);
      for (const x of [-2.5, 2.5])
        for (const z of [-2.5, 2.5])
          cone(0.5, 2.4, x, 1.3, z, bone, 0, 4).rotation.x = z * 0.15;
      box(1.4, 1.8, 0.15, 0, 1.1, -2.35, dark);
    } else if (kind === "farm") {
      box(2.6, 1.3, 1.8, 0, 0.9, 0, timber);
      cone(3.2, 1.4, 0, 2.2, 0, thatch, 0, 4).scaling.z = 0.7;
      box(0.5, 0.9, 0.1, 0, 0.65, -0.95, dark);
    } else if (kind === "barracks") {
      // War Camp: hide tents around a spiked palisade.
      for (const [x, z] of [
        [-1.2, -0.9],
        [1.2, -0.9],
        [0, 1],
      ])
        cone(2.4, 2.4, x, 1.4, z, mat("hide", "#8a6a45"), 0, 6);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        cone(0.3, 1.6, Math.cos(a) * 2.2, 0.9, Math.sin(a) * 2.2, timber, 0, 4);
      }
      box(0.1, 3.4, 0.1, 0, 2, -2.1, timber);
      box(0.8, 0.9, 0.06, 0.4, 3.2, -2.1, team);
    } else {
      // Totem Ring: carved poles around a fire pit.
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        box(0.4, 2.2, 0.4, Math.cos(a) * 1.4, 1.2, Math.sin(a) * 1.4, timber);
        cone(0.6, 0.4, Math.cos(a) * 1.4, 2.5, Math.sin(a) * 1.4, team, 0, 4);
      }
      cone(1.2, 0.3, 0, 0.35, 0, stone, 1.2, 8);
      cone(0.8, 1, 0, 0.9, 0, mat("fire", "#f39a4a", true), 0, 5);
    }
    return;
  }
  const bark = mat("bark", "#7a6249"),
    canopy = mat("canopy", "#4f8a55"),
    pale = mat("palestone", "#d9d6c4");
  if (kind === "base") {
    // Heartwood: a great tree with ribbons in the team colour.
    cone(2.4, 4.2, 0, 2.1, 0, bark, 1.4, 8);
    cone(6, 2.6, 0, 4.6, 0, canopy, 2.4, 8);
    cone(4.6, 2.2, 0, 6.2, 0, canopy, 0.8, 8);
    for (const a of [0, 2.1, 4.2])
      box(0.15, 1.6, 0.06, Math.cos(a) * 1.3, 2.6, Math.sin(a) * 1.3, team);
    box(1.1, 1.5, 0.15, 0, 0.9, -1.2, dark);
  } else if (kind === "farm") {
    cone(1, 1.6, 0, 0.8, 0, bark, 0.7, 6);
    cone(2.8, 1.8, 0, 2.2, 0, canopy, 0.4, 7);
    box(0.5, 0.15, 0.5, 0, 1.4, -0.4, team);
  } else if (kind === "barracks") {
    // Glade Hall: a long arch of living wood.
    box(4, 1.6, 3, 0, 1, 0, pale);
    cone(4.6, 2, 0, 2.8, 0, canopy, 1.2, 6).scaling.z = 0.8;
    for (const x of [-1.6, 1.6]) cone(0.6, 3, x, 1.6, -1.6, bark, 0.3, 5);
    box(1.4, 0.5, 0.08, 0, 2.6, -1.6, team);
  } else {
    // Starstone: standing stones around a floating moonstone.
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      box(0.35, 1.6, 0.35, Math.cos(a) * 1.4, 0.9, Math.sin(a) * 1.4, pale);
    }
    cone(1, 1.6, 0, 1.8, 0, mat("moonstone", "#d7f0ff", true), 0, 5);
    torus(1.6, 0.08, 0, 0.4, 0, team);
  }
}

function crownUnit(
  { box, cone, torus }: Part,
  kind: Kind,
  team: StandardMaterial,
  wood: StandardMaterial,
  metal: StandardMaterial,
  gold: StandardMaterial,
) {
  if (kind === "worker") {
    box(0.35, 0.4, 0.3, 0, 0.62, -0.27, wood);
    box(0.1, 0.8, 0.1, 0.38, 0.65, 0.05, wood).rotation.z = -0.3;
    box(0.33, 0.18, 0.12, 0.5, 1, 0.05, metal);
  }
  if (kind === "soldier") {
    box(0.32, 0.55, 0.18, -0.4, 0.65, 0.13, team);
    box(0.09, 0.95, 0.1, 0.38, 0.75, 0.1, metal);
  }
  if (kind === "archer") {
    torus(0.7, 0.07, 0.4, 0.65, 0, wood).rotation.z = Math.PI / 2;
    cone(0.48, 0.3, 0, 1.26, 0, team);
  }
  if (kind === "hero") {
    // Cape, pauldrons, crown and a two-handed hammer.
    box(0.52, 0.8, 0.06, 0, 0.6, -0.22, team).rotation.x = 0.15;
    for (const x of [-0.3, 0.3]) box(0.22, 0.14, 0.4, x, 0.9, 0, gold);
    cone(0.42, 0.16, 0, 1.3, 0, gold, 0.42, 6);
    box(0.08, 1.1, 0.08, 0.42, 0.75, 0.12, wood).rotation.z = -0.2;
    box(0.34, 0.22, 0.22, 0.53, 1.28, 0.12, metal).rotation.z = -0.2;
  }
}

function crownBuilding(
  { box, cone }: Part,
  kind: Kind,
  { team, mat }: Palette,
  stone: StandardMaterial,
  dark: StandardMaterial,
  wood: StandardMaterial,
) {
  if (kind === "base") {
    box(4, 3.4, 4, 0, 1.8, 0, stone);
    cone(6, 2.5, 0, 4.5, 0, team);
    for (const x of [-2.3, 2.3])
      for (const z of [-2.3, 2.3]) {
        box(1.35, 3.5, 1.35, x, 1.9, z, stone);
        cone(2, 1.7, x, 4.3, z, team);
      }
    box(1.25, 1.8, 0.15, 0, 1.1, -2.05, dark);
    box(0.8, 1.5, 0.12, 1.3, 2.7, -2.06, team);
  } else if (kind === "altar") {
    // Stepped dais with four standing stones around a glowing crystal.
    box(3.4, 0.5, 3.4, 0, 0.35, 0, stone);
    box(2.4, 0.5, 2.4, 0, 0.8, 0, stone);
    for (const x of [-1.4, 1.4])
      for (const z of [-1.4, 1.4]) {
        box(0.45, 2.3, 0.45, x, 1.6, z, stone);
        cone(0.6, 0.5, x, 3, z, team);
      }
    cone(0.9, 1.5, 0, 1.8, 0, mat("crystal", "#a6e0f0", true), 0, 5);
    box(1.2, 0.2, 1.2, 0, 1.1, 0, team);
  } else if (kind === "barracks") {
    box(4.4, 2.3, 3.6, 0, 1.4, 0, stone);
    cone(6.1, 2, 0, 3.5, 0, team).scaling.z = 0.8;
    box(1.3, 1.6, 0.15, 0, 1.1, -1.85, dark);
    for (const x of [-1.6, 1.6]) {
      box(0.13, 3.8, 0.13, x, 2, -2.1, wood);
      box(0.65, 0.9, 0.06, x + 0.25, 3.3, -2.1, team);
    }
  } else {
    box(2.4, 1.5, 2.2, 0, 1, 0, stone);
    cone(3.8, 1.5, 0, 2.45, 0, team);
    box(0.6, 1, 0.1, 0, 0.75, -1.15, dark);
    box(0.7, 0.6, 0.7, 1.05, 0.6, 1, mat("hay", "#c1a15d"));
  }
}
