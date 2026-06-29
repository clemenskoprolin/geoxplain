/**
 * GLSL shaders for the 2D flat weather-field overlay (Three.js GLSL3).
 *
 * Architecture:
 *   - Flat world-spanning quad at z=0 (same slab as VolumeOverlayLayer flat mode)
 *   - Mercator y → equirectangular v conversion (same mercToV helper)
 *   - One sampler2D per overlay; each mesh carries its own material
 *   - Preset integer dispatch, or a 1D lookup texture for custom gradients
 *
 * Globe reuse: the fragment shader body is intentionally small and self-contained —
 * the equirectangular UV sampling and colormap dispatch can be reused on the globe
 * sphere with a simple UV lookup, no ray-marching needed.
 */
import { GLSL_OVERLAY_COLORMAPS } from '@/shaders/shared'

export const overlayVertexShader = /* glsl */ `
out vec3 vWorldPos;

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

export const overlayFragmentShader = /* glsl */ `
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
uniform float     uWorldSize;
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

// Mercator y [0,1] → equirectangular v [0,1] (north=0, south=1)
float mercToV(float merc_y) {
  float lat = atan(sinh(PI * (1.0 - 2.0 * merc_y)));
  return (PI * 0.5 - lat) / PI;
}

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
  float u = fract(vWorldPos.x / uWorldSize);
  float v = mercToV(vWorldPos.y / uWorldSize);

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
