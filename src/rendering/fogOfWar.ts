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
          // Fog also drains colour, so bright hues (the river's blue) do not
          // shine through the dark: unexplored ground is grey, explored ground
          // keeps some colour, and visible ground keeps all of it.
          CUSTOM_FRAGMENT_BEFORE_FRAGCOLOR: `
            float fogOfWar = texture2D(fogOfWarSampler, vPositionW.xz / ${SIZE}.0).r;
            float fogOfWarSat = sqrt(clamp((fogOfWar - ${FOG_UNEXPLORED}) / ${(1 - FOG_UNEXPLORED).toFixed(2)}, 0.0, 1.0));
            color.rgb = mix(vec3(dot(color.rgb, vec3(0.299, 0.587, 0.114))), color.rgb, fogOfWarSat) * fogOfWar;`,
        }
      : null;
  }
}
