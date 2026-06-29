import { useEffect, useState } from 'react'

declare global {
  interface Window {
    __toggleFpsCounter?: (force?: boolean) => boolean
    __showFpsCounter?: () => boolean
    __hideFpsCounter?: () => boolean
  }
}

/**
 * FPS counter driven by a requestAnimationFrame sampling loop. Exposes
 * `window.__toggleFpsCounter` / `__showFpsCounter` / `__hideFpsCounter` so the
 * overlay can be flipped on from the dev console.
 */
export function useFpsCounter() {
  const [showFpsCounter, setShowFpsCounter] = useState(false)
  const [fps, setFps] = useState(0)

  useEffect(() => {
    if (!showFpsCounter) {
      // Reset the readout so a stale value never flashes when re-opened.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFps(0)
      return
    }
    let frameCount = 0
    let lastSampleTime = performance.now()
    let rafId = 0
    const updateFps = (now: number) => {
      frameCount += 1
      const elapsed = now - lastSampleTime
      if (elapsed >= 500) {
        setFps(Math.round((frameCount * 1000) / elapsed))
        frameCount = 0
        lastSampleTime = now
      }
      rafId = requestAnimationFrame(updateFps)
    }
    rafId = requestAnimationFrame(updateFps)
    return () => cancelAnimationFrame(rafId)
  }, [showFpsCounter])

  useEffect(() => {
    const toggle = (force?: boolean) => {
      let nextValue = showFpsCounter
      setShowFpsCounter((current) => {
        nextValue = typeof force === 'boolean' ? force : !current
        return nextValue
      })
      return nextValue
    }
    window.__toggleFpsCounter = toggle
    window.__showFpsCounter = () => toggle(true)
    window.__hideFpsCounter = () => toggle(false)
    return () => {
      delete window.__toggleFpsCounter
      delete window.__showFpsCounter
      delete window.__hideFpsCounter
    }
  }, [showFpsCounter])

  return { showFpsCounter, fps }
}
