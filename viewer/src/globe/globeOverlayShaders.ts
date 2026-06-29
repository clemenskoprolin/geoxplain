/**
 * GLSL shaders for 2D weather-field overlays rendered on the globe sphere surface.
 *
 * UV mapping matches posToUVW in globe/shaders.ts:
 *   u = atan(x, z) / (2π) + 0.5   → 0 at lon −180°, 0.5 at lon 0°, 1 at lon +180°
 *   v = 1 − (asin(y) / π + 0.5)   → 0 at north pole, 1 at south pole
 *
 * This is identical to the texture layout produced by the Python encoder (row 0 = north),
 * so no additional flipping or offset is required.
 *
 * Preset colormap dispatch is shared from shaders/shared.ts. Custom overlay
 * gradients are sampled from a 1D lookup texture.
 */
import { GLSL_OVERLAY_COLORMAPS } from '@/shaders/shared'

export const globeOverlayVertexShader = /* glsl */ `
out vec3 vWorldPos;

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`

export const globeOverlayFragmentShader = /* glsl */ `
precision highp float;
precision highp sampler2D;

uniform sampler2D uTexPrev;
uniform sampler2D uTexNext;
uniform sampler2D uCustomColormapPrev;
uniform sampler2D uCustomColormapNext;
uniform float     uMix;            // data-frame crossfade (independent timeline)
uniform float     uAppearanceMix;  // opacity/colormap/stretch crossfade (independent timeline)
uniform float     uOpacityPrev;
uniform float     uOpacityNext;
uniform int       uColormapPrev;     // 0=viridis 1=plasma 2=thermal 3=sequential
uniform int       uColormapNext;
uniform bool      uUseCustomColormapPrev;
uniform bool      uUseCustomColormapNext;
uniform float     uStretchLowPrev;   // contrast-stretch lower bound [0, 1], default 0
uniform float     uStretchHighPrev;  // contrast-stretch upper bound [0, 1], default 1
uniform float     uStretchLowNext;
uniform float     uStretchHighNext;

in  vec3 vWorldPos;
out vec4 fragColor;

const float PI = 3.14159265358979323846;

${GLSL_OVERLAY_COLORMAPS}

vec4 styleOverlay(
  float density,
  sampler2D customColormap,
  int colormap,
  bool useCustomColormap,
  float stretchLow,
  float stretchHigh,
  float opacity
) {
  float t = clamp((density - stretchLow) / max(stretchHigh - stretchLow, 0.001), 0.0, 1.0);
  if (t < 0.004 || opacity <= 0.0001) return vec4(0.0);
  vec3 rgb = useCustomColormap
    ? texture(customColormap, vec2(t, 0.5)).rgb
    : applyOverlayColormap(t, colormap);
  float alpha = t * opacity;
  return vec4(rgb * alpha, alpha);
}

void main() {
  vec3 n = normalize(vWorldPos);

  // Equirectangular UV — identical convention to posToUVW in globe/shaders.ts.
  // three-globe puts lon=0 along +Z, lon=90° along +X.
  float lon = atan(n.x, n.z);               // [-PI, PI]
  float u   = lon / (2.0 * PI) + 0.5;       // [0, 1], 0 at lon −180°
  float lat = asin(clamp(n.y, -1.0, 1.0));  // [-PI/2, PI/2]
  float v   = 1.0 - (lat / PI + 0.5);       // [0, 1], 0 at north pole

  vec2 uv = vec2(u, v);
  float prevDensity = texture(uTexPrev, uv).r;
  float nextDensity = texture(uTexNext, uv).r;
  float density = mix(prevDensity, nextDensity, smoothstep(0.0, 1.0, uMix));

  vec4 prevStyled = styleOverlay(
    density,
    uCustomColormapPrev,
    uColormapPrev,
    uUseCustomColormapPrev,
    uStretchLowPrev,
    uStretchHighPrev,
    uOpacityPrev
  );
  vec4 nextStyled = styleOverlay(
    density,
    uCustomColormapNext,
    uColormapNext,
    uUseCustomColormapNext,
    uStretchLowNext,
    uStretchHighNext,
    uOpacityNext
  );
  vec4 premul = mix(prevStyled, nextStyled, smoothstep(0.0, 1.0, uAppearanceMix));
  if (premul.a < 0.005) discard;
  fragColor = vec4(premul.rgb / max(premul.a, 0.0001), premul.a);
}
`
