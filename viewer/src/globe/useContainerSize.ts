import { useEffect, useRef, useState } from 'react'

/**
 * Track a container element's content-box size via ResizeObserver.
 * Returns a ref to attach to the element and its current pixel dimensions.
 */
export function useContainerSize() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      setDimensions({ width, height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return { containerRef, dimensions }
}
