/** Shared GLSL snippets embedded into map and globe shader strings. */

// Scientific color ramp: blue → cyan → yellow → red
export const GLSL_COLOR_RAMP = /* glsl */ `
vec3 colorRamp(float t) {
  t = clamp(t, 0.0, 1.0);
  if (t < 0.25)      return vec3(0.0, t * 4.0, 1.0);
  else if (t < 0.5)  return vec3(0.0, 1.0, 1.0 - (t - 0.25) * 4.0);
  else if (t < 0.75) return vec3((t - 0.5) * 4.0, 1.0, 0.0);
  else               return vec3(1.0, 1.0 - (t - 0.75) * 4.0, 0.0);
}
`

// Density-to-color utilities. Host shader provides colorRamp(),
// uDivergingBaseAlpha, uContours, and uContourCount.
// divergingMode=false maps 0..1 sequentially; true treats 0.5 as neutral.
export const GLSL_DENSITY_TO_COLOR = /* glsl */ `
// CPU-baked 256x1 attribution ramp; one lookup keeps shader startup cheap.
vec3 attributionColorRamp(float t, sampler2D customColormap) {
  return texture(customColormap, vec2(clamp(t, 0.0, 1.0), 0.5)).rgb;
}

// Returns vec4(rgb, alpha_factor). Multiply alpha_factor by uAlpha externally.
vec4 densityToColor(
  float density,
  bool divergingMode,
  bool importedFlatDivergingAlphaMode,
  bool importedFlatSequentialAlphaMode,
  int colorSchemeId,
  sampler2D customColormap
) {
  if (divergingMode) {
    float dist = abs(density - 0.5) * 2.0;
    if (importedFlatDivergingAlphaMode) {
      float alpha = dist <= 0.025 ? 0.0 : smoothstep(0.025, 0.18, dist);
      return vec4(attributionColorRamp(density, customColormap), alpha);
    }
    return vec4(attributionColorRamp(density, customColormap), mix(uDivergingBaseAlpha, 1.0, pow(dist, 1.35)));
  } else {
    if (importedFlatSequentialAlphaMode) {
      if (density < 0.015) return vec4(0.0);
      float visualDensity = pow(clamp(density, 0.0, 1.0), 0.65);
      float alpha = smoothstep(0.015, 0.18, density);
      return vec4(attributionColorRamp(visualDensity, customColormap), alpha);
    }
    if (density < 0.01) return vec4(0.0);
    if (colorSchemeId != 0) {
      return vec4(attributionColorRamp(sqrt(density), customColormap), density * density);
    }
    return vec4(colorRamp(sqrt(density)), density * density);
  }
}

// Anti-aliased isolines at uContourCount levels. The caller supplies df because
// fwidth() inside the raymarch loop is unreliable on ANGLE/D3D11.
vec4 densityToContours(
  float density,
  bool divergingMode,
  sampler2D customColormap,
  float df
) {
  float mag = divergingMode ? abs(density - 0.5) * 2.0 : density;
  float levels = mag * uContourCount;
  // df is computed by the caller outside non-uniform raymarch control flow.

  float deadband = divergingMode ? 0.05 : 0.04;
  if (mag <= deadband) return vec4(0.0);

  float nearest = floor(levels + 0.5);
  if (nearest < 0.5) return vec4(0.0); // never draw the zero isoline

  float dist = abs(levels - nearest);

  // Clamp screen-derived width so derivatives cannot erase lines or fill bands.
  float halfWidth = clamp(df * 1.2, 0.016, 0.09);
  float edge = max(df, 0.004); // anti-aliased falloff, ~1px, with a smooth floor
  float line = 1.0 - smoothstep(halfWidth, halfWidth + edge, dist);
  if (line < 0.01) return vec4(0.0);

  // Compress the ramp so even the lowest isoline is clearly tinted.
  float iso = clamp(nearest / uContourCount, 0.0, 1.0);
  vec3 rgb;
  if (divergingMode) {
    float offset = mix(0.18, 0.5, iso);
    rgb = attributionColorRamp(0.5 + sign(density - 0.5) * offset, customColormap);
  } else {
    rgb = attributionColorRamp(mix(0.3, 1.0, iso), customColormap);
  }
  return vec4(rgb, line);
}

// Style dispatch between the filled heatmap and contour-line depictions.
vec4 densityToColorStyled(
  float density,
  bool divergingMode,
  bool importedFlatDivergingAlphaMode,
  bool importedFlatSequentialAlphaMode,
  int colorSchemeId,
  sampler2D customColormap,
  float contourDf
) {
  if (uContours) return densityToContours(
    density,
    divergingMode,
    customColormap,
    contourDf
  );
  return densityToColor(
    density,
    divergingMode,
    importedFlatDivergingAlphaMode,
    importedFlatSequentialAlphaMode,
    colorSchemeId,
    customColormap
  );
}
`

// Overlay colormap IDs match OVERLAY_COLORMAPS; custom ramps use lookup textures.
export const GLSL_OVERLAY_COLORMAPS = /* glsl */ `
vec3 overlayViridis(float t) {
  t = clamp(t, 0.0, 1.0);
  // 9 ColorBrewer-derived anchor points matching matplotlib viridis
  vec3 c0  = vec3(0.267, 0.005, 0.329);
  vec3 c1  = vec3(0.283, 0.141, 0.458);
  vec3 c2  = vec3(0.254, 0.265, 0.530);
  vec3 c3  = vec3(0.207, 0.372, 0.553);
  vec3 c4  = vec3(0.164, 0.471, 0.558);
  vec3 c5  = vec3(0.128, 0.566, 0.551);
  vec3 c6  = vec3(0.135, 0.659, 0.518);
  vec3 c7  = vec3(0.267, 0.749, 0.441);
  vec3 c8  = vec3(0.478, 0.821, 0.318);
  vec3 c9  = vec3(0.741, 0.873, 0.150);
  vec3 c10 = vec3(0.993, 0.906, 0.144);

  if (t < 0.1) return mix(c0, c1,  t / 0.1);
  if (t < 0.2) return mix(c1, c2,  (t - 0.1) / 0.1);
  if (t < 0.3) return mix(c2, c3,  (t - 0.2) / 0.1);
  if (t < 0.4) return mix(c3, c4,  (t - 0.3) / 0.1);
  if (t < 0.5) return mix(c4, c5,  (t - 0.4) / 0.1);
  if (t < 0.6) return mix(c5, c6,  (t - 0.5) / 0.1);
  if (t < 0.7) return mix(c6, c7,  (t - 0.6) / 0.1);
  if (t < 0.8) return mix(c7, c8,  (t - 0.7) / 0.1);
  if (t < 0.9) return mix(c8, c9,  (t - 0.8) / 0.1);
  return mix(c9, c10, (t - 0.9) / 0.1);
}

vec3 overlayPlasma(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 c0  = vec3(0.050, 0.030, 0.528);
  vec3 c1  = vec3(0.212, 0.019, 0.590);
  vec3 c2  = vec3(0.350, 0.016, 0.619);
  vec3 c3  = vec3(0.477, 0.055, 0.609);
  vec3 c4  = vec3(0.590, 0.121, 0.569);
  vec3 c5  = vec3(0.694, 0.197, 0.507);
  vec3 c6  = vec3(0.788, 0.280, 0.429);
  vec3 c7  = vec3(0.872, 0.371, 0.339);
  vec3 c8  = vec3(0.942, 0.478, 0.237);
  vec3 c9  = vec3(0.982, 0.605, 0.128);
  vec3 c10 = vec3(0.940, 0.975, 0.131);

  if (t < 0.1) return mix(c0, c1,  t / 0.1);
  if (t < 0.2) return mix(c1, c2,  (t - 0.1) / 0.1);
  if (t < 0.3) return mix(c2, c3,  (t - 0.2) / 0.1);
  if (t < 0.4) return mix(c3, c4,  (t - 0.3) / 0.1);
  if (t < 0.5) return mix(c4, c5,  (t - 0.4) / 0.1);
  if (t < 0.6) return mix(c5, c6,  (t - 0.5) / 0.1);
  if (t < 0.7) return mix(c6, c7,  (t - 0.6) / 0.1);
  if (t < 0.8) return mix(c7, c8,  (t - 0.7) / 0.1);
  if (t < 0.9) return mix(c8, c9,  (t - 0.8) / 0.1);
  return mix(c9, c10, (t - 0.9) / 0.1);
}

// thermal: deep blue (cold) → cyan → yellow → deep red (hot)
vec3 overlayThermal(float t) {
  t = clamp(t, 0.0, 1.0);
  if (t < 0.25)      return vec3(0.0, t * 4.0, 1.0);
  else if (t < 0.5)  return vec3(0.0, 1.0, 1.0 - (t - 0.25) * 4.0);
  else if (t < 0.75) return vec3((t - 0.5) * 4.0, 1.0, 0.0);
  else               return vec3(1.0, 1.0 - (t - 0.75) * 4.0, 0.0);
}

// sequential: white → dark blue (simple perceptually uniform ramp)
vec3 overlaySequential(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 white  = vec3(0.98, 0.98, 0.98);
  vec3 light  = vec3(0.74, 0.85, 0.93);
  vec3 mid    = vec3(0.32, 0.62, 0.82);
  vec3 dark   = vec3(0.09, 0.38, 0.60);
  vec3 vdark  = vec3(0.03, 0.15, 0.37);

  if (t < 0.25) return mix(white, light, t / 0.25);
  if (t < 0.5)  return mix(light, mid,   (t - 0.25) / 0.25);
  if (t < 0.75) return mix(mid,   dark,  (t - 0.5)  / 0.25);
  return mix(dark, vdark, (t - 0.75) / 0.25);
}

// Integer dispatch: 0=viridis, 1=plasma, 2=thermal, 3=sequential
vec3 applyOverlayColormap(float t, int id) {
  if (id == 1) return overlayPlasma(t);
  if (id == 2) return overlayThermal(t);
  if (id == 3) return overlaySequential(t);
  return overlayViridis(t);
}
`

// 3-tap Z blur. Host shader provides uTexPrev, uTexNext, and uSmoothing.
export const GLSL_SAMPLE_DENSITY = /* glsl */ `
// Cubic B-spline weights for fast (4-tap) bicubic texture filtering.
vec4 cubicBSplineWeights(float v) {
  vec4 n = vec4(1.0, 2.0, 3.0, 4.0) - v;
  vec4 s = n * n * n;
  float x = s.x;
  float y = s.y - 4.0 * s.x;
  float z = s.z - 4.0 * s.y + 6.0 * s.x;
  float w = 6.0 - x - y - z;
  return vec4(x, y, z, w) * (1.0 / 6.0);
}

// Fast bicubic XY reconstruction via four hardware-bilinear lookups.
// Keeps contours smooth without the ANGLE compile cost of 16 taps.
float sampleDensityBicubicXY(sampler3D tex, vec3 uvw) {
  ivec3 isz = textureSize(tex, 0);
  if (isz.x <= 1 || isz.y <= 1) return texture(tex, uvw).r; // empty placeholder

  vec2 texSize = vec2(isz.xy);
  vec2 invTexSize = 1.0 / texSize;

  vec2 tc = uvw.xy * texSize - 0.5;
  vec2 fxy = fract(tc);
  tc -= fxy;

  vec4 xw = cubicBSplineWeights(fxy.x);
  vec4 yw = cubicBSplineWeights(fxy.y);

  vec4 c = tc.xxyy + vec2(-0.5, 1.5).xyxy;
  vec4 s = vec4(xw.xz + xw.yw, yw.xz + yw.yw);
  vec4 offset = c + vec4(xw.yw, yw.yw) / s;
  offset *= invTexSize.xxyy;

  float z = uvw.z;
  float s0 = texture(tex, vec3(offset.x, offset.z, z)).r;
  float s1 = texture(tex, vec3(offset.y, offset.z, z)).r;
  float s2 = texture(tex, vec3(offset.x, offset.w, z)).r;
  float s3 = texture(tex, vec3(offset.y, offset.w, z)).r;

  float sx = s.x / (s.x + s.y);
  float sy = s.z / (s.z + s.w);
  return mix(mix(s3, s2, sx), mix(s1, s0, sx), sy);
}

float sampleDensityFromTexture(sampler3D tex, vec3 uvw) {
  if (uContours) {
    return sampleDensityBicubicXY(tex, uvw);
  }
  if (uSmoothing < 0.001) {
    return texture(tex, uvw).r;
  }
  float spread = uSmoothing * 0.15;
  float d0 = texture(tex, uvw - vec3(0.0, 0.0, spread)).r;
  float d1 = texture(tex, uvw).r;
  float d2 = texture(tex, uvw + vec3(0.0, 0.0, spread)).r;
  return (d0 + 2.0 * d1 + d2) * 0.25;
}

vec2 sampleDensityPair(vec3 uvw) {
  return vec2(
    sampleDensityFromTexture(uTexPrev, uvw),
    sampleDensityFromTexture(uTexNext, uvw)
  );
}
`
