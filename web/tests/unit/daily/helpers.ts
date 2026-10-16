/**
 * Shared helpers for the M4 tests: sessions on a story day and time, and route calls with ?session=.
 */
import { NextRequest } from "next/server";
import { getMemoryStore } from "@/lib/store/memory";
import type { SessionRow } from "@/lib/store/types";

export async function sessionAt(day: number, time: string | null = null): Promise<SessionRow> {
  return getMemoryStore().createSession({ story_day: day, story_time: time, ttl_hours: 1 });
}

export function getReq(path: string, sessionId: string, headers: Record<string, string> = {}): NextRequest {
  const sep = path.includes("?") ? "&" : "?";
  return new NextRequest(`http://localhost${path}${sep}session=${encodeURIComponent(sessionId)}`, { headers });
}

export function postReq(path: string, sessionId: string, body: unknown): NextRequest {
  const sep = path.includes("?") ? "&" : "?";
  return new NextRequest(`http://localhost${path}${sep}session=${encodeURIComponent(sessionId)}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

/** Words that would turn the pattern question into advice (task M4 item 2). */
export const ADVICE_WORDS = ["换", "改到", "建议", "move", "switch", "should", "try"];

/** Words that would judge a blood pressure reading (task M4 item 3). */
export const JUDGEMENT_WORDS_BP = ["偏高", "正常", "high", "normal", "good"];

/** Words that would explain tiredness (task M4 item 4). */
export const CAUSE_WORDS = ["因为", "副作用", "because", "side effect"];
