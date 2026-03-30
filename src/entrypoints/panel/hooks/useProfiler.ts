import { useEffect, useCallback, useMemo, useRef } from "react";
import type { ProfileCommitData } from "@/types";
import { useProfilerStore } from "../stores/profilerStore";
import { useComponentTreeStore } from "../stores/componentTreeStore";
import { type ComponentNameEntry, collectComponentNames } from "../utils/profiler";

export function useProfiler() {
  const store = useProfilerStore();
  const tree = useComponentTreeStore((s) => s.tree);
  const portRef = useRef<ReturnType<typeof browser.runtime.connect> | null>(
    null,
  );
  const autoSavedRef = useRef(false);

  // Derive component names from global tree
  const componentNames: ComponentNameEntry[] = useMemo(
    () => collectComponentNames(tree),
    [tree],
  );

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
    const { targetTypeId, targetComponent } = useProfilerStore.getState();
    const target = targetComponent.trim();
    portRef.current?.postMessage({
      type: "START_PROFILING",
      ...(targetTypeId != null ? { targetTypeId } : {}),
      ...(target ? { targetComponent: target } : {}),
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

  return {
    status: store.status,
    commits: store.commits,
    sessions: store.sessions,
    activeSessionId: store.activeSessionId,
    targetComponent: store.targetComponent,
    targetTypeId: store.targetTypeId,
    setTargetComponent: store.setTargetComponent,
    componentNames,
    startProfiling,
    stopProfiling,
    clear: store.clear,
    load: store.load,
    remove: store.remove,
  };
}
