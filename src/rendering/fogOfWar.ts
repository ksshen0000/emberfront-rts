import { MaterialPluginBase } from "@babylonjs/core/Materials/materialPluginBase";
import type { Material } from "@babylonjs/core/Materials/material";
import type { MaterialDefines } from "@babylonjs/core/Materials/materialDefines";
import type { UniformBuffer } from "@babylonjs/core/Materials/uniformBuffer";
import type { BaseTexture } from "@babylonjs/core/Materials/Textures/baseTexture";
import { SIZE } from "../simulation/config";

// Fog-of-war brightness per map cell state, applied as a color multiplier.
export const FOG_VISIBLE = 1,
  FOG_EXPLORED = 0.45,
  FOG_UNEXPLORED = 0.08;

/**
 * Darkens every fragment by the fog texture sampled at its world XZ position.
 * One texel per map cell with bilinear filtering gives soft fog edges, and tall
 * meshes are shaded per fragment, so a building half in fog is half darkened.
 */
export class FogOfWarPlugin extends MaterialPluginBase {
  constructor(
    material: Material,
    private texture: () => BaseTexture,
  ) {
    super(material, "FogOfWar", 300, { FOGOFWAR: false });
    this._enable(true);
  }
  getClassName() {
    return "FogOfWarPlugin";
  }
  prepareDefines(defines: MaterialDefines) {
    defines["FOGOFWAR"] = true;
  }
  getSamplers(samplers: string[]) {
    samplers.push("fogOfWarSampler");
  }
  bindForSubMesh(uniformBuffer: UniformBuffer) {
    uniformBuffer.setTexture("fogOfWarSampler", this.texture());
  }
  getCustomCode(shaderType: string) {
    return shaderType === "fragment"
      ? {
          CUSTOM_FRAGMENT_DEFINITIONS: "uniform sampler2D fogOfWarSampler;",
          CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: `color.rgb *= texture2D(fogOfWarSampler, vPositionW.xz / ${SIZE}.0).r;`,
        }
      : null;
  }
}
