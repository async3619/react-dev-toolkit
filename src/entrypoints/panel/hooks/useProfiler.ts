import { useEffect, useCallback, useRef, useState } from "react";
import type { ProfileCommitData, ComponentNode } from "@/types";
import { useProfilerStore } from "../stores/profilerStore";
import { type ComponentNameEntry, collectComponentNames } from "../utils/profiler";

function fetchComponentNames(
  callback: (names: ComponentNameEntry[]) => void,
) {
  (browser.devtools.inspectedWindow.eval as (
    expression: string,
    callback: (result: unknown, exceptionInfo: unknown) => void,
  ) => void)(
    `(() => {
      const names = new Map();
      function walk(fiber) {
        if (!fiber) return;
        const tag = fiber.tag;
        if (tag === 0 || tag === 1 || tag === 11 || tag === 14 || tag === 15) {
          const type = fiber.type;
          const name = typeof type === 'function' ? (type.displayName || type.name) : typeof type === 'string' ? type : null;
          if (name) {
            names.set(name, (names.get(name) || 0) + 1);
          }
        }
        walk(fiber.child);
        walk(fiber.sibling);
      }
      const roots = [];
      const hook = window.__REACT_DEVTOOLS_GLOBAL_HOOK__;
      if (hook?.getFiberRoots) {
        for (let i = 1; i <= 10; i++) {
          try {
            const fr = hook.getFiberRoots(i);
            if (fr) { for (const r of fr) { if (r.current) roots.push(r.current); } }
          } catch {}
        }
      }
      if (roots.length === 0) {
        const seen = new Set();
        const els = document.querySelectorAll('*');
        for (const el of els) {
          for (const key of Object.keys(el)) {
            if (key.startsWith('__reactContainer$') || key.startsWith('__reactFiber$')) {
              let f = el[key];
              while (f.return) f = f.return;
              const root = f.current || f;
              if (!seen.has(root)) { seen.add(root); roots.push(root); }
              break;
            }
          }
        }
      }
      for (const r of roots) walk(r);
      if (names.size === 0) return null;
      return JSON.stringify([...names.entries()]);
    })()`,
    (result, exceptionInfo) => {
      if (exceptionInfo || typeof result !== "string") return;
      try {
        const entries = JSON.parse(result) as [string, number][];
        callback(
          entries
            .map(([name, count]) => ({ name, count }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        );
      } catch {
        // parse failed
      }
    },
  );
}

export function useProfiler() {
  const store = useProfilerStore();
  const portRef = useRef<ReturnType<typeof browser.runtime.connect> | null>(
    null,
  );
  const autoSavedRef = useRef(false);
  const [componentNames, setComponentNames] = useState<ComponentNameEntry[]>([]);

  // Connect to background port for profiling messages
  useEffect(() => {
    const tabId = browser.devtools.inspectedWindow.tabId;
    const port = browser.runtime.connect({ name: `devtools:${tabId}` });
    portRef.current = port;

    port.onMessage.addListener((message: unknown) => {
      const msg = message as {
        type: string;
        commit?: ProfileCommitData;
      };
      if (msg.type === "PROFILING_COMMIT" && msg.commit) {
        useProfilerStore.getState().addCommit(msg.commit);
      }
    });

    // Fetch the current component tree for anchor selection via eval (bypasses watching state)
    fetchComponentNames(setComponentNames);

    return () => {
      port.postMessage({ type: "STOP_PROFILING" });
      port.disconnect();
      portRef.current = null;
    };
  }, []);

  const startProfiling = useCallback(() => {
    store.setStatus("recording");
    store.clearCommits();
    store.setActiveSessionId(null);
    autoSavedRef.current = false;
    const anchor = useProfilerStore.getState().anchorComponent.trim();
    portRef.current?.postMessage({
      type: "START_PROFILING",
      ...(anchor ? { anchorComponent: anchor } : {}),
    });
  }, [store]);

  const stopProfiling = useCallback(() => {
    store.setStatus("recorded");
    portRef.current?.postMessage({ type: "STOP_PROFILING" });
  }, [store]);

  // Auto-save when stopping profiling
  useEffect(() => {
    if (
      store.status === "recorded" &&
      store.commits.length > 0 &&
      store.activeSessionId === null &&
      !autoSavedRef.current
    ) {
      autoSavedRef.current = true;
      store.save();
    }
  }, [store.status, store.commits.length, store.activeSessionId, store]);

  // Refresh component names when returning to idle
  useEffect(() => {
    if (store.status === "idle") {
      fetchComponentNames(setComponentNames);
    }
  }, [store.status]);

  return {
    status: store.status,
    commits: store.commits,
    sessions: store.sessions,
    activeSessionId: store.activeSessionId,
    anchorComponent: store.anchorComponent,
    setAnchorComponent: store.setAnchorComponent,
    componentNames,
    startProfiling,
    stopProfiling,
    clear: store.clear,
    load: store.load,
    remove: store.remove,
  };
}
