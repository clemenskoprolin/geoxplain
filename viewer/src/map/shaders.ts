/**
 * GLSL shaders for the map attribution overlay (Three.js GLSL3).
 *
 * Uses a ground-hugging box mesh and integrates the data texture vertically so
 * the map view stays flat while sharing the same color and contour functions as
 * the globe renderer.
 */
import { GLSL_COLOR_RAMP, GLSL_DENSITY_TO_COLOR, GLSL_SAMPLE_DENSITY } from '@/shaders/shared'

export const mapVolumeVertexShader = /* glsl */ `
out vec3 vWorldPos;

void main() {
  // modelMatrix transforms unit-box vertices into Mercator-pixel world coords.
  // projectionMatrix holds the full MapLibre MVP (camera view matrix is identity).
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

export const mapVolumeFragmentShader = /* glsl */ `
precision highp float;
precision highp sampler3D;
precision highp sampler2D;

uniform sampler3D uTexPrev;
uniform sampler3D uTexNext;
uniform float     uMix;
uniform float     uAlpha;
uniform int       uSteps;
uniform float     uWorldSize;
uniform float     uSmoothing;
uniform bool      uDivergingPrev;
uniform bool      uDivergingNext;
uniform bool      uImportedFlatDivergingAlphaPrev;
uniform bool      uImportedFlatDivergingAlphaNext;
uniform bool      uImportedFlatSequentialAlphaPrev;
uniform bool      uImportedFlatSequentialAlphaNext;
uniform int       uColorSchemePrev;
uniform int       uColorSchemeNext;
uniform sampler2D uCustomColormapPrev;
uniform sampler2D uCustomColormapNext;
uniform float     uDivergingBaseAlpha;
uniform bool      uContours;
uniform float     uContourCount;

in  vec3 vWorldPos;
out vec4 fragColor;

const float PI = 3.14159265358979323846;

${GLSL_COLOR_RAMP}

${GLSL_DENSITY_TO_COLOR}

// Convert Mercator y coordinate [0,1] to equirectangular v [0,1].
// Must match how buildVolumeData maps latitude: v=0 at north pole.
float mercToV(float merc_y) {
  float lat = atan(sinh(PI * (1.0 - 2.0 * merc_y)));
  return (PI * 0.5 - lat) / PI;
}

${GLSL_SAMPLE_DENSITY}

void main() {
  float mixFactor = smoothstep(0.0, 1.0, uMix);
  vec4 accumPrev = vec4(0.0);
  vec4 accumNext = vec4(0.0);

  float u = fract(vWorldPos.x / uWorldSize);
  float v = mercToV(vWorldPos.y / uWorldSize);

  // Screen-space contour gradient, evaluated ONCE here in uniform control flow
  // (uContours is a uniform, so the branch is coherent across the quad). Taking
  // fwidth() inside the column-integration loop below is undefined on ANGLE/D3D11
  // (Windows) and makes the contour lines vanish or smear; hoisting it here keeps
  // the line width consistent across GPUs.
  float contourDfPrev = 0.0;
  float contourDfNext = 0.0;
  if (uContours) {
    vec2 midDens = sampleDensityPair(vec3(u, v, 0.5));
    float midLevelsPrev = (uDivergingPrev ? abs(midDens.x - 0.5) * 2.0 : midDens.x) * uContourCount;
    float midLevelsNext = (uDivergingNext ? abs(midDens.y - 0.5) * 2.0 : midDens.y) * uContourCount;
    contourDfPrev = fwidth(midLevelsPrev);
    contourDfNext = fwidth(midLevelsNext);
  }

  // Bound the loop by the uSteps uniform (not a literal) so the D3D11/ANGLE
  // shader compiler cannot fully unroll it. A literal bound (e.g. < 48) makes
  // FXC duplicate the entire two-sided colour dispatch on every iteration,
  // which is what pushed the first-load (uncached) compile to ~10 s and froze
  // the GPU process on Windows. The runtime iteration count is identical, so
  // the rendered image is unchanged.
  for (int i = 0; i < uSteps; i++) {
    float w = (float(i) + 0.5) / float(uSteps);
    vec3 uvw = vec3(u, v, w);
    vec2 densities = sampleDensityPair(uvw);
    vec4 prevCol4 = densityToColorStyled(
      densities.x,
      uDivergingPrev,
      uImportedFlatDivergingAlphaPrev,
      uImportedFlatSequentialAlphaPrev,
      uColorSchemePrev,
      uCustomColormapPrev,
      contourDfPrev
    );
    vec4 nextCol4 = densityToColorStyled(
      densities.y,
      uDivergingNext,
      uImportedFlatDivergingAlphaNext,
      uImportedFlatSequentialAlphaNext,
      uColorSchemeNext,
      uCustomColormapNext,
      contourDfNext
    );
    if (prevCol4.a > 0.001) {
      float prevAlpha = prevCol4.a * uAlpha;
      accumPrev.rgb += (1.0 - accumPrev.a) * prevAlpha * prevCol4.rgb;
      accumPrev.a   += (1.0 - accumPrev.a) * prevAlpha;
    }
    if (nextCol4.a > 0.001) {
      float nextAlpha = nextCol4.a * uAlpha;
      accumNext.rgb += (1.0 - accumNext.a) * nextAlpha * nextCol4.rgb;
      accumNext.a   += (1.0 - accumNext.a) * nextAlpha;
    }
    if (accumPrev.a > 0.95 && accumNext.a > 0.95) break;
  }

  vec4 accum = mix(accumPrev, accumNext, mixFactor);
  if (accum.a < 0.005) discard;
  fragColor = vec4(accum.rgb / max(accum.a, 1e-4), accum.a);
}
`
