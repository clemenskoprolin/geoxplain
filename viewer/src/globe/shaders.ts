/**
 * GLSL shaders for globe heatmap rendering.
 *
 * Raymarches a spherical shell between uRInner and uROuter,
 * sampling from two volume textures (prev/next) and crossfading via uMix.
 * Converts density to a scientific color ramp (blue→cyan→yellow→red).
 *
 * Shared GLSL functions (colorRamp, sampleDensity) are imported from shaders/shared.ts.
 */
import { GLSL_COLOR_RAMP, GLSL_DENSITY_TO_COLOR, GLSL_SAMPLE_DENSITY } from '@/shaders/shared'

export const vertexShader = /* glsl */ `
void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`

export const fragmentShader = /* glsl */ `
precision highp float;
precision highp sampler3D;
precision highp sampler2D;

uniform sampler3D uTexPrev;
uniform sampler3D uTexNext;
uniform float uMix;
uniform float uRInner;
uniform float uROuter;
uniform int uSteps;
uniform float uAlpha;
uniform float uSmoothing;
uniform bool uDivergingPrev;
uniform bool uDivergingNext;
uniform bool uImportedFlatDivergingAlphaPrev;
uniform bool uImportedFlatDivergingAlphaNext;
uniform bool uImportedFlatSequentialAlphaPrev;
uniform bool uImportedFlatSequentialAlphaNext;
uniform int uColorSchemePrev;
uniform int uColorSchemeNext;
uniform sampler2D uCustomColormapPrev;
uniform sampler2D uCustomColormapNext;
uniform float uDivergingBaseAlpha;
uniform bool uContours;
uniform float uContourCount;
uniform mat4 uInvProjectionView;
uniform vec2 uViewport;

out vec4 fragColor;

${GLSL_COLOR_RAMP}

${GLSL_DENSITY_TO_COLOR}

${GLSL_SAMPLE_DENSITY}

// Ray-sphere intersection: returns (tNear, tFar), negative = no hit
vec2 raySphere(vec3 ro, vec3 rd, float radius) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - radius * radius;
  float disc = b * b - c;
  if (disc < 0.0) return vec2(-1.0);
  float sq = sqrt(disc);
  return vec2(-b - sq, -b + sq);
}

// Convert world position on sphere to equirectangular UV + normalized altitude
vec3 posToUVW(vec3 pos, float rInner, float rOuter) {
  float r = length(pos);
  vec3 n = pos / r;
  // Longitude: three-globe puts lon=0 along +Z, lon=90 along +X → atan2(x, z)
  float lon = atan(n.x, n.z); // [-PI, PI]
  float u = lon / (2.0 * 3.14159265) + 0.5;
  // Latitude: asin(y) maps to [0,1] with v=0 at south pole
  float lat = asin(clamp(n.y, -1.0, 1.0));
  float v = 1.0 - (lat / 3.14159265 + 0.5); // v=0 at north pole (matches our raster)
  // Altitude normalized within shell
  float w = clamp((r - rInner) / (rOuter - rInner), 0.0, 1.0);
  return vec3(u, v, w);
}

void main() {
  // Reconstruct the camera ray from the actual screen pixel instead of the
  // interpolated proxy sphere position. Using the proxy directly creates an
  // inner "ghost globe" because each triangle linearly interpolates through
  // the sphere, which makes horizon culling drift inward.
  vec2 ndc = (gl_FragCoord.xy / uViewport) * 2.0 - 1.0;
  vec4 farH = uInvProjectionView * vec4(ndc, 1.0, 1.0);
  farH /= farH.w;
  vec3 ro = cameraPosition;
  vec3 rd = normalize(farH.xyz - ro);

  // Intersect outer and inner spheres
  vec2 tOuter = raySphere(ro, rd, uROuter);
  vec2 tInner = raySphere(ro, rd, uRInner);

  if (tOuter.x < 0.0 && tOuter.y < 0.0) discard;

  // Entry/exit through the shell
  float tEnter, tExit;
  if (tInner.x > 0.0) {
    // Camera outside inner sphere: shell = [tOuter.x, tInner.x] (front shell)
    tEnter = max(tOuter.x, 0.0);
    tExit = tInner.x;
  } else {
    // Camera inside the shell or inner sphere: shell = [max(0,tOuter.x), tOuter.y]
    tEnter = max(tOuter.x, 0.0);
    tExit = tOuter.y;
  }

  if (tExit <= tEnter) discard;

  // Precompute mix factor once per fragment
  float mixFactor = smoothstep(0.0, 1.0, uMix);

  // Screen-space contour gradient, evaluated ONCE here in uniform control flow
  // (uContours is a uniform, so the branch is coherent across the quad). Taking
  // fwidth() inside the raymarch loop below is undefined on ANGLE/D3D11 (Windows)
  // and makes the contour lines vanish or smear; hoisting it here keeps the line
  // width consistent across GPUs. The shell midpoint matches the rendered slice
  // exactly for the flat imported overlay (uSteps == 1).
  float contourDfPrev = 0.0;
  float contourDfNext = 0.0;
  if (uContours) {
    float tMid = 0.5 * (tEnter + tExit);
    vec3 midUvw = posToUVW(ro + rd * tMid, uRInner, uROuter);
    vec2 midDens = sampleDensityPair(midUvw);
    float midLevelsPrev = (uDivergingPrev ? abs(midDens.x - 0.5) * 2.0 : midDens.x) * uContourCount;
    float midLevelsNext = (uDivergingNext ? abs(midDens.y - 0.5) * 2.0 : midDens.y) * uContourCount;
    contourDfPrev = fwidth(midLevelsPrev);
    contourDfNext = fwidth(midLevelsNext);
  }

  // Front-to-back compositing
  vec4 accumPrev = vec4(0.0);
  vec4 accumNext = vec4(0.0);
  float stepSize = (tExit - tEnter) / float(uSteps);

  // Bound the loop by the uSteps uniform (not a literal) so the D3D11/ANGLE
  // shader compiler cannot fully unroll it. A literal bound (e.g. < 24) makes
  // FXC duplicate the entire two-sided colour dispatch on every iteration,
  // which is what pushed the first-load (uncached) compile to ~10 s and froze
  // the GPU process on Windows. The runtime iteration count is identical, so
  // the rendered image is unchanged.
  for (int i = 0; i < uSteps; i++) {
    float t = tEnter + (float(i) + 0.5) * stepSize;
    vec3 pos = ro + rd * t;
    vec3 uvw = posToUVW(pos, uRInner, uROuter);

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
      accumPrev.a += (1.0 - accumPrev.a) * prevAlpha;
    }
    if (nextCol4.a > 0.001) {
      float nextAlpha = nextCol4.a * uAlpha;
      accumNext.rgb += (1.0 - accumNext.a) * nextAlpha * nextCol4.rgb;
      accumNext.a += (1.0 - accumNext.a) * nextAlpha;
    }

    if (accumPrev.a > 0.95 && accumNext.a > 0.95) break;
  }

  vec4 accum = mix(accumPrev, accumNext, mixFactor);
  if (accum.a < 0.005) discard;

  fragColor = vec4(accum.rgb / max(accum.a, 1e-4), accum.a);
}
`
