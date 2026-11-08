import { FAKE } from "./api";

export type FakeScenario = {
  type: string;
  retryAfterSec?: number;
  times?: number;
  newName?: string;
  newStatus?: string;
  redirectHost?: string;
  padBytes?: number;
};

/** POST /_control (reset: true by default so scenarios never leak between steps). */
export async function control(body: { global?: FakeScenario; games?: Record<string, FakeScenario> } = {}) {
  const res = await fetch(`${FAKE}/_control`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reset: true, ...body }),
  });
  if (!res.ok) throw new Error(`fake control failed: ${res.status}`);
}

export type FakeLogItem = { time: string; method: string; path: string; ua: string };

export async function fakeLog(): Promise<FakeLogItem[]> {
  const res = await fetch(`${FAKE}/_log`);
  if (!res.ok) throw new Error(`fake log failed: ${res.status}`);
  return (await res.json()).items;
}

export async function clearFakeLog(): Promise<void> {
  const res = await fetch(`${FAKE}/_log`, { method: "DELETE" });
  if (!res.ok) throw new Error(`fake log clear failed: ${res.status}`);
}

/** Parse the fake server's RFC3339Nano timestamps into epoch milliseconds. */
export function logTime(item: FakeLogItem): number {
  return new Date(item.time.replace(/(\.\d{3})\d*Z/, "$1Z")).getTime();
}
