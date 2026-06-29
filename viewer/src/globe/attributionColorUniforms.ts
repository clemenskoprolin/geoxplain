import * as THREE from 'three'
import type { AttributionColorScheme } from '@/types'
import { attributionColorSchemeId, attributionRampStops } from '@/lib/attributionColor'
import { buildOverlayColormapTexture } from '@/lib/overlayColor'

// Build the 256×1 LUT the shader samples for ALL colormaps (preset + custom).
// `diverging` only affects the `default` preset (RdBu_r vs the warm ramp).
export function colorSchemeTexture(
  scheme: AttributionColorScheme,
  diverging: boolean,
): THREE.DataTexture {
  return buildOverlayColormapTexture(attributionRampStops(scheme, diverging))
}

export function applyColorSchemeUniforms(
  material: THREE.ShaderMaterial,
  suffix: 'Prev' | 'Next',
  scheme: AttributionColorScheme,
  diverging: boolean,
) {
  material.uniforms[`uColorScheme${suffix}`].value = attributionColorSchemeId(scheme)
  const uniform = material.uniforms[`uCustomColormap${suffix}`]
  const previous = uniform.value as THREE.DataTexture | null
  uniform.value = colorSchemeTexture(scheme, diverging)
  previous?.dispose()
}
