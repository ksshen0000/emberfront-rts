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
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
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
import { ABILITIES, heroSpec, specOf } from "../simulation/hero";
import { ParticlePool } from "./particles";
import { buildModel, type Part } from "./models";
import {
  LOWLAND,
  currentMap,
  WATER_LEVEL,
  heightAt,
  layout,
  mirror,
  terrainBlocking,
} from "../simulation/terrain";
// Height grid resolution: CELL samples per world unit, GRID cells across the map.
const CELL = 2,
  GRID = SIZE * CELL;
const smoothstep = (a: number, b: number, v: number) => {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
interface View {
  root: TransformNode;
  /** Selection ring and health bar; trees and mines have neither. */
  ring: InstancedMesh | null;
  bar: TransformNode | null;
  fill: InstancedMesh | null;
  fillColor: string;
  barWidth: number;
  body: InstancedMesh;
  hp: number;
  carry: InstancedMesh | null;
  carryKind: string;
  /** Hero mana bar fill, under the health bar. */
  mana: InstancedMesh | null;
  /** Spinning halo over a stunned unit's head. */
  stun: InstancedMesh | null;
  /** Ring at the feet of a unit frenzied by War Cry. */
  frenzy: InstancedMesh | null;
  /** Footprint half-width, for fog checks after the entity itself is gone. */
  half: number;
  /** Enemy building seen at least once: it stays drawn as last seen while fogged. */
  remembered: boolean;
}
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
  heights = new Float32Array((GRID + 1) * (GRID + 1));
  ripples!: DynamicTexture;
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
  /** Short one-off meshes: command markers, the slam ring, level-up halos. */
  effects: {
    mesh: Mesh;
    life: number;
    max: number;
    /** Ground height under a rising effect. */
    y?: number;
    /** Ring that widens flat along the ground to this scale. */
    flat?: number;
    /** Rises this far while fading. */
    rise?: number;
  }[] = [];
  fx = true;
  // Combat particles, 200 at most between them (requirements §6).
  sparks!: ParticlePool;
  dust!: ParticlePool;
  arrows!: ParticlePool;
  leaves!: ParticlePool;
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
    // Terrain heights on a half-unit grid, shared by the ground mesh, the
    // painted texture and everything that stands on the ground.
    const H = this.heights;
    for (let j = 0; j <= GRID; j++)
      for (let i = 0; i <= GRID; i++)
        H[j * (GRID + 1) + i] = heightAt(i / CELL, j / CELL);
    // Dark forest floor framing the playable area so map edges never show the
    // void. A frame, not a sheet: under the map it would cover the river.
    const border = 80;
    for (const [w, d, x, z] of [
      [SIZE + 2 * border, border, SIZE / 2, -border / 2],
      [SIZE + 2 * border, border, SIZE / 2, SIZE + border / 2],
      [border, SIZE, -border / 2, SIZE / 2],
      [border, SIZE, SIZE + border / 2, SIZE / 2],
    ]) {
      const outskirts = MeshBuilder.CreateGround(
        "outskirts",
        { width: w, height: d },
        this.scene,
      );
      outskirts.position.set(x, LOWLAND, z);
      outskirts.material = this.mat("outskirts", "#34452f");
      outskirts.isPickable = false;
      outskirts.receiveShadows = true;
    }
    const ground = MeshBuilder.CreateGround(
      "ground",
      { width: SIZE, height: SIZE, subdivisions: GRID, updatable: true },
      this.scene,
    );
    ground.position.set(SIZE / 2, 0, SIZE / 2);
    const positions = ground.getVerticesData(VertexBuffer.PositionKind)!;
    for (let v = 0; v < positions.length; v += 3)
      positions[v + 1] = this.height(
        positions[v] + SIZE / 2,
        positions[v + 2] + SIZE / 2,
      );
    ground.updateVerticesData(VertexBuffer.PositionKind, positions);
    const normals: number[] = [];
    VertexData.ComputeNormals(positions, ground.getIndices()!, normals);
    ground.updateVerticesData(VertexBuffer.NormalKind, normals);
    ground.refreshBoundingInfo();
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
    const resources = layout();
    // Shaded forest floor under every woodline.
    for (const t of resources)
      if (t.kind === "tree") blob(px(t.x), pz(t.z), 3.2 * k, "#2f42305c");
    // Worn dirt road from base to base through the map centre, drawn as a
    // smooth curve in soft layers.
    const half = currentMap().road;
    const route = [...half, ...half.slice(0, -1).reverse().map(mirror)];
    const road = (width: number, color: string) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(px(route[0].x), pz(route[0].z));
      for (let i = 1; i < route.length - 1; i++) {
        const mid = {
          x: (route[i].x + route[i + 1].x) / 2,
          z: (route[i].z + route[i + 1].z) / 2,
        };
        ctx.quadraticCurveTo(
          px(route[i].x),
          pz(route[i].z),
          px(mid.x),
          pz(mid.z),
        );
      }
      const last = route[route.length - 1];
      ctx.lineTo(px(last.x), pz(last.z));
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
    // Trampled earth around every gold mine.
    for (const g of resources)
      if (g.kind === "gold") blob(px(g.x), pz(g.z), 110, "#7b7155cc");
    // Terrain classes from height and slope: cliff rock, ramp dirt, plateau
    // grass, shore sand and riverbed, blended over the painted ground so its
    // grain shows through.
    const tint = new Float32Array((GRID + 1) * (GRID + 1) * 4);
    for (let j = 0; j <= GRID; j++)
      for (let i = 0; i <= GRID; i++) {
        const at = (ii: number, jj: number) =>
            H[
              Math.min(GRID, Math.max(0, jj)) * (GRID + 1) +
                Math.min(GRID, Math.max(0, ii))
            ],
          h = at(i, j),
          slope =
            Math.hypot(
              at(i + 1, j) - at(i - 1, j),
              at(i, j + 1) - at(i, j - 1),
            ) *
            (CELL / 2);
        const layers: [number, number, number, number][] = [
          // Underwater: dark riverbed, deeper is darker.
          [0.2, 0.27, 0.24, smoothstep(WATER_LEVEL + 0.05, -0.7, h)],
          // Shore: pale sand just above the waterline.
          [
            0.62,
            0.57,
            0.43,
            0.85 *
              (1 - smoothstep(0.08, 0.22, Math.abs(h - WATER_LEVEL - 0.08))),
          ],
          // Hill and plateau tops: sunlit, drier grass, paler the higher.
          [
            0.47,
            0.53,
            0.33,
            0.18 * smoothstep(0.75, 1.0, h) + 0.14 * smoothstep(1.3, 1.7, h),
          ],
          // Ramps: trodden dirt where the slope is walkable.
          [
            0.55,
            0.49,
            0.36,
            0.75 *
              smoothstep(0.1, 0.2, slope) *
              (1 - smoothstep(0.4, 0.55, slope)) *
              smoothstep(0.5, 0.8, h),
          ],
          // Cliff faces: bare rock.
          [0.46, 0.44, 0.38, smoothstep(0.5, 1.0, slope)],
        ];
        let r = 0,
          g = 0,
          b = 0,
          w = 0;
        for (const [lr, lg, lb, la] of layers) {
          r = r * (1 - la) + lr * la;
          g = g * (1 - la) + lg * la;
          b = b * (1 - la) + lb * la;
          w = w * (1 - la) + la;
        }
        const o = (j * (GRID + 1) + i) * 4;
        // Store premultiplied colour so interpolation stays clean at edges.
        tint[o] = r;
        tint[o + 1] = g;
        tint[o + 2] = b;
        tint[o + 3] = w;
      }
    const image = ctx.getImageData(0, 0, T, T),
      data = image.data,
      perCell = T / GRID;
    for (let y = 0; y < T; y++) {
      // Grid row j counts from the south edge; texture rows from the north.
      const gz = (T - 1 - y + 0.5) / perCell,
        j0 = Math.min(GRID - 1, Math.floor(gz)),
        fz = gz - j0;
      for (let x = 0; x < T; x++) {
        const gx = (x + 0.5) / perCell,
          i0 = Math.min(GRID - 1, Math.floor(gx)),
          fx = gx - i0,
          o00 = (j0 * (GRID + 1) + i0) * 4,
          o10 = o00 + 4,
          o01 = o00 + (GRID + 1) * 4,
          o11 = o01 + 4,
          w00 = (1 - fx) * (1 - fz),
          w10 = fx * (1 - fz),
          w01 = (1 - fx) * fz,
          w11 = fx * fz,
          a =
            tint[o00 + 3] * w00 +
            tint[o10 + 3] * w10 +
            tint[o01 + 3] * w01 +
            tint[o11 + 3] * w11;
        if (a < 0.01) continue;
        const p = (y * T + x) * 4,
          // Keep the painted grain: scale the layer colour by local brightness.
          grain = (data[p] + data[p + 1] + data[p + 2]) / (3 * 105);
        for (let c = 0; c < 3; c++) {
          const layer =
            tint[o00 + c] * w00 +
            tint[o10 + c] * w10 +
            tint[o01 + c] * w01 +
            tint[o11 + c] * w11;
          data[p + c] =
            data[p + c] * (1 - a) + Math.min(255, layer * 255 * grain) * a;
        }
      }
    }
    ctx.putImageData(image, 0, 0);
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
    // Water: one translucent sheet at the waterline; the ground hides it on land.
    const ripples = new DynamicTexture(
      "ripples",
      { width: 256, height: 256 },
      this.scene,
      true,
    );
    const rctx = ripples.getContext() as CanvasRenderingContext2D;
    rctx.fillStyle = "#3d7480";
    rctx.fillRect(0, 0, 256, 256);
    rctx.lineCap = "round";
    for (let i = 0; i < 140; i++) {
      const x = random() * 256,
        y = random() * 256,
        w = 8 + random() * 26;
      rctx.strokeStyle = random() < 0.5 ? "#7fb3b866" : "#2b5a6366";
      rctx.lineWidth = 1 + random() * 1.5;
      rctx.beginPath();
      rctx.moveTo(x, y);
      rctx.quadraticCurveTo(x + w / 2, y - 2, x + w, y);
      rctx.stroke();
    }
    ripples.update(true);
    ripples.uScale = ripples.vScale = 10;
    this.ripples = ripples;
    const water = MeshBuilder.CreateGround(
      "water",
      { width: SIZE, height: SIZE },
      this.scene,
    );
    water.position.set(SIZE / 2, WATER_LEVEL, SIZE / 2);
    const waterMat = this.mat("water", "#ffffff");
    waterMat.diffuseTexture = ripples;
    waterMat.alpha = 0.78;
    waterMat.specularColor = Color3.FromHexString("#a9d2d6");
    waterMat.specularPower = 48;
    // Units wading through a ford stay visible above the surface.
    waterMat.disableDepthWrite = true;
    water.material = waterMat;
    water.isPickable = false;
    // Nonblocking scenery: each kind is one mesh drawn with thin instances.
    // Matrices are collected first and uploaded as one static buffer.
    const scatter = (
      template: Mesh,
      count: number,
      place: () => [number, number, number, number] | null,
    ) => {
      template.isPickable = false;
      template.receiveShadows = true;
      const matrices: number[] = [];
      for (let i = 0; i < count; i++) {
        const p = place();
        if (!p) continue;
        const [x, z, scale, yaw] = p;
        Matrix.Compose(
          new Vector3(scale, scale * (0.8 + random() * 0.5), scale),
          Quaternion.RotationYawPitchRoll(yaw, 0, 0),
          new Vector3(x, this.height(x, z), z),
        ).copyToArray(matrices, matrices.length);
      }
      template.thinInstanceSetBuffer(
        "matrix",
        new Float32Array(matrices),
        16,
        true,
      );
      template.thinInstanceRefreshBoundingInfo();
      return template;
    };
    const blocked = terrainBlocking();
    const clearOf = (x: number, z: number) =>
      [
        [24, 24],
        [SIZE - 24, SIZE - 24],
      ].every(([bx, bz]) => Math.hypot(x - bx, z - bz) > 8) &&
      // Dry, gentle ground only: no flowers on cliffs or in the river.
      !blocked[Math.floor(z) * SIZE + Math.floor(x)] &&
      this.height(x, z) > WATER_LEVEL + 0.15;
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
    // Separate meshes, not clones: a clone shares geometry, and with it the
    // thin-instance buffer, so two scatters would overwrite each other.
    for (const [name, color, count] of [
      ["flower", "#e8d9a0", 260],
      ["flower-red", "#d98a73", 140],
    ] as const) {
      const flower = MeshBuilder.CreateSphere(
        name,
        { diameter: 0.16, segments: 2 },
        this.scene,
      );
      flower.bakeTransformIntoVertices(Matrix.Translation(0, 0.1, 0));
      flower.material = this.mat(name, color);
      scatter(flower, count, field);
    }
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
    // Rubble along every cliff face, so plateaus read as rock walls.
    const cliffs: Point[] = [];
    for (let z = 0; z < SIZE; z++)
      for (let x = 0; x < SIZE; x++) {
        const h = this.height(x + 0.5, z + 0.5);
        if (blocked[z * SIZE + x] && h > WATER_LEVEL + 0.3)
          cliffs.push({ x, z });
      }
    const rubble = MeshBuilder.CreatePolyhedron(
      "rubble",
      { type: 2, size: 0.55 },
      this.scene,
    );
    rubble.scaling.y = 0.75;
    rubble.bakeCurrentTransformIntoVertices();
    rubble.convertToFlatShadedMesh();
    rubble.material = this.mat("rubble", "#80796a");
    let next = 0;
    scatter(rubble, cliffs.length * 2, () => {
      const c = cliffs[next++ % cliffs.length];
      return random() < 0.6
        ? [
            c.x + random(),
            c.z + random(),
            0.5 + random() * 0.9,
            random() * 6.28,
          ]
        : null;
    });
    this.shadows.addShadowCaster(rubble);
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
    this.prewarm();
  }
  /**
   * Compiles effect shaders up front. A material compiles on first use, and a
   * half-second effect can end before its shader is ready (or stall a frame).
   */
  prewarm() {
    // Particle pools stay active from the first frame, so their shaders
    // compile at startup with the rest of the scene.
    const spark = MeshBuilder.CreateBox("sparks", { size: 0.16 }, this.scene);
    spark.material = this.mat("spark", "#ffe1a0", true);
    this.sparks = new ParticlePool(spark, 80);
    const dust = MeshBuilder.CreatePolyhedron(
      "dust",
      { type: 1, size: 0.5 },
      this.scene,
    );
    dust.material = this.mat("dust", "#d2c7a6");
    this.dust = new ParticlePool(dust, 60);
    const arrow = MeshBuilder.CreateBox(
      "arrows",
      { width: 0.06, height: 0.06, depth: 0.75 },
      this.scene,
    );
    arrow.material = this.mat("arrow", "#f3e3b4", true);
    this.arrows = new ParticlePool(arrow, 40);
    const leaf = MeshBuilder.CreateBox(
      "leaves",
      { width: 0.2, height: 0.04, depth: 0.12 },
      this.scene,
    );
    leaf.material = this.mat("leaf-glow", "#9be38a", true);
    this.leaves = new ParticlePool(leaf, 20);
    const probe = MeshBuilder.CreateBox("probe", { size: 0.1 }, this.scene);
    probe.isPickable = false;
    probe.setEnabled(false);
    const once = (
      [
        ["slam", "#f0d79a", true],
        ["war-cry", "#ee6a4c", true],
        ["bloom", "#9be38a", true],
        ["levelup", "#ffe08a", true],
        ["move-mark", "#d0e1ac", true],
        ["attack-mark", "#ee9b70", true],
      ] as const
    ).map(([name, hex, emissive]) =>
      this.mat(name, hex, emissive).forceCompilationAsync(probe),
    );
    // Overlays are instanced, which compiles a different shader variant.
    const instanced = (
      [
        ["stun", "#ffe08a"],
        ["frenzy", "#ee6a4c"],
        ["mana", "#6f9be0"],
      ] as const
    ).map(([name, hex]) =>
      this.mat(name, hex, true).forceCompilationAsync(probe, {
        useInstances: true,
      }),
    );
    void Promise.allSettled([...once, ...instanced]).then(() =>
      probe.dispose(),
    );
  }
  /** Ground height at a world position, bilinear on the terrain grid. */
  height(x: number, z: number) {
    const gx = Math.max(0, Math.min(GRID - 1e-6, x * CELL)),
      gz = Math.max(0, Math.min(GRID - 1e-6, z * CELL)),
      i = Math.floor(gx),
      j = Math.floor(gz),
      fx = gx - i,
      fz = gz - j,
      H = this.heights,
      o = j * (GRID + 1) + i;
    return (
      (H[o] * (1 - fx) + H[o + 1] * fx) * (1 - fz) +
      (H[o + GRID + 1] * (1 - fx) + H[o + GRID + 2] * fx) * fz
    );
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
      new Vector3(this.focus.x, LOWLAND, this.focus.z),
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
    const wood = this.mat("wood", "#85694a");
    const tone = Math.floor(hash(e.id, 1) * 3);
    const key =
      e.kind === "tree"
        ? `tree-${tone}`
        : e.owner === 2
          ? e.kind
          : `${e.kind}-${e.faction}-${e.owner}`;
    const body = this.instance(key, root, (part) => {
      const { box, cone } = part;
      if (isUnit(e.kind) || isBuilding(e.kind))
        buildModel(part, e.kind, e.faction, {
          team,
          mat: (name, hex, emissive) => this.mat(name, hex, emissive),
        });
      else if (e.kind === "tree") {
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
      // Slightly oversized figures read better at RTS camera distance;
      // the commander stands a head taller than the troops.
      body.scaling.setAll(e.kind === "hero" ? 1.55 : 1.2);
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
    const neutral = e.owner === 2,
      barWidth = isUnit(e.kind) ? 1.1 : 3;
    const backPlane = () => {
      const m = MeshBuilder.CreatePlane(
        "hp-back",
        { width: barWidth + 0.08, height: 0.2 },
        this.scene,
      );
      m.material = this.mat("hp-back", "#151b17", true);
      return m;
    };
    let ring: InstancedMesh | null = null,
      bar: TransformNode | null = null;
    // Hundreds of trees and mines are never selected and show no health, so
    // they skip the ring and bar entirely.
    if (!neutral) {
      const diameter = isUnit(e.kind) ? 1.25 : SPECS[e.kind].size * 1.35;
      ring = this.overlay(`ring-${diameter}-${e.owner === 1}`, root, () => {
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
      bar = new TransformNode("hp", this.scene);
      bar.parent = root;
      bar.position.y =
        e.kind === "hero"
          ? 2.55
          : isUnit(e.kind)
            ? 2
            : e.kind === "base"
              ? 6.4
              : 4.8;
      bar.rotation.x = Math.PI / 2 - this.camera.beta;
      this.overlay(`hp-back-${barWidth}`, bar, backPlane);
    }
    let mana: InstancedMesh | null = null;
    if (e.kind === "hero" && bar) {
      const back = this.overlay(`hp-back-${barWidth}`, bar, backPlane);
      back.position.y = -0.2;
      mana = this.overlay(`mana-${barWidth}`, bar, () => {
        const m = MeshBuilder.CreatePlane(
          "mana-fill",
          { width: barWidth, height: 0.12 },
          this.scene,
        );
        m.material = this.mat("mana", "#6f9be0", true);
        return m;
      });
    }
    root.position.set(e.x, this.height(e.x, e.z), e.z);
    if (neutral) {
      // Resources never move; skip their transform updates every frame.
      root.freezeWorldMatrix();
      body.freezeWorldMatrix();
    }
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
      mana,
      stun: null,
      frenzy: null,
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
    // Slow current along the river.
    this.ripples.uOffset = (this.ripples.uOffset + dt * 0.012) % 1;
    this.ripples.vOffset = (this.ripples.vOffset - dt * 0.008) % 1;
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
      // Resources are static once created.
      if (e.owner === 2) continue;
      if (hidden) {
        // Enemy units vanish in fog; enemy buildings keep their last seen state.
        if (!v.remembered) v.root.setEnabled(false);
        continue;
      }
      if (!v.root.isEnabled()) {
        v.root.setEnabled(true);
        v.root.position.set(e.x, this.height(e.x, e.z), e.z);
      }
      if (isBuilding(e.kind) && e.owner !== this.fogOwner) v.remembered = true;
      v.root.position.x += (e.x - v.root.position.x) * Math.min(1, dt * 22);
      v.root.position.z += (e.z - v.root.position.z) * Math.min(1, dt * 22);
      if (isUnit(e.kind))
        v.root.position.y = this.height(v.root.position.x, v.root.position.z);
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
      if (e.stun > 0 && !v.stun) {
        v.stun = this.overlay("stun", v.root, () => {
          const m = MeshBuilder.CreateTorus(
            "stun",
            { diameter: 0.55, thickness: 0.08, tessellation: 5 },
            this.scene,
          );
          m.material = this.mat("stun", "#ffe08a", true);
          m.renderingGroupId = 1;
          return m;
        });
        v.stun.position.y = e.kind === "hero" ? 2.2 : 1.75;
      } else if (e.stun <= 0 && v.stun) {
        v.stun.dispose();
        v.stun = null;
      }
      if (e.frenzy > 0 && !v.frenzy) {
        v.frenzy = this.overlay("frenzy", v.root, () => {
          const m = MeshBuilder.CreateTorus(
            "frenzy",
            { diameter: 0.95, thickness: 0.07, tessellation: 16 },
            this.scene,
          );
          m.material = this.mat("frenzy", "#ee6a4c", true);
          return m;
        });
        v.frenzy.position.y = 0.1;
      } else if (e.frenzy <= 0 && v.frenzy) {
        v.frenzy.dispose();
        v.frenzy = null;
      }
      if (v.stun) {
        v.stun.rotation.y = world.time * 6;
        v.stun.rotation.x = Math.sin(world.time * 9) * 0.25;
      }
      if (isUnit(e.kind)) {
        v.body.rotation.y = e.heading;
        v.body.position.y = e.path.length
          ? Math.sin(world.time * 14 + e.id) * 0.045
          : 0;
      } else if (isBuilding(e.kind))
        v.body.scaling.y = 0.15 + e.progress * 0.85;
      v.ring?.setEnabled(this.selection.has(e.id));
      const max = specOf(e).hp;
      v.bar?.setEnabled(
        this.selection.has(e.id) ||
          e.hp < max ||
          e.progress < 1 ||
          e.kind === "hero",
      );
      if (v.mana && e.hero) {
        const m = Math.max(
          0.01,
          e.hero.mana / heroSpec(e.hero.level, e.faction).mana,
        );
        v.mana.scaling.x = m;
        v.mana.position.set((-(1 - m) * v.barWidth) / 2, -0.2, -0.01);
      }
      const ratio = Math.max(0.01, e.hp / max);
      if (v.hp !== ratio) {
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
          v.fill = this.overlay(`hp-${name}-${v.barWidth}`, v.bar!, () => {
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
        (this.sees(world, effect.from) || this.sees(world, effect.to))
      ) {
        if (effect.burst) {
          this.burst(effect.burst, effect.to);
          continue;
        }
        const from = new Vector3(
            effect.from.x,
            1 + this.height(effect.from.x, effect.from.z),
            effect.from.z,
          ),
          to = new Vector3(
            effect.to.x,
            0.9 + this.height(effect.to.x, effect.to.z),
            effect.to.z,
          );
        if (effect.miss) {
          // A miss sails past the target and sticks in the ground beside it.
          const dx = effect.to.x - effect.from.x,
            dz = effect.to.z - effect.from.z,
            d = Math.hypot(dx, dz) || 1;
          to.x += (dx / d) * 0.8 + (dz / d) * 0.5;
          to.z += (dz / d) * 0.8 - (dx / d) * 0.5;
          to.y = 0.1 + this.height(to.x, to.z);
        }
        if (effect.ranged) {
          const d = Vector3.Distance(from, to);
          this.arrows.lob(from, to, Math.min(0.45, 0.12 + d * 0.035), d * 0.12);
        } else this.spray(to, 4);
      }
    for (const pool of this.pools()) {
      if (!this.fx) pool.clear();
      pool.update(dt);
    }
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const f = this.effects[i];
      f.life -= dt;
      const t = 1 - f.life / f.max;
      if (f.life <= 0) {
        f.mesh.dispose();
        this.effects.splice(i, 1);
      } else if (f.flat) {
        const k = 0.15 + f.flat * Math.sqrt(t);
        f.mesh.scaling.set(k, 1, k);
        f.mesh.visibility = 1 - t;
      } else if (f.rise) {
        f.mesh.position.y = (f.y ?? 0) + t * f.rise;
        f.mesh.visibility = 1 - t * t;
      } else f.mesh.scaling.setAll(1 - t);
    }
  }
  /** A hero ability's shockwave, or the golden halo of a hero gaining a level. */
  burst(kind: "slam" | "cry" | "bloom" | "levelup", at: Point) {
    const y = this.height(at.x, at.z);
    if (kind !== "levelup") {
      const a =
          ABILITIES[kind === "slam" ? "crown" : kind === "cry" ? "orc" : "elf"],
        [name, hex] =
          kind === "slam"
            ? ["slam", "#f0d79a"]
            : kind === "cry"
              ? ["war-cry", "#ee6a4c"]
              : ["bloom", "#9be38a"];
      // Unit-diameter ring scaled out to the ability's radius.
      const ring = MeshBuilder.CreateTorus(
        name,
        { diameter: 1, thickness: 0.12, tessellation: 32 },
        this.scene,
      );
      ring.material = this.mat(name, hex, true);
      ring.isPickable = false;
      ring.position.set(at.x, y + 0.15, at.z);
      this.effects.push({
        mesh: ring,
        life: 0.45,
        max: 0.45,
        flat: a.radius * 2,
      });
      for (let i = 0; i < 12; i++) {
        const t = (i / 12) * Math.PI * 2 + Math.random() * 0.4,
          v = a.radius * (1.6 + Math.random() * 0.6);
        if (kind === "slam")
          // Clods of earth thrown outward along the shockwave.
          this.dust.throw(
            at.x + Math.cos(t) * 0.6,
            y + 0.2,
            at.z + Math.sin(t) * 0.6,
            Math.cos(t) * v,
            2.2 + Math.random(),
            Math.sin(t) * v,
            0.45,
            0.45,
            9,
          );
        else if (kind === "cry")
          // Embers flung up around the Warlord.
          this.sparks.throw(
            at.x,
            y + 1.2,
            at.z,
            Math.cos(t) * 2.5,
            3 + Math.random() * 2,
            Math.sin(t) * 2.5,
            0.4,
            1.1,
            8,
          );
        else {
          // Leaves drifting up across the healed area.
          const r = Math.random() * a.radius;
          this.leaves.throw(
            at.x + Math.cos(t) * r,
            y + 0.3,
            at.z + Math.sin(t) * r,
            0,
            1.6 + Math.random(),
            0,
            0.5,
            1,
            -1,
          );
        }
      }
      return;
    }
    const halo = MeshBuilder.CreateTorus(
      "levelup",
      { diameter: 1.4, thickness: 0.1, tessellation: 24 },
      this.scene,
    );
    halo.material = this.mat("levelup", "#ffe08a", true);
    halo.isPickable = false;
    halo.position.set(at.x, y, at.z);
    this.effects.push({ mesh: halo, life: 0.5, max: 0.5, rise: 2.6, y });
  }
  /** A dust cloud where a unit (size ~1) or building (size ~4) fell. */
  puff(at: Vector3, size: number) {
    const y = this.height(at.x, at.z),
      n = size > 2 ? 12 : 5;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2,
        r = Math.random() * size * 0.4,
        v = 0.6 + Math.random() * size * 0.5;
      this.dust.throw(
        at.x + Math.cos(a) * r,
        y + 0.3,
        at.z + Math.sin(a) * r,
        Math.cos(a) * v,
        1 + Math.random() * 1.5,
        Math.sin(a) * v,
        0.5,
        0.3 + size * 0.1,
        // Dust slows and hangs rather than falling back.
        2,
      );
    }
  }
  /** Sparks flying off a melee hit. */
  spray(at: Vector3, n: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2,
        v = 2 + Math.random() * 2;
      this.sparks.throw(
        at.x,
        at.y,
        at.z,
        Math.cos(a) * v,
        1.5 + Math.random() * 2.5,
        Math.sin(a) * v,
        0.25,
        1,
        14,
      );
    }
  }
  pools() {
    return [this.sparks, this.dust, this.arrows, this.leaves];
  }
  particleCount() {
    return this.pools().reduce((n, p) => n + p.count, 0);
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
      new Vector3(p.x, this.height(p.x, p.z), p.z),
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
    if (p) this.ghost.position.set(p.x, this.height(p.x, p.z) + 0.2, p.z);
  }
  marker(p: Point, attack = false) {
    const mesh = MeshBuilder.CreateTorus(
      "command",
      { diameter: 1.4, thickness: 0.07, tessellation: 24 },
      this.scene,
    );
    mesh.position.set(p.x, this.height(p.x, p.z) + 0.1, p.z);
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
    for (const pool of this.pools()) pool.clear();
    this.preview(null);
    this.fogSnap = true;
    this.focus = { x: 32, z: 29 };
    this.zoom = Battlefield.ZOOM_DEFAULT;
    this.updateCamera();
  }
}
