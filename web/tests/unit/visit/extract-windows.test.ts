/**
 * Task card M2 做-3: live extraction from a realtime client that sends what it heard every 10-15 s, through
 * the HTTP handler POST /api/visits/[id]/extract (request parsing, session, zod, the pipeline, the response).
 * The D0 visit is sent in windows of 10, 12 and 15 s; each run must give the same items as the
 * one-sentence-at-a-time replay, match the answer file, and keep R1 and R2 verbatim with their time.
 * (The browser e2e e2e/m2-visit.spec.ts sends 12 s windows over a real HTTP connection.)
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as extractPOST } from "@/app/api/visits/[id]/extract/route";
import { POST as visitsPOST } from "@/app/api/visits/route";
import { fixtureUtterances } from "@/lib/asr";
import type { FixtureUtterance } from "@/lib/asr/types";
import type { VisitView } from "@/lib/visit/types";
import { assertAgainstAnswers, newSession, replayLive, visitItems } from "./helpers";

const R1 = "At home, we want it below 135 over 85.";
const R2 =
  "If your reading at home is above 180 on top, or you get chest pain, weakness on one side, or your speech becomes slurred, go to A&E or call 995.";

const saved = { ...process.env };
let dir: string;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ripple-m2-windows-"));
  process.env.BLOB_LOCAL_DIR = dir;
  delete process.env.SPEECH_PROVIDER;
});
afterAll(() => {
  process.env = saved;
  rmSync(dir, { recursive: true, force: true });
});

function post(url: string, sessionId: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3200${url}?session=${sessionId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** What a realtime client that flushes every `windowMs` sends: the sentences that finished in each period. */
function windows(lines: FixtureUtterance[], windowMs: number): FixtureUtterance[][] {
  const out = new Map<number, FixtureUtterance[]>();
  for (const u of lines) {
    const k = Math.floor(u.t_end_ms / windowMs);
    out.set(k, [...(out.get(k) ?? []), u]);
  }
  return [...out.entries()].sort((a, b) => a[0] - b[0]).map(([, us]) => us);
}

const itemKey = (it: { id: string; type: string; text: string; required_line: string | null }) => `${it.id}|${it.type}|${it.required_line ?? ""}|${it.text}`;

describe("POST /api/visits/[id]/extract in 10-15 s windows (D0)", () => {
  it.each([10_000, 12_000, 15_000])("%i ms windows: the same items as sentence by sentence, the answer file, R1 and R2 with their time", async (windowMs) => {
    // reference: one sentence per chunk (what the server-side replay does)
    const ref = await newSession({ story_day: 0 });
    await replayLive(ref, "v1");
    const refItems = new Set((await visitItems(ref.id, "v1")).map(itemKey));

    // a realtime client recording the D0 visit, flushing every windowMs
    const s = await newSession({ story_day: 0 });
    const started = await visitsPOST(post("/api/visits", s.id, { mode: "record", consent: { given: true } }));
    expect(started.status).toBe(200);
    const lines = fixtureUtterances("v1")!;
    const chunks = windows(lines, windowMs);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.some((c) => c.length > 1)).toBe(true);
    let view: VisitView | null = null;
    for (const chunk of chunks) {
      const t0 = performance.now();
      const res = await extractPOST(
        post("/api/visits/v1/extract", s.id, {
          utterances: chunk.map((u) => ({ id: u.id, t_start_ms: u.t_start_ms, t_end_ms: u.t_end_ms, speaker_cluster: u.speaker_cluster, lang: u.lang, text: u.text })),
        }),
        { params: Promise.resolve({ id: "v1" }) },
      );
      expect(res.status).toBe(200);
      const out = (await res.json()) as { utterances: { id: string }[]; view: VisitView; new_cards: { id: string }[] };
      // the cards of a chunk come back with it: well inside the 5 s budget after the chunk is sent
      expect(performance.now() - t0).toBeLessThan(5000);
      expect(out.utterances.map((u) => u.id)).toEqual(chunk.map((u) => u.id));
      view = out.view;
    }

    await assertAgainstAnswers("v1", view!, s.id);
    const got = (await visitItems(s.id, "v1")).filter((it) => it.id !== "v1-consent-screen").map(itemKey);
    expect(new Set(got)).toEqual(refItems);
    for (const [text, t] of [
      [R1, 49520],
      [R2, 53681],
    ] as const) {
      const l = view!.lines.find((x) => x.text === text)!;
      expect(l.tStartMs).toBe(t);
      const card = view!.cards.find((c) => c.kind === "doc" && c.anchor === l.id);
      expect(card && card.kind === "doc" ? card.quote : null).toBe(text);
    }
    expect(view!.qlist?.anchor).toBe("v1-u10");
  });
});
