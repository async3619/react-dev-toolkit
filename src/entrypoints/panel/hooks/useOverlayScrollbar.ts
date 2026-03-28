import { type RefObject, useEffect, useRef } from 'react'
import { OverlayScrollbars } from 'overlayscrollbars'
import 'overlayscrollbars/overlayscrollbars.css'

export function useOverlayScrollbar(
  hostRef: RefObject<HTMLDivElement | null>,
): RefObject<HTMLDivElement | null> {
  const viewportRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const el = hostRef.current
    if (!el) return

    const instance = OverlayScrollbars(el, {
      scrollbars: { autoHide: 'scroll', autoHideDelay: 800, theme: 'os-theme-light' },
      overflow: { x: 'scroll', y: 'scroll' },
    })

    viewportRef.current = instance.elements().viewport as HTMLDivElement

    return () => {
      viewportRef.current = null
      instance.destroy()
    }
  }, [hostRef])

  return viewportRef
}
