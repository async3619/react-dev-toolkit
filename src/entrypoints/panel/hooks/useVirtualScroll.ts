import { type RefObject, useCallback, useEffect, useRef, useState } from 'react'

const ROW_HEIGHT = 24
const OVERSCAN = 10

interface VirtualScrollResult {
  startIndex: number
  endIndex: number
  totalHeight: number
  offsetY: number
  scrollToIndex: (index: number, itemLeft?: number) => void
}

export function useVirtualScroll(
  containerRef: RefObject<HTMLDivElement | null>,
  itemCount: number,
): VirtualScrollResult {
  const [scrollTop, setScrollTop] = useState(0)
  const [containerHeight, setContainerHeight] = useState(0)
  const rafRef = useRef(0)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height)
      }
    })
    ro.observe(el)
    setContainerHeight(el.clientHeight)
    return () => ro.disconnect()
  }, [containerRef])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const handleScroll = () => {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => {
        setScrollTop(el.scrollTop)
      })
    }

    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => {
      cancelAnimationFrame(rafRef.current)
      el.removeEventListener('scroll', handleScroll)
    }
  }, [containerRef])

  const totalHeight = itemCount * ROW_HEIGHT

  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const endIndex = Math.min(
    itemCount,
    Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + OVERSCAN,
  )
  const offsetY = startIndex * ROW_HEIGHT

  const scrollToIndex = useCallback(
    (index: number, itemLeft?: number) => {
      const el = containerRef.current
      if (!el) return

      const itemTop = index * ROW_HEIGHT
      const itemBottom = itemTop + ROW_HEIGHT

      if (itemTop < el.scrollTop) {
        el.scrollTop = itemTop
      } else if (itemBottom > el.scrollTop + el.clientHeight) {
        el.scrollTop = itemBottom - el.clientHeight
      }

      if (itemLeft !== undefined) {
        if (itemLeft < el.scrollLeft) {
          el.scrollLeft = itemLeft
        } else if (itemLeft > el.scrollLeft + el.clientWidth) {
          el.scrollLeft = itemLeft - el.clientWidth / 2
        }
      }
    },
    [containerRef],
  )

  return { startIndex, endIndex, totalHeight, offsetY, scrollToIndex }
}

export { ROW_HEIGHT }
