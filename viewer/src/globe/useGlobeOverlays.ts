import { useEffect, useRef, type RefObject } from 'react'
import * as THREE from 'three'
import type { GlobeMethods } from 'react-globe.gl'
import type { OverlayColorStop, OverlayData, OverlayLayerState } from '@/types'
import { buildOverlayColormapTexture, overlayColormapId } from '@/lib/overlayColor'
import { globeOverlayVertexShader, globeOverlayFragmentShader } from '@/globe/globeOverlayShaders'
import { GLOBE_RADIUS } from '@/globe/constants'
import {
  applyGlobeOverlayAppearanceUniforms,
  applyGlobeOverlayEntryUniforms,
  buildOverlayTexture,
  disposeOverlayEntry,
  globeOverlayAppearance,
  globeOverlayAppearanceKey,
  type GlobeOverlayAppearance,
  type GlobeOverlayEntry,
} from '@/globe/globeOverlayEntry'

// Overlay sphere sits just above the globe surface, below the volume shell.
const R_OVERLAY = GLOBE_RADIUS * 1.001

interface GlobeOverlayParams {
  overlays?: Record<string, OverlayData> | null
  overlayStates: OverlayLayerState[]
  overlayFrameIndex: number
  blendMs: number
}

/**
 * Manage weather-field overlay meshes on the globe scene.
 * Each overlay slug gets one SphereGeometry mesh with equirectangular UV lookup.
 * Render order 1000 places them above the saliency volume (999) but below targets (1001).
 *
 * Owns its own mesh registry (`overlayMeshesRef`) and disposes it on unmount.
 */
export function useGlobeOverlays(
  globeRef: RefObject<GlobeMethods | undefined>,
  globeReady: boolean,
  { overlays, overlayStates, overlayFrameIndex, blendMs }: GlobeOverlayParams,
) {
  const overlayMeshesRef = useRef<Map<string, GlobeOverlayEntry>>(new Map())

  // Dispose all overlay meshes on unmount (the cache/scene are torn down with
  // the GlobeGL instance, so only texture/material/geometry disposal is needed).
  useEffect(() => {
    const overlayMeshes = overlayMeshesRef.current
    return () => {
      for (const entry of overlayMeshes.values()) {
        disposeOverlayEntry(entry)
      }
      overlayMeshes.clear()
    }
  }, [])

  useEffect(() => {
    if (!globeReady || !globeRef.current) return
    const scene = globeRef.current.scene()
    const entries = overlayMeshesRef.current
    const activeSlugSet = new Set<string>()

    // ── Data-frame crossfade (uMix) — its own raf, independent of appearance ──
    const animateFrameBlend = (slug: string, entry: GlobeOverlayEntry) => {
      if (entry.frameRaf) {
        cancelAnimationFrame(entry.frameRaf)
        entry.frameRaf = 0
      }
      const duration = Math.max(0, blendMs)
      const startTime = performance.now()
      const animate = () => {
        if (entries.get(slug) !== entry) return
        const elapsed = performance.now() - startTime
        const mix = duration <= 0 ? 1 : Math.min(elapsed / duration, 1)
        entry.frameMix = mix
        entry.material.uniforms.uMix.value = mix
        if (mix < 1) {
          entry.frameRaf = requestAnimationFrame(animate)
        } else {
          entry.frameRaf = 0
          if (entry.prevTexture !== entry.nextTexture) {
            entry.prevTexture.dispose()
            entry.prevTexture = entry.nextTexture
            entry.material.uniforms.uTexPrev.value = entry.prevTexture
          }
        }
      }
      animate()
    }

    // ── Appearance crossfade (uAppearanceMix) — its own raf, independent ──────
    const finishAppearanceBlend = (slug: string, entry: GlobeOverlayEntry) => {
      if (entries.get(slug) !== entry) return
      entry.appearanceRaf = 0
      entry.appearanceMix = 1
      entry.material.uniforms.uAppearanceMix.value = 1
      if (entry.prevColormapTexture !== entry.nextColormapTexture) {
        entry.prevColormapTexture.dispose()
        entry.prevColormapTexture = entry.nextColormapTexture
        entry.material.uniforms.uCustomColormapPrev.value = entry.prevColormapTexture
      }
      entry.prevAppearance = entry.nextAppearance
      applyGlobeOverlayAppearanceUniforms(entry.material, 'Prev', entry.prevAppearance)
      if (entry.disposeAfterAppearanceBlend) {
        scene.remove(entry.mesh)
        disposeOverlayEntry(entry)
        entries.delete(slug)
      }
    }

    const animateAppearanceBlend = (slug: string, entry: GlobeOverlayEntry) => {
      if (entry.appearanceRaf) {
        cancelAnimationFrame(entry.appearanceRaf)
        entry.appearanceRaf = 0
      }
      const duration = Math.max(0, blendMs)
      const startTime = performance.now()
      const animate = () => {
        if (entries.get(slug) !== entry) return
        const elapsed = performance.now() - startTime
        const mix = duration <= 0 ? 1 : Math.min(elapsed / duration, 1)
        entry.appearanceMix = mix
        entry.material.uniforms.uAppearanceMix.value = mix
        if (mix < 1) {
          entry.appearanceRaf = requestAnimationFrame(animate)
        } else {
          finishAppearanceBlend(slug, entry)
        }
      }
      animate()
    }

    const startAppearanceBlend = (
      slug: string,
      entry: GlobeOverlayEntry,
      appearance: GlobeOverlayAppearance,
      customStops: OverlayColorStop[] | undefined,
      disposeAfterBlend: boolean,
    ) => {
      if (entry.prevColormapTexture !== entry.nextColormapTexture) {
        entry.prevColormapTexture.dispose()
      }
      entry.prevColormapTexture = entry.nextColormapTexture
      entry.prevAppearance = entry.nextAppearance
      entry.nextColormapTexture = buildOverlayColormapTexture(customStops)
      entry.nextAppearance = appearance
      entry.appearanceMix = 0
      entry.disposeAfterAppearanceBlend = disposeAfterBlend
      entry.loadedAppearanceKey = globeOverlayAppearanceKey(appearance)
      applyGlobeOverlayEntryUniforms(entry)
      animateAppearanceBlend(slug, entry)
    }

    if (overlays) {
      for (const [slug, overlayData] of Object.entries(overlays)) {
        const state = overlayStates.find((s) => s.slug === slug)
        const visible = state?.visible ?? true
        const opacity = visible ? (state?.opacity ?? 0.7) : 0
        const { appearance, customStops } = globeOverlayAppearance(overlayData, state, opacity)
        const appearanceKey = globeOverlayAppearanceKey(appearance)
        const existingEntry = entries.get(slug)

        if (appearance.opacity < 0.01 && !existingEntry) continue
        if (overlayData.frames.length === 0) continue

        const clampedIndex = Math.min(overlayFrameIndex, overlayData.frames.length - 1)
        const frame = overlayData.frames[clampedIndex]
        if (!frame) continue

        activeSlugSet.add(slug)
        const [h, w] = frame.shape
        const frameKey = `${slug}:${clampedIndex}:${h}x${w}`

        let entry = existingEntry

        if (!entry) {
          // New mesh for this slug. Data shown immediately (uMix = 1); the
          // appearance crossfades in from opacity 0 (uAppearanceMix 0 → 1).
          const tex = buildOverlayTexture(frame.dataU8, w, h)
          const colormapTex = buildOverlayColormapTexture(customStops)
          const initialAppearance = { ...appearance, opacity: 0 }
          const mat = new THREE.ShaderMaterial({
            vertexShader: globeOverlayVertexShader,
            fragmentShader: globeOverlayFragmentShader,
            uniforms: {
              uTexPrev:     { value: tex },
              uTexNext:     { value: tex },
              uCustomColormapPrev: { value: colormapTex },
              uCustomColormapNext: { value: colormapTex },
              uMix:         { value: 1.0 },
              uAppearanceMix: { value: 0.0 },
              uOpacityPrev: { value: initialAppearance.opacity },
              uOpacityNext: { value: appearance.opacity },
              uColormapPrev: { value: overlayColormapId(initialAppearance.colormap) },
              uColormapNext: { value: overlayColormapId(appearance.colormap) },
              uUseCustomColormapPrev: { value: initialAppearance.useCustomColormap },
              uUseCustomColormapNext: { value: appearance.useCustomColormap },
              uStretchLowPrev: { value: initialAppearance.stretchLow },
              uStretchHighPrev: { value: initialAppearance.stretchHigh },
              uStretchLowNext: { value: appearance.stretchLow },
              uStretchHighNext: { value: appearance.stretchHigh },
            },
            transparent: true,
            depthWrite: false,
            depthTest: false,
            side: THREE.FrontSide,
            glslVersion: THREE.GLSL3,
          })
          const geo = new THREE.SphereGeometry(R_OVERLAY, 96, 48)
          const mesh = new THREE.Mesh(geo, mat)
          mesh.renderOrder = 1000
          mesh.frustumCulled = false
          scene.add(mesh)
          entry = {
            mesh,
            material: mat,
            geometry: geo,
            prevTexture: tex,
            nextTexture: tex,
            frameMix: 1,
            frameRaf: 0,
            prevColormapTexture: colormapTex,
            nextColormapTexture: colormapTex,
            prevAppearance: initialAppearance,
            nextAppearance: appearance,
            appearanceMix: 0,
            appearanceRaf: 0,
            disposeAfterAppearanceBlend: appearance.opacity < 0.01,
            loadedFrameKey: frameKey,
            loadedAppearanceKey: appearanceKey,
          }
          entries.set(slug, entry)
          animateAppearanceBlend(slug, entry)
        } else {
          // Frame and appearance changes run on independent timelines —
          // neither restarts or snaps the other.
          if (entry.loadedFrameKey !== frameKey) {
            if (entry.prevTexture !== entry.nextTexture) {
              entry.prevTexture.dispose()
            }
            entry.prevTexture = entry.nextTexture
            entry.nextTexture = buildOverlayTexture(frame.dataU8, w, h)
            entry.frameMix = 0
            entry.material.uniforms.uTexPrev.value = entry.prevTexture
            entry.material.uniforms.uTexNext.value = entry.nextTexture
            entry.material.uniforms.uMix.value = 0
            entry.loadedFrameKey = frameKey
            animateFrameBlend(slug, entry)
          }
          if (entries.get(slug) !== entry) continue
          if (entry.loadedAppearanceKey !== appearanceKey) {
            startAppearanceBlend(slug, entry, appearance, customStops, appearance.opacity < 0.01)
          } else if (appearance.opacity >= 0.01) {
            // Visible and unchanged — cancel any pending fade-out disposal.
            entry.disposeAfterAppearanceBlend = false
          }
        }

        if (entries.get(slug) !== entry) continue
        applyGlobeOverlayEntryUniforms(entry)
      }
    }

    // Remove meshes for slugs no longer active (or fully faded out)
    for (const [slug, entry] of entries) {
      const fadeOutComplete = entry.disposeAfterAppearanceBlend
        && !entry.appearanceRaf
        && entry.appearanceMix >= 1
      if (!activeSlugSet.has(slug) || fadeOutComplete) {
        scene.remove(entry.mesh)
        disposeOverlayEntry(entry)
        entries.delete(slug)
      }
    }
  }, [globeRef, blendMs, globeReady, overlays, overlayStates, overlayFrameIndex])
}
