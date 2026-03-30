import { create } from "zustand";
import type { ProfileCommitData } from "@/types";
import {
  type ProfileSession,
  type ProfileSessionMeta,
  saveSession,
  listSessions,
  loadSession,
  deleteSession,
} from "../utils/profilerDb";

type ProfilerStatus = "idle" | "recording" | "recorded";

interface ProfilerState {
  status: ProfilerStatus;
  commits: ProfileCommitData[];
  sessions: ProfileSessionMeta[];
  activeSessionId: number | null;
  domain: string;
  /** Whether sessions have been loaded from IndexedDB */
  initialized: boolean;
  /** Component name to target profiling to (only profile matching instances) */
  targetComponent: string;
  /** TypeId of the target component for type-based matching */
  targetTypeId: number | null;
}

interface ProfilerActions {
  /** Load sessions for a domain from IndexedDB (call once at app start) */
  init: (domain: string) => Promise<void>;
  setStatus: (status: ProfilerStatus) => void;
  addCommit: (commit: ProfileCommitData) => void;
  clearCommits: () => void;
  setActiveSessionId: (id: number | null) => void;
  setTargetComponent: (name: string, typeId: number | null) => void;
  save: () => Promise<void>;
  load: (id: number) => Promise<void>;
  remove: (id: number) => void;
  clear: () => void;
}

export const useProfilerStore = create<ProfilerState & ProfilerActions>(
  (set, get) => ({
    status: "idle",
    commits: [],
    sessions: [],
    activeSessionId: null,
    domain: "unknown",
    initialized: false,
    targetComponent: "",
    targetTypeId: null,

    init: async (domain: string) => {
      if (get().initialized && get().domain === domain) return;
      const sessions = await listSessions(domain);
      set({ domain, sessions, initialized: true });
    },

    setStatus: (status) => set({ status }),

    addCommit: (commit) =>
      set((s) => ({ commits: [...s.commits, commit] })),

    clearCommits: () => set({ commits: [] }),

    setActiveSessionId: (id) => set({ activeSessionId: id }),

    setTargetComponent: (name, typeId) => set({ targetComponent: name, targetTypeId: typeId }),

    save: async () => {
      const { commits, domain } = get();
      if (commits.length === 0) return;

      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
      const tempId = -Date.now();
      const tempName = `Profiling #? on ${dateStr}`;

      // Optimistic update
      set((s) => ({
        sessions: [
          { id: tempId, name: tempName, domain, timestamp: Date.now() },
          ...s.sessions,
        ],
        activeSessionId: tempId,
      }));

      // Persist then reconcile
      const session = await saveSession(domain, commits);
      set((s) => ({
        sessions: s.sessions.map((ss) =>
          ss.id === tempId
            ? { id: session.id, name: session.name, domain: session.domain, timestamp: session.timestamp }
            : ss,
        ),
        activeSessionId: session.id,
      }));
    },

    load: async (id: number) => {
      set({ activeSessionId: id, status: "recorded" });
      const session = await loadSession(id);
      if (session) {
        set({ commits: session.commits });
      }
    },

    remove: (id: number) => {
      const { activeSessionId } = get();
      set((s) => ({
        sessions: s.sessions.filter((ss) => ss.id !== id),
        ...(activeSessionId === id
          ? { activeSessionId: null, commits: [], status: "idle" as const }
          : {}),
      }));
      deleteSession(id);
    },

    clear: () =>
      set({ status: "idle", commits: [], activeSessionId: null, targetComponent: "", targetTypeId: null }),
  }),
);
