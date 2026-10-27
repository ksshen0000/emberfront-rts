import { Engine } from "@babylonjs/core/Engines/engine";
import { Constants } from "@babylonjs/core/Engines/constants";
import { Scene } from "@babylonjs/core/scene";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Camera } from "@babylonjs/core/Cameras/camera";
import { Vector3, Matrix, Quaternion } from "@babylonjs/core/Maths/math.vector";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import type { InstancedMesh } from "@babylonjs/core/Meshes/instancedMesh";
import "@babylonjs/core/Meshes/instancedMesh";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { ImageProcessingConfiguration } from "@babylonjs/core/Materials/imageProcessingConfiguration";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import "@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent";
import "@babylonjs/core/Meshes/thinInstanceMesh";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import {
  FogOfWarPlugin,
  FOG_EXPLORED,
  FOG_UNEXPLORED,
  FOG_VISIBLE,
} from "./fogOfWar";
import "@babylonjs/core/Culling/ray";
import {
  SPECS,
  SIZE,
  isUnit,
  isBuilding,
  type Point,
  type BuildingKind,
} from "../simulation/config";
import {
  VISIBLE,
  EXPLORED,
  type World,
  type Entity,
} from "../simulation/world";
interface View {
  root: TransformNode;
  ring: InstancedMesh;
  bar: TransformNode;
  fill: InstancedMesh | null;
  fillColor: string;
  barWidth: number;
  body: InstancedMesh;
  hp: number;
  carry: InstancedMesh | null;
  carryKind: string;
  /** Footprint half-width, for fog checks after the entity itself is gone. */
  half: number;
  /** Enemy building seen at least once: it stays drawn as last seen while fogged. */
  remembered: boolean;
}
type Part = {
  [K in "box" | "cone" | "torus"]: K extends "box"
    ? (
        w: number,
        h: number,
        d: number,
        x: number,
        y: number,
        z: number,
        m: StandardMaterial,
      ) => Mesh
    : K extends "cone"
      ? (
          diameter: number,
          height: number,
          x: number,
          y: number,
          z: number,
          m: StandardMaterial,
          top?: number,
          sides?: number,
        ) => Mesh
      : (
          diameter: number,
          thickness: number,
          x: number,
          y: number,
          z: number,
          m: StandardMaterial,
        ) => Mesh;
};
// Deterministic per-entity variation so scenery looks hand-placed but stable.
const hash = (id: number, salt: number) => {
  let h =
    Math.imul(id ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 1, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
};
export class Battlefield {
  engine: Engine;
  scene: Scene;
  camera: ArcRotateCamera;
  views = new Map<number, View>();
  materials = new Map<string, StandardMaterial>();
  templates = new Map<string, Mesh>();
  /** Player whose fog of war is shown; null shows everything (spectating). */
  fogOwner: 0 | null = 0;
  fogTexture: RawTexture;
  // Displayed fog brightness per cell, eased toward the simulation's state.
  fogShown = new Float32Array(SIZE * SIZE);
  fogBytes = new Uint8Array(SIZE * SIZE);
  fogTarget = new Float32Array(SIZE * SIZE);
  fogVersion = -2;
  fogSnap = true;
  /** Painted ground texture, shared with the minimap background. */
  terrain!: HTMLCanvasElement;
  static readonly ZOOM_MIN = 10;
  static readonly ZOOM_MAX = 45;
  static readonly ZOOM_DEFAULT = 18;
  sun: DirectionalLight;
  shadows: ShadowGenerator;
  focus = { x: 32, z: 29 };
  zoom = Battlefield.ZOOM_DEFAULT;
  selection = new Set<number>();
  ghost: Mesh | null = null;
  ghostKind: BuildingKind | null = null;
  effects: {
    mesh: Mesh;
    life: number;
    max: number;
    from?: Vector3;
    to?: Vector3;
    arc?: boolean;
    grow?: number;
  }[] = [];
  fx = true;
  constructor(public canvas: HTMLCanvasElement) {
    this.engine = new Engine(canvas, true, {
      preserveDrawingBuffer: true,
      stencil: true,
    });
    if (this.engine.webGLVersion < 2) throw new Error("WebGL2 is required");
    this.engine.setHardwareScalingLevel(
      Math.min(2, window.devicePixelRatio || 1),
    );
    this.scene = new Scene(this.engine);
    this.fogTexture = RawTexture.CreateLuminanceTexture(
      this.fogBytes,
      SIZE,
      SIZE,
      this.scene,
      false,
      false,
      Texture.BILINEAR_SAMPLINGMODE,
    );
    this.fogTexture.wrapU = this.fogTexture.wrapV = Texture.CLAMP_ADDRESSMODE;
    // Every standard material, including ones created later, is darkened by fog.
    this.scene.onNewMaterialAddedObservable.add((m) => {
      if (m instanceof StandardMaterial)
        new FogOfWarPlugin(m, () => this.fogTexture);
    });
    // main.ts owns the canvas cursor (context cursors); stop Babylon resetting it on hover.
    this.scene.doNotHandleCursors = true;
    // Units render in group 1 against the scenery depth buffer (see ghosts in create).
    this.scene.setRenderingAutoClearDepthStencil(1, false, false, false);
    this.scene.clearColor = new Color4(0.055, 0.085, 0.075, 1);
    this.camera = new ArcRotateCamera(
      "camera",
      -Math.PI / 2,
      0.69,
      65,
      new Vector3(38, 0, 31),
      this.scene,
    );
    this.camera.mode = Camera.ORTHOGRAPHIC_CAMERA;
    // RTS controls own panning and orthographic zoom; orbit controls stay disabled.
    this.camera.inputs.clear();
    this.camera.lowerAlphaLimit = this.camera.upperAlphaLimit =
      this.camera.alpha;
    this.camera.lowerBetaLimit = this.camera.upperBetaLimit = this.camera.beta;
    this.camera.lowerRadiusLimit = this.camera.upperRadiusLimit =
      this.camera.radius;
    this.camera.minZ = 0.1;
    this.camera.maxZ = 250;
    this.scene.ambientColor = Color3.FromHexString("#2a3328");
    const ip = this.scene.imageProcessingConfiguration;
    ip.toneMappingEnabled = true;
    ip.toneMappingType =
      ImageProcessingConfiguration.TONEMAPPING_KHR_PBR_NEUTRAL;
    ip.exposure = 1.08;
    ip.contrast = 1.12;
    const hemi = new HemisphericLight(
      "sky",
      new Vector3(0.3, 1, 0.2),
      this.scene,
    );
    hemi.intensity = 0.62;
    hemi.diffuse = Color3.FromHexString("#e6f0ff");
    hemi.groundColor = Color3.FromHexString("#3c4a3a");
    // Low sun from behind the viewer's left shoulder: camera-facing walls stay lit
    // and shadows stretch up and to the right.
    this.sun = new DirectionalLight(
      "sun",
      new Vector3(0.6, -1, 0.55).normalize(),
      this.scene,
    );
    this.sun.intensity = 0.95;
    this.sun.diffuse = Color3.FromHexString("#ffe2b0");
    this.sun.autoUpdateExtends = false;
    this.sun.autoCalcShadowZBounds = true;
    this.shadows = new ShadowGenerator(2048, this.sun);
    this.shadows.usePercentageCloserFiltering = true;
    this.shadows.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
    this.shadows.bias = 0.0015;
    this.shadows.normalBias = 0.02;
    this.shadows.setDarkness(0.38);
    let seed = 17;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    // Dark forest floor beyond the playable area so map edges never show the void.
    const outskirts = MeshBuilder.CreateGround(
      "outskirts",
      { width: SIZE + 160, height: SIZE + 160 },
      this.scene,
    );
    outskirts.position.set(SIZE / 2, -0.08, SIZE / 2);
    outskirts.material = this.mat("outskirts", "#34452f");
    outskirts.isPickable = false;
    outskirts.receiveShadows = true;
    const ground = MeshBuilder.CreateGround(
      "ground",
      { width: SIZE, height: SIZE, subdivisions: 1 },
      this.scene,
    );
    ground.position.set(SIZE / 2, -0.04, SIZE / 2);
    ground.metadata = { ground: true };
    ground.receiveShadows = true;
    const T = 2048,
      k = T / SIZE;
    const texture = new DynamicTexture(
      "terrain",
      { width: T, height: T },
      this.scene,
      true,
    );
    texture.anisotropicFilteringLevel = 8;
    const ctx = texture.getContext() as CanvasRenderingContext2D;
    this.terrain = ctx.canvas as HTMLCanvasElement;
    // Texture rows run top-down while world z runs up the map.
    const px = (x: number) => x * k,
      pz = (z: number) => (SIZE - z) * k;
    ctx.fillStyle = "#56704a";
    ctx.fillRect(0, 0, T, T);
    const blob = (x: number, y: number, r: number, color: string) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, color);
      g.addColorStop(1, color.slice(0, 7) + "00");
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    };
    // Broad meadow tones, then mid-size patches, then fine grain.
    for (let i = 0; i < 70; i++)
      blob(
        random() * T,
        random() * T,
        120 + random() * 260,
        ["#6a8452", "#4b6442", "#5e7a4a", "#465d3d", "#738a55"][i % 5] + "66",
      );
    for (let i = 0; i < 900; i++)
      blob(
        random() * T,
        random() * T,
        10 + random() * 34,
        ["#6f8a55", "#4a6141", "#7d9160", "#526b45"][i % 4] + "40",
      );
    for (let i = 0; i < 60000; i++) {
      ctx.fillStyle = ["#6a8553", "#4b6342", "#7a9160", "#43593b"][i % 4];
      ctx.globalAlpha = 0.25 + random() * 0.35;
      ctx.fillRect(
        random() * T,
        random() * T,
        1 + random() * 2.5,
        1 + random() * 2.5,
      );
    }
    ctx.globalAlpha = 1;
    // Worn dirt road between the two settlements, drawn in soft layers.
    const road = (width: number, color: string) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(px(24), pz(24));
      ctx.bezierCurveTo(px(44), pz(46), px(84), pz(82), px(104), pz(104));
      ctx.stroke();
    };
    road(86, "#6d6d4c55");
    road(62, "#857a5a99");
    road(46, "#958866");
    road(18, "#a3946f");
    for (const p of [24, 104]) {
      for (const [r, c] of [
        [170, "#6d6d4c44"],
        [128, "#857a5aaa"],
        [104, "#958866"],
      ] as const) {
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(px(p), pz(p), r, 0, Math.PI * 2);
        ctx.fill();
      }
      for (let i = 0; i < 30; i++) {
        const a = random() * Math.PI * 2,
          d = random() * 110;
        blob(
          px(p) + Math.cos(a) * d,
          pz(p) + Math.sin(a) * d,
          8 + random() * 16,
          "#7a6e5260",
        );
      }
    }
    // Trampled earth around resource sites.
    for (const [x, z] of [
      [13, 23],
      [SIZE - 13, SIZE - 23],
    ])
      blob(px(x), pz(z), 110, "#7b7155cc");
    for (const [x, z] of [
      [19.5, 39.5],
      [SIZE - 19.5, SIZE - 39.5],
      [60.5, 61],
    ])
      blob(px(x), pz(z), 150, "#3e533866");
    // Soft darkening toward the map rim.
    const rim = ctx.createRadialGradient(
      T / 2,
      T / 2,
      T * 0.42,
      T / 2,
      T / 2,
      T * 0.75,
    );
    rim.addColorStop(0, "#00000000");
    rim.addColorStop(1, "#1a24164d");
    ctx.fillStyle = rim;
    ctx.fillRect(0, 0, T, T);
    texture.update(true);
    const mat = this.mat("terrain", "#ffffff");
    mat.diffuseTexture = texture;
    ground.material = mat;
    // Nonblocking scenery: each kind is one mesh drawn with thin instances.
    const scatter = (
      template: Mesh,
      count: number,
      place: () => [number, number, number, number] | null,
    ) => {
      template.isPickable = false;
      template.receiveShadows = true;
      for (let i = 0; i < count; i++) {
        const p = place();
        if (!p) continue;
        const [x, z, scale, yaw] = p;
        template.thinInstanceAdd(
          Matrix.Compose(
            new Vector3(scale, scale * (0.8 + random() * 0.5), scale),
            Quaternion.RotationYawPitchRoll(yaw, 0, 0),
            new Vector3(x, 0, z),
          ),
          i === count - 1,
        );
      }
      template.thinInstanceRefreshBoundingInfo();
      return template;
    };
    const clearOf = (x: number, z: number) =>
      [
        [24, 24],
        [SIZE - 24, SIZE - 24],
      ].every(([bx, bz]) => Math.hypot(x - bx, z - bz) > 8);
    const field = () => {
      const x = 2 + random() * (SIZE - 4),
        z = 2 + random() * (SIZE - 4);
      return clearOf(x, z)
        ? ([x, z, 0.7 + random() * 0.7, random() * 6.28] as [
            number,
            number,
            number,
            number,
          ])
        : null;
    };
    const tuft = MeshBuilder.CreateCylinder(
      "grass",
      { height: 0.45, diameterTop: 0, diameterBottom: 0.3, tessellation: 3 },
      this.scene,
    );
    tuft.bakeTransformIntoVertices(Matrix.Translation(0, 0.2, 0));
    tuft.material = this.mat("grass", "#7a9159");
    scatter(tuft, 900, field);
    const flower = MeshBuilder.CreateSphere(
      "flower",
      { diameter: 0.16, segments: 2 },
      this.scene,
    );
    flower.bakeTransformIntoVertices(Matrix.Translation(0, 0.1, 0));
    flower.material = this.mat("flower", "#e8d9a0");
    scatter(flower, 260, field);
    const bloom = flower.clone("flower-red");
    bloom.material = this.mat("flower-red", "#d98a73");
    scatter(bloom, 140, field);
    const pebble = MeshBuilder.CreateSphere(
      "pebble",
      { diameter: 0.5, segments: 1 },
      this.scene,
    );
    pebble.scaling.y = 0.45;
    pebble.bakeCurrentTransformIntoVertices();
    pebble.convertToFlatShadedMesh();
    pebble.material = this.mat("pebble", "#8a8c7c");
    scatter(pebble, 120, field);
    const bush = MeshBuilder.CreateSphere(
      "bush",
      { diameter: 0.9, segments: 2 },
      this.scene,
    );
    bush.scaling.y = 0.7;
    bush.bakeCurrentTransformIntoVertices();
    bush.bakeTransformIntoVertices(Matrix.Translation(0, 0.2, 0));
    bush.convertToFlatShadedMesh();
    bush.material = this.mat("bush", "#46653f");
    scatter(bush, 110, field);
    this.shadows.addShadowCaster(bush);
    // A dense pine wall around the playable area frames the battlefield.
    const rimTree = () => {
      const side = Math.floor(random() * 4),
        along = -14 + random() * (SIZE + 28),
        out = -2 - random() * 16;
      const [x, z] =
        side === 0
          ? [along, out]
          : side === 1
            ? [along, SIZE - out]
            : side === 2
              ? [out, along]
              : [SIZE - out, along];
      return [x, z, 0.9 + random() * 0.6, random() * 6.28] as [
        number,
        number,
        number,
        number,
      ];
    };
    const pine = (
      color: string,
      d: number,
      h: number,
      y: number,
      name: string,
    ) => {
      const m = MeshBuilder.CreateCylinder(
        name,
        { diameterBottom: d, diameterTop: 0, height: h, tessellation: 6 },
        this.scene,
      );
      m.bakeTransformIntoVertices(Matrix.Translation(0, y, 0));
      m.convertToFlatShadedMesh();
      m.material = this.mat(name, color);
      return m;
    };
    const forest = Mesh.MergeMeshes(
      [
        pine("#2b4a3e", 3, 3.2, 2.4, "rim-low"),
        pine("#36594a", 2.1, 2.4, 3.8, "rim-top"),
      ],
      true,
      true,
      undefined,
      false,
      true,
    )!;
    forest.name = "rim-forest";
    scatter(forest, 520, rimTree);
    this.updateCamera();
  }
  mat(name: string, hex: string, emissive = false) {
    let m = this.materials.get(name);
    if (!m) {
      m = new StandardMaterial(name, this.scene);
      m.diffuseColor = Color3.FromHexString(hex);
      m.specularColor = Color3.Black();
      // Markers and bars render in their exact color regardless of lighting.
      if (emissive) {
        m.emissiveColor = m.diffuseColor.clone();
        m.disableLighting = true;
      }
      this.materials.set(name, m);
    }
    return m;
  }
  updateCamera() {
    this.focus.x = Math.max(3, Math.min(125, this.focus.x));
    this.focus.z = Math.max(3, Math.min(125, this.focus.z));
    // Keep the same orbit offset while translating the observation point.
    // Babylon otherwise rebuilds alpha/beta/radius from the old camera position.
    this.camera.setTarget(
      new Vector3(this.focus.x, 0, this.focus.z),
      false,
      false,
      true,
    );
    const aspect = this.engine.getRenderWidth() / this.engine.getRenderHeight();
    this.camera.orthoLeft = -this.zoom * aspect;
    this.camera.orthoRight = this.zoom * aspect;
    this.camera.orthoTop = this.zoom;
    this.camera.orthoBottom = -this.zoom;
    // Fit the shadow map to the visible ground only, keeping texel density high.
    const reach =
      Math.max(this.zoom * aspect, this.zoom / Math.cos(this.camera.beta)) + 6;
    this.sun.position = new Vector3(this.focus.x, 0, this.focus.z).subtract(
      this.sun.direction.scale(60),
    );
    this.sun.orthoLeft = this.sun.orthoBottom = -reach;
    this.sun.orthoRight = this.sun.orthoTop = reach;
  }
  /** Builds a model once, merged into one submesh per material, for instancing. */
  template(key: string, build: (part: Part) => void) {
    let source = this.templates.get(key);
    if (source) return source;
    const holder = new TransformNode(`build-${key}`, this.scene),
      parts: Mesh[] = [];
    const part: Part = {
      box: (w, h, d, x, y, z, material) => {
        const m = MeshBuilder.CreateBox(
          "part",
          { width: w, height: h, depth: d },
          this.scene,
        );
        m.position.set(x, y, z);
        m.material = material;
        m.parent = holder;
        parts.push(m);
        return m;
      },
      cone: (diameter, height, x, y, z, material, top = 0, sides = 4) => {
        const m = MeshBuilder.CreateCylinder(
          "part",
          {
            diameterBottom: diameter,
            diameterTop: top,
            height,
            tessellation: sides,
          },
          this.scene,
        );
        m.convertToFlatShadedMesh();
        m.position.set(x, y, z);
        m.material = material;
        m.parent = holder;
        parts.push(m);
        return m;
      },
      torus: (diameter, thickness, x, y, z, material) => {
        const m = MeshBuilder.CreateTorus(
          "part",
          { diameter, thickness, tessellation: 12 },
          this.scene,
        );
        m.position.set(x, y, z);
        m.material = material;
        m.parent = holder;
        parts.push(m);
        return m;
      },
    };
    build(part);
    const byMaterial = new Map<unknown, Mesh[]>();
    for (const m of parts) {
      m.computeWorldMatrix(true);
      byMaterial.set(m.material, [...(byMaterial.get(m.material) ?? []), m]);
    }
    const groups = [...byMaterial.values()].map((list) =>
      list.length > 1 ? Mesh.MergeMeshes(list, true, true)! : list[0],
    );
    source =
      groups.length > 1
        ? Mesh.MergeMeshes(groups, true, true, undefined, false, true)!
        : groups[0];
    source.parent = null;
    holder.dispose();
    source.name = `template-${key}`;
    // The source stays enabled (instances render through it) but sits far below the map.
    source.position.set(0, -1000, 0);
    source.isPickable = false;
    source.receiveShadows = true;
    source.freezeNormals();
    this.templates.set(key, source);
    return source;
  }
  instance(key: string, parent: TransformNode, build: (part: Part) => void) {
    const m = this.template(key, build).createInstance(key);
    // Instances copy the source transform, including its hiding offset.
    m.position.setAll(0);
    m.parent = parent;
    this.shadows.addShadowCaster(m, false);
    return m;
  }
  create(e: Entity): View {
    const root = new TransformNode(`entity-${e.id}`, this.scene);
    const team = this.mat(
      e.owner === 0 ? "teal" : "red",
      e.owner === 0 ? "#438e9c" : "#b35040",
    );
    const stone = this.mat("stone", "#c0b49a"),
      dark = this.mat("dark", "#544b3c"),
      wood = this.mat("wood", "#85694a"),
      metal = this.mat("metal", "#d1d9ce");
    const tone = Math.floor(hash(e.id, 1) * 3);
    const key =
      e.kind === "tree"
        ? `tree-${tone}`
        : e.owner === 2
          ? e.kind
          : `${e.kind}-${e.owner}`;
    const body = this.instance(key, root, ({ box, cone, torus }) => {
      if (isUnit(e.kind)) {
        box(0.5, 0.18, 0.45, 0, 0.1, 0, dark);
        box(0.5, 0.65, 0.35, 0, 0.55, 0, team);
        cone(
          0.37,
          0.36,
          0,
          1.06,
          0,
          e.kind === "worker" ? this.mat("skin", "#d5b28c") : metal,
          0.32,
          6,
        );
        if (e.kind === "worker") {
          box(0.35, 0.4, 0.3, 0, 0.62, -0.27, wood);
          box(0.1, 0.8, 0.1, 0.38, 0.65, 0.05, wood).rotation.z = -0.3;
          box(0.33, 0.18, 0.12, 0.5, 1, 0.05, metal);
        }
        if (e.kind === "soldier") {
          box(0.32, 0.55, 0.18, -0.4, 0.65, 0.13, team);
          box(0.09, 0.95, 0.1, 0.38, 0.75, 0.1, metal);
        }
        if (e.kind === "archer") {
          torus(0.7, 0.07, 0.4, 0.65, 0, wood).rotation.z = Math.PI / 2;
          cone(0.48, 0.3, 0, 1.26, 0, team);
        }
      } else if (isBuilding(e.kind)) {
        const s = SPECS[e.kind].size;
        box(s, 0.3, s, 0, 0.15, 0, dark);
        if (e.kind === "base") {
          box(4, 3.4, 4, 0, 1.8, 0, stone);
          cone(6, 2.5, 0, 4.5, 0, team);
          for (const x of [-2.3, 2.3])
            for (const z of [-2.3, 2.3]) {
              box(1.35, 3.5, 1.35, x, 1.9, z, stone);
              cone(2, 1.7, x, 4.3, z, team);
            }
          box(1.25, 1.8, 0.15, 0, 1.1, -2.05, dark);
          box(0.8, 1.5, 0.12, 1.3, 2.7, -2.06, team);
        } else if (e.kind === "barracks") {
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
          box(0.7, 0.6, 0.7, 1.05, 0.6, 1, this.mat("hay", "#c1a15d"));
        }
      } else if (e.kind === "tree") {
        const low = this.mat(
            `pine-${tone}`,
            ["#2e5145", "#335a3f", "#2a4a40"][tone],
          ),
          high = this.mat(
            `pine-top-${tone}`,
            ["#3c6350", "#45704b", "#386052"][tone],
          );
        cone(0.5, 1.6, 0, 0.8, 0, wood, 0.4, 5);
        cone(2.9, 2.6, 0, 2.3, 0, low, 0.6, 7);
        cone(2.4, 2.4, 0, 3.4, 0, high, 0.3, 7);
        cone(1.5, 1.9, 0, 4.6, 0, high, 0, 7);
      } else if (e.kind === "gold") {
        cone(4.4, 2.1, 0, 1, 0, this.mat("ore", "#777a6b"), 2.5, 7);
        for (const [x, z, h] of [
          [-0.8, -0.6, 1.3],
          [0.7, -0.4, 1],
          [0, 0.7, 1.6],
        ])
          cone(
            0.9,
            h,
            x,
            2,
            z,
            this.mat("gold", "#e0b65e"),
            0.2,
            5,
          ).rotation.z = x * 0.35;
      } else {
        const rock = this.mat("rock", "#7c8277");
        cone(3.6, 1.9, 0, 0.95, 0, rock, 2.2, 6);
        cone(2.2, 0.6, 0.2, 2.2, -0.1, rock, 1.1, 5);
        cone(1.4, 1, 1.6, 0.5, 1, rock, 0.7, 5);
        cone(1, 0.7, -1.5, 0.35, -1.1, rock, 0.5, 4);
      }
    });
    body.metadata = { id: e.id };
    if (isUnit(e.kind)) {
      // Slightly oversized figures read better at RTS camera distance.
      body.scaling.setAll(1.2);
      // A team-colored copy that passes the depth test only where
      // something stands in front of the unit, so troops stay visible behind trees.
      const ghost = this.overlay(`ghost-${key}`, body, () => {
        const m = this.templates.get(key)!.clone(`ghost-${key}`);
        m.renderingGroupId = 0;
        const mat = new StandardMaterial(`ghost-${e.owner}`, this.scene);
        mat.disableLighting = true;
        mat.emissiveColor = Color3.FromHexString(
          e.owner === 0 ? "#7fe0d4" : "#f08a6c",
        );
        mat.alpha = 0.5;
        mat.depthFunction = Constants.GREATER;
        mat.disableDepthWrite = true;
        m.material = mat;
        return m;
      });
      // Units draw in group 1, after their ghosts have been tested against scenery only.
      body.sourceMesh.renderingGroupId = 1;
    } else if (e.kind === "tree") {
      const s = 0.82 + hash(e.id, 2) * 0.36;
      body.scaling.set(s, s * (0.9 + hash(e.id, 3) * 0.3), s);
      body.rotation.y = hash(e.id, 4) * Math.PI * 2;
      body.position.x = (hash(e.id, 5) - 0.5) * 0.7;
      body.position.z = (hash(e.id, 6) - 0.5) * 0.7;
    } else if (e.kind === "rock") body.rotation.y = hash(e.id, 4) * Math.PI * 2;
    const diameter = isUnit(e.kind) ? 1.25 : SPECS[e.kind].size * 1.35;
    const ring = this.overlay(`ring-${diameter}-${e.owner === 1}`, root, () => {
      const m = MeshBuilder.CreateTorus(
        "selection",
        { diameter, thickness: 0.055, tessellation: 40 },
        this.scene,
      );
      m.material = this.mat(
        e.owner === 1 ? "selected-enemy" : "selected",
        e.owner === 1 ? "#f0a184" : "#bde7b0",
        true,
      );
      return m;
    });
    ring.position.y = 0.06;
    ring.setEnabled(false);
    // Health bars face the fixed camera; the fill shrinks from the left edge.
    const barWidth = isUnit(e.kind) ? 1.1 : 3;
    const bar = new TransformNode("hp", this.scene);
    bar.parent = root;
    bar.position.y = isUnit(e.kind) ? 2 : e.kind === "base" ? 6.4 : 4.8;
    bar.rotation.x = Math.PI / 2 - this.camera.beta;
    this.overlay(`hp-back-${barWidth}`, bar, () => {
      const m = MeshBuilder.CreatePlane(
        "hp-back",
        { width: barWidth + 0.08, height: 0.2 },
        this.scene,
      );
      m.material = this.mat("hp-back", "#151b17", true);
      return m;
    });
    root.position.set(e.x, 0, e.z);
    const view: View = {
      root,
      ring,
      bar,
      fill: null,
      fillColor: "",
      barWidth,
      body,
      hp: -1,
      carry: null,
      carryKind: "",
      half: isUnit(e.kind) ? 0 : SPECS[e.kind].size / 2,
      remembered: false,
    };
    this.views.set(e.id, view);
    return view;
  }
  /** Unlit, unpickable instanced decal such as a selection ring or health bar piece. */
  overlay(key: string, parent: TransformNode, build: () => Mesh) {
    let source = this.templates.get(key);
    if (!source) {
      source = build();
      source.name = `template-${key}`;
      source.position.set(0, -1000, 0);
      source.isPickable = false;
      this.templates.set(key, source);
    }
    const m = source.createInstance(key);
    m.position.setAll(0);
    m.parent = parent;
    m.isPickable = false;
    return m;
  }
  /** Eases the fog texture toward the simulation's fog for the viewing player. */
  syncFog(world: World, dt: number) {
    const version = this.fogOwner === null ? -1 : world.fogVersion;
    if (version !== this.fogVersion || this.fogSnap) {
      this.fogVersion = version;
      this.fogTargets(world);
    }
    const ease = this.fogSnap ? 1 : Math.min(1, dt * 6);
    let changed = this.fogSnap;
    for (let i = 0; i < this.fogShown.length; i++) {
      const target = this.fogTarget[i],
        shown = this.fogShown[i];
      if (shown === target) continue;
      const next =
        Math.abs(target - shown) < 0.01
          ? target
          : shown + (target - shown) * ease;
      this.fogShown[i] = next;
      const byte = Math.round(next * 255);
      if (byte !== this.fogBytes[i]) {
        this.fogBytes[i] = byte;
        changed = true;
      }
    }
    this.fogSnap = false;
    if (changed) this.fogTexture.update(this.fogBytes);
  }
  /** Brightness per cell from fog state, blurred so edges follow circles, not cells. */
  fogTargets(world: World) {
    const fog = this.fogOwner === null ? null : world.fog[this.fogOwner],
      t = this.fogTarget,
      tmp = new Float32Array(t.length);
    for (let i = 0; i < t.length; i++)
      t[i] = !fog
        ? FOG_VISIBLE
        : fog[i] & VISIBLE
          ? FOG_VISIBLE
          : fog[i] & EXPLORED
            ? FOG_EXPLORED
            : FOG_UNEXPLORED;
    if (!fog) return;
    // Two passes of a separable 3-tap box blur approximate a small Gaussian.
    for (let pass = 0; pass < 2; pass++) {
      for (let z = 0; z < SIZE; z++)
        for (let x = 0; x < SIZE; x++) {
          const i = z * SIZE + x;
          tmp[i] =
            (t[x > 0 ? i - 1 : i] + t[i] + t[x < SIZE - 1 ? i + 1 : i]) / 3;
        }
      for (let z = 0; z < SIZE; z++)
        for (let x = 0; x < SIZE; x++) {
          const i = z * SIZE + x;
          t[i] =
            (tmp[z > 0 ? i - SIZE : i] +
              tmp[i] +
              tmp[z < SIZE - 1 ? i + SIZE : i]) /
            3;
        }
    }
  }
  /** Whether the viewing player sees a spot right now (always true without fog). */
  sees(world: World, p: Point, half = 0) {
    return this.fogOwner === null || world.seesArea(this.fogOwner, p, half);
  }
  sync(world: World, dt: number) {
    this.syncFog(world, dt);
    for (const [id, v] of this.views)
      if (!world.entities.has(id)) {
        const seen = this.sees(world, v.root.position, v.half);
        // A building destroyed out of sight stays as last seen until scouted again.
        if (v.remembered && !seen) continue;
        if (this.fx && v.hp > 0 && seen && v.root.isEnabled())
          this.puff(v.root.position, v.barWidth > 2 ? 4 : 1.2);
        v.root.dispose();
        this.views.delete(id);
      }
    for (const e of world.entities.values()) {
      const v = this.views.get(e.id) ?? this.create(e),
        hidden =
          this.fogOwner !== null &&
          e.owner !== this.fogOwner &&
          e.owner !== 2 &&
          !world.sees(this.fogOwner, e);
      if (hidden) {
        // Enemy units vanish in fog; enemy buildings keep their last seen state.
        if (!v.remembered) v.root.setEnabled(false);
        continue;
      }
      if (!v.root.isEnabled()) {
        v.root.setEnabled(true);
        v.root.position.set(e.x, 0, e.z);
      }
      if (isBuilding(e.kind) && e.owner !== this.fogOwner) v.remembered = true;
      v.root.position.x += (e.x - v.root.position.x) * Math.min(1, dt * 22);
      v.root.position.z += (e.z - v.root.position.z) * Math.min(1, dt * 22);
      if (e.kind === "worker") {
        // Loaded workers show a gold nugget or log bundle on their pack.
        const load = e.carry > 0 ? e.carryKind : "";
        if (v.carryKind !== load) {
          v.carry?.dispose();
          v.carry = null;
          v.carryKind = load;
          if (load) {
            v.carry = this.overlay(`carry-${load}`, v.body, () => {
              const m =
                load === "gold"
                  ? MeshBuilder.CreatePolyhedron(
                      "carry",
                      { type: 1, size: 0.17 },
                      this.scene,
                    )
                  : MeshBuilder.CreateCylinder(
                      "carry",
                      { height: 0.5, diameter: 0.2, tessellation: 6 },
                      this.scene,
                    );
              if (load !== "gold") m.rotation.z = Math.PI / 2;
              m.bakeCurrentTransformIntoVertices();
              m.renderingGroupId = 1;
              m.material =
                load === "gold"
                  ? this.mat("gold", "#e0b65e")
                  : this.mat("wood", "#85694a");
              return m;
            });
            v.carry.position.set(0, 0.95, -0.28);
          }
        }
      }
      if (isUnit(e.kind)) {
        v.body.rotation.y = e.heading;
        v.body.position.y = e.path.length
          ? Math.sin(world.time * 14 + e.id) * 0.045
          : 0;
      } else if (isBuilding(e.kind))
        v.body.scaling.y = 0.15 + e.progress * 0.85;
      v.ring.setEnabled(this.selection.has(e.id));
      v.bar.setEnabled(
        e.owner !== 2 &&
          (this.selection.has(e.id) ||
            e.hp < SPECS[e.kind].hp ||
            e.progress < 1),
      );
      const ratio = Math.max(0.01, e.hp / SPECS[e.kind].hp);
      if (e.owner !== 2 && v.hp !== ratio) {
        v.hp = ratio;
        const [name, hex] =
          e.owner === 1
            ? ["enemy-health", "#e28c73"]
            : ratio > 0.6
              ? ["health", "#83c9b5"]
              : ratio > 0.3
                ? ["health-mid", "#e0c46c"]
                : ["health-low", "#e0735c"];
        if (v.fillColor !== name) {
          v.fill?.dispose();
          v.fillColor = name;
          v.fill = this.overlay(`hp-${name}-${v.barWidth}`, v.bar, () => {
            const m = MeshBuilder.CreatePlane(
              "hp-fill",
              { width: v.barWidth, height: 0.12 },
              this.scene,
            );
            m.material = this.mat(name, hex, true);
            return m;
          });
        }
        v.fill!.scaling.x = ratio;
        v.fill!.position.set((-(1 - ratio) * v.barWidth) / 2, 0, -0.01);
      }
    }
    for (const effect of world.effects.splice(0))
      if (
        this.fx &&
        this.effects.length < 80 &&
        (this.sees(world, effect.from) || this.sees(world, effect.to))
      ) {
        const from = new Vector3(effect.from.x, 1, effect.from.z),
          to = new Vector3(effect.to.x, 0.9, effect.to.z);
        if (effect.ranged) {
          const arrow = MeshBuilder.CreateBox(
            "arrow",
            { width: 0.06, height: 0.06, depth: 0.75 },
            this.scene,
          );
          arrow.material = this.mat("arrow", "#f3e3b4", true);
          arrow.isPickable = false;
          arrow.position.copyFrom(from);
          const life = Math.min(
            0.45,
            0.12 + Vector3.Distance(from, to) * 0.035,
          );
          this.effects.push({
            mesh: arrow,
            life,
            max: life,
            from,
            to,
            arc: true,
          });
        } else {
          const spark = MeshBuilder.CreateSphere(
            "spark",
            { diameter: 0.4, segments: 3 },
            this.scene,
          );
          spark.material = this.mat("spark", "#ffe1a0", true);
          spark.isPickable = false;
          spark.position.copyFrom(to);
          this.effects.push({ mesh: spark, life: 0.22, max: 0.22 });
        }
      }
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const f = this.effects[i];
      f.life -= dt;
      const t = 1 - f.life / f.max;
      if (f.life <= 0) {
        f.mesh.dispose();
        this.effects.splice(i, 1);
      } else if (f.from && f.to) {
        const p = Vector3.Lerp(f.from, f.to, t);
        // Arrows lob along a short arc and point along their flight.
        const lift = f.arc
          ? Math.sin(t * Math.PI) * Vector3.Distance(f.from, f.to) * 0.12
          : 0;
        p.y += lift;
        if (f.arc) {
          const dx = f.to.x - f.from.x,
            dz = f.to.z - f.from.z,
            climb = Math.cos(t * Math.PI) * 0.5;
          f.mesh.rotation.set(-climb, Math.atan2(dx, dz), 0);
        }
        f.mesh.position.copyFrom(p);
      } else if (f.grow) {
        f.mesh.scaling.setAll(f.grow * (0.4 + t));
        f.mesh.position.y = 0.3 + t * f.grow * 0.4;
        f.mesh.visibility = 1 - t;
      } else f.mesh.scaling.setAll(1 - t);
    }
  }
  puff(at: Vector3, size: number) {
    const mesh = MeshBuilder.CreateSphere(
      "dust",
      { diameter: 1, segments: 3 },
      this.scene,
    );
    mesh.material = this.mat("dust", "#b9ad8c");
    mesh.isPickable = false;
    mesh.position.set(at.x, 0.3, at.z);
    this.effects.push({ mesh, life: 0.7, max: 0.7, grow: size });
  }
  pick(x: number, y: number) {
    const hit = this.scene.pick(
      x,
      y,
      (m) => (!!m.metadata?.id && m.isEnabled()) || !!m.metadata?.ground,
    );
    return {
      id: hit?.pickedMesh?.metadata?.id as number | undefined,
      point: hit?.pickedPoint
        ? { x: hit.pickedPoint.x, z: hit.pickedPoint.z }
        : undefined,
    };
  }
  groundPoint(x: number, y: number) {
    const hit = this.scene.pick(x, y, (m) => !!m.metadata?.ground);
    return hit?.pickedPoint
      ? { x: hit.pickedPoint.x, z: hit.pickedPoint.z }
      : null;
  }
  project(p: Point) {
    const rect = this.canvas.getBoundingClientRect();
    const projected = Vector3.Project(
      new Vector3(p.x, 0, p.z),
      Matrix.Identity(),
      this.scene.getTransformMatrix(),
      this.camera.viewport.toGlobal(
        this.engine.getRenderWidth(),
        this.engine.getRenderHeight(),
      ),
    );
    return {
      x: (projected.x * rect.width) / this.engine.getRenderWidth(),
      y: (projected.y * rect.height) / this.engine.getRenderHeight(),
    };
  }
  preview(kind: BuildingKind | null, p?: Point, valid = false) {
    if (this.ghostKind !== kind) {
      this.ghost?.dispose();
      this.ghost = null;
      this.ghostKind = kind;
    }
    if (!kind) return;
    if (!this.ghost) {
      this.ghost = MeshBuilder.CreateBox(
        "placement",
        { width: SPECS[kind].size, height: 0.3, depth: SPECS[kind].size },
        this.scene,
      );
      this.ghost.isPickable = false;
    }
    const m = this.mat(
      valid ? "valid" : "invalid",
      valid ? "#8bd4b4" : "#e07560",
    );
    m.alpha = 0.6;
    this.ghost.material = m;
    if (p) this.ghost.position.set(p.x, 0.2, p.z);
  }
  marker(p: Point, attack = false) {
    const mesh = MeshBuilder.CreateTorus(
      "command",
      { diameter: 1.4, thickness: 0.07, tessellation: 24 },
      this.scene,
    );
    mesh.position.set(p.x, 0.1, p.z);
    mesh.material = this.mat(
      attack ? "attack-mark" : "move-mark",
      attack ? "#ee9b70" : "#d0e1ac",
      true,
    );
    mesh.isPickable = false;
    this.effects.push({ mesh, life: 0.5, max: 0.5 });
  }
  reset() {
    for (const v of this.views.values()) v.root.dispose();
    this.views.clear();
    for (const e of this.effects) e.mesh.dispose();
    this.effects = [];
    this.preview(null);
    this.fogSnap = true;
    this.focus = { x: 32, z: 29 };
    this.zoom = Battlefield.ZOOM_DEFAULT;
    this.updateCamera();
  }
}
