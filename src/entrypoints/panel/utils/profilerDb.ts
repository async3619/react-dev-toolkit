import Dexie, { type EntityTable } from "dexie";
import type { ProfileCommitData } from "@/types";

export interface ProfileSession {
  id: number;
  name: string;
  domain: string;
  timestamp: number;
  commits: ProfileCommitData[];
}

export type ProfileSessionMeta = Omit<ProfileSession, "commits">;

const db = new Dexie("react-dev-toolkit-profiler") as Dexie & {
  sessions: EntityTable<ProfileSession, "id">;
};

db.version(1).stores({
  sessions: "++id, domain",
});

export async function saveSession(
  domain: string,
  commits: ProfileCommitData[],
): Promise<ProfileSession> {
  const count = await db.sessions.where("domain").equals(domain).count();
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  const session = {
    name: `Profiling #${count + 1} on ${dateStr}`,
    domain,
    timestamp: Date.now(),
    commits,
  };

  const id = await db.sessions.add(session as ProfileSession);
  return { ...session, id };
}

export async function listSessions(
  domain: string,
): Promise<ProfileSessionMeta[]> {
  const all = await db.sessions
    .where("domain")
    .equals(domain)
    .reverse()
    .sortBy("timestamp");

  return all.map(({ id, name, domain: d, timestamp }) => ({
    id,
    name,
    domain: d,
    timestamp,
  }));
}

export async function loadSession(
  id: number,
): Promise<ProfileSession | null> {
  return (await db.sessions.get(id)) ?? null;
}

export async function deleteSession(id: number): Promise<void> {
  await db.sessions.delete(id);
}
