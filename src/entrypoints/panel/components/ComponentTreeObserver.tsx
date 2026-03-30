import { useEffect, useRef } from 'react'
import type { ComponentNode } from '@/types'
import { useComponentTreeStore } from '../stores/componentTreeStore'

const RETRY_INTERVALS = [500, 1000, 2000, 4000]

export function ComponentTreeObserver() {
  const portRef = useRef<ReturnType<typeof browser.runtime.connect> | null>(null)

  const setTreeResult = useComponentTreeStore((s) => s.setTreeResult)
  const setNotFound = useComponentTreeStore((s) => s.setNotFound)
  const setInspectedNodeId = useComponentTreeStore((s) => s.setInspectedNodeId)
  const setInspecting = useComponentTreeStore((s) => s.setInspecting)
  const registerPostMessage = useComponentTreeStore((s) => s.registerPostMessage)
  const unregisterPostMessage = useComponentTreeStore((s) => s.unregisterPostMessage)

  useEffect(() => {
    const tabId = browser.devtools.inspectedWindow.tabId
    const port = browser.runtime.connect({ name: `devtools:${tabId}` })
    portRef.current = port

    registerPostMessage((msg) => port.postMessage(msg))

    let responded = false
    const retryTimers: ReturnType<typeof setTimeout>[] = []

    port.onMessage.addListener((message: unknown) => {
      const msg = message as {
        type: string
        tree?: ComponentNode[]
        error?: string
        nodeId?: number
      }
      if (msg.type === 'REACT_TREE_RESULT') {
        responded = true
        setTreeResult(msg.tree ?? [])
      } else if (msg.type === 'REACT_NOT_FOUND') {
        responded = true
        setNotFound()
      } else if (msg.type === 'INSPECT_SELECT') {
        setInspectedNodeId(msg.nodeId ?? null)
        setInspecting(false)
      }
    })

    port.postMessage({ type: 'START_WATCHING' })

    for (const delay of RETRY_INTERVALS) {
      retryTimers.push(
        setTimeout(() => {
          if (!responded) {
            port.postMessage({ type: 'START_WATCHING' })
          }
        }, delay),
      )
    }

    return () => {
      for (const t of retryTimers) clearTimeout(t)
      port.postMessage({ type: 'STOP_WATCHING' })
      port.disconnect()
      portRef.current = null
      unregisterPostMessage()
    }
  }, [setTreeResult, setNotFound, setInspectedNodeId, setInspecting, registerPostMessage, unregisterPostMessage])

  return null
}
