import { useState, useEffect, useCallback, useRef } from "react";
import type { ProfileCommitData } from "@/types";
import {
  type ProfileSessionMeta,
  saveSession,
  listSessions,
  loadSession,
  deleteSession,
} from "../utils/profilerDb";

type ProfilerStatus = "idle" | "recording" | "recorded";

function getDomain(): string {
  // Use the inspected page's origin as domain key
  return new URL(
    (
      globalThis as unknown as {
        location?: { href: string };
      }
    ).location?.href ?? "unknown://",
  ).origin;
}

export function useProfiler() {
  const [status, setStatus] = useState<ProfilerStatus>("idle");
  const [commits, setCommits] = useState<ProfileCommitData[]>([]);
  const [sessions, setSessions] = useState<ProfileSessionMeta[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [domain, setDomain] = useState("unknown");
  const portRef = useRef<ReturnType<typeof browser.runtime.connect> | null>(
    null,
  );

  // Get inspected page domain + load saved sessions
  useEffect(() => {
    browser.devtools.inspectedWindow.eval("location.origin", (result) => {
      const d = (result as unknown as string) || "unknown";
      setDomain(d);
      listSessions(d).then(setSessions);
    });
  }, []);

  useEffect(() => {
    const tabId = browser.devtools.inspectedWindow.tabId;
    const port = browser.runtime.connect({ name: `devtools:${tabId}` });
    portRef.current = port;

    port.onMessage.addListener((message: unknown) => {
      const msg = message as { type: string; commit?: ProfileCommitData };
      if (msg.type === "PROFILING_COMMIT" && msg.commit) {
        setCommits((prev) => [...prev, msg.commit!]);
      }
    });

    return () => {
      port.postMessage({ type: "STOP_PROFILING" });
      port.disconnect();
      portRef.current = null;
    };
  }, []);

  const startProfiling = useCallback(() => {
    setStatus("recording");
    setCommits([]);
    setActiveSessionId(null);
    portRef.current?.postMessage({ type: "START_PROFILING" });
  }, []);

  const stopProfiling = useCallback(async () => {
    setStatus("recorded");
    portRef.current?.postMessage({ type: "STOP_PROFILING" });
  }, []);

  const save = useCallback(async () => {
    if (commits.length === 0) return;
    // Optimistic: generate name immediately, use temp id
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const tempId = -Date.now();
    const tempName = `Profiling #? on ${dateStr}`;

    setSessions((prev) => [{ id: tempId, name: tempName, domain, timestamp: Date.now() }, ...prev]);
    setActiveSessionId(tempId);

    // Persist, then reconcile with real id/name
    const session = await saveSession(domain, commits);
    setSessions((prev) =>
      prev.map((s) => (s.id === tempId ? { id: session.id, name: session.name, domain: session.domain, timestamp: session.timestamp } : s)),
    );
    setActiveSessionId(session.id);
  }, [commits, domain]);

  const load = useCallback(
    async (id: number) => {
      // Optimistic: switch immediately
      setActiveSessionId(id);
      setStatus("recorded");

      const session = await loadSession(id);
      if (session) {
        setCommits(session.commits);
      }
    },
    [],
  );

  const remove = useCallback(
    async (id: number) => {
      // Optimistic: remove from list immediately
      setSessions((prev) => prev.filter((s) => s.id !== id));
      if (activeSessionId === id) {
        setActiveSessionId(null);
        setCommits([]);
        setStatus("idle");
      }

      deleteSession(id);
    },
    [activeSessionId],
  );

  const clear = useCallback(() => {
    setStatus("idle");
    setCommits([]);
    setActiveSessionId(null);
  }, []);

  // Auto-save when stopping profiling
  useEffect(() => {
    if (status === "recorded" && commits.length > 0 && activeSessionId === null) {
      save();
    }
  }, [status, commits.length, activeSessionId, save]);

  return {
    status,
    commits,
    sessions,
    activeSessionId,
    startProfiling,
    stopProfiling,
    clear,
    load,
    remove,
  };
}
