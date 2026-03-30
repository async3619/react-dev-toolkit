import { create } from 'zustand'
import type { ComponentNode, HookInfo } from '@/types'

type TreeStatus = 'idle' | 'success' | 'not-found' | 'error'

interface ComponentTreeState {
  // Tree data
  status: TreeStatus
  tree: ComponentNode[]
  error: string | null

  // Page-level inspection
  inspecting: boolean
  inspectedNodeId: number | null

  // Port registration (set by Observer)
  _postMessage: ((msg: unknown) => void) | null
}

interface ComponentTreeActions {
  // Tree
  setTreeResult: (tree: ComponentNode[]) => void
  setNotFound: () => void
  setError: (error: string) => void

  // Inspection
  setInspecting: (inspecting: boolean) => void
  setInspectedNodeId: (id: number | null) => void
  consumeInspectedNodeId: () => number | null
  startInspect: () => void
  stopInspect: () => void

  // Page interaction
  refresh: () => void
  highlightNode: (nodeId: number, nodeName: string) => void
  hideHighlight: () => void
  inspectHooks: (nodeId: number, callback: (hooks: HookInfo[]) => void) => void

  // Observer registration
  registerPostMessage: (fn: (msg: unknown) => void) => void
  unregisterPostMessage: () => void
}

export type ComponentTreeStore = ComponentTreeState & ComponentTreeActions

export const useComponentTreeStore = create<ComponentTreeStore>(
  (set, get) => ({
    // State
    status: 'idle',
    tree: [],
    error: null,
    inspecting: false,
    inspectedNodeId: null,
    _postMessage: null,

    // Tree actions
    setTreeResult: (tree) => set({ status: 'success', tree, error: null }),
    setNotFound: () => set({ status: 'not-found', tree: [], error: null }),
    setError: (error) => set({ status: 'error', error }),

    // Inspection
    setInspecting: (inspecting) => set({ inspecting }),
    setInspectedNodeId: (id) => set({ inspectedNodeId: id }),
    consumeInspectedNodeId: () => {
      const id = get().inspectedNodeId
      set({ inspectedNodeId: null })
      return id
    },
    startInspect: () => {
      set({ inspecting: true, inspectedNodeId: null })
      browser.devtools.inspectedWindow.eval(
        `window.postMessage({ type: "START_INSPECT" }, "*")`,
      )
    },
    stopInspect: () => {
      set({ inspecting: false })
      browser.devtools.inspectedWindow.eval(
        `window.postMessage({ type: "STOP_INSPECT" }, "*")`,
      )
    },

    // Page interaction
    refresh: () => {
      get()._postMessage?.({ type: 'SCAN_REACT_TREE' })
    },
    highlightNode: (nodeId, nodeName) => {
      browser.devtools.inspectedWindow.eval(
        `window.postMessage({ type: "HIGHLIGHT_NODE", nodeId: ${nodeId}, nodeName: ${JSON.stringify(nodeName)} }, "*")`,
      )
    },
    hideHighlight: () => {
      browser.devtools.inspectedWindow.eval(
        `window.postMessage({ type: "HIDE_HIGHLIGHT" }, "*")`,
      )
    },
    inspectHooks: (nodeId, callback) => {
      ;(browser.devtools.inspectedWindow.eval as (
        expression: string,
        callback: (result: unknown, exceptionInfo: unknown) => void,
      ) => void)(
        `JSON.stringify(window.__REACT_DEV_TOOLKIT_INSPECT_HOOKS__(${nodeId}))`,
        (result, exceptionInfo) => {
          if (!exceptionInfo && typeof result === 'string') {
            try {
              const parsed = JSON.parse(result)
              if (Array.isArray(parsed)) {
                callback(parsed as HookInfo[])
              }
            } catch {
              // parse failed
            }
          }
        },
      )
    },

    // Observer registration
    registerPostMessage: (fn) => set({ _postMessage: fn }),
    unregisterPostMessage: () => set({ _postMessage: null }),
  }),
)
