/**
 * 「读给我听」 on an account's medicine card, and the one rule every read-aloud button is drawn from (C2 track F, round
 * three; real-app 2.17 line 258, 6.10 line 1217; audit au4 row 19).
 *   - lib/tts readAloudOffered: an account gets the button only when a real voice can speak (never the mock's
 *     placeholder tones, never a provider that is chosen but not wired); the demo keeps its labelled test voice and
 *     loses the button too while the chosen provider cannot answer;
 *   - the account card (components/meds/elder) draws the button from that rule, on the explain card's own screen
 *     (the card at ?view=why);
 *   - POST /api/tts answers an account 404 tts_unavailable without a real voice, and with one reads exactly the
 *     card's own sentences (the browser names the card and the medicine, never any words).
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/** What the mocked lib/tts hands out: the mock, the trtc stub (chosen, not wired), or a stand-in for a real voice. */
const tts = vi.hoisted(() => ({ mode: "mock" as "mock" | "stub" | "voice", said: [] as { text: string; lang: string }[] }));
vi.mock("@/lib/tts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tts")>();
  const stubEnv = { TTS_PROVIDER: "trtc", TRTC_SDK_APP_ID: "1", TRTC_SDK_SECRET_KEY: "k" };
  const provider = () =>
    tts.mode === "voice"
      ? {
          name: "trtc" as const,
          ready: true,
          synthesize: async (req: { text: string; lang: string }) => {
            tts.said.push(req);
            return { audio: new Uint8Array([82, 73, 70, 70, 9, 9, 9]), mime: "audio/wav" as const, provider: "trtc" as const, durationMs: 1200, synthetic: false };
          },
        }
      : actual.getTtsProvider(tts.mode === "stub" ? stubEnv : {});
  return {
    ...actual,
    getTtsProvider: provider,
    // the real rule, asked about the provider this test chose
    readAloudOffered: (who: "account" | "demo") => actual.readAloudOffered(who, {}, provider()),
    realVoiceReady: () => actual.realVoiceReady({}, provider()),
    ttsReady: () => actual.ttsReady({}, provider()),
  };
});

import { POST as ttsPost } from "@/app/api/tts/route";
import { ReadCardAloud } from "@/components/meds/elder/CardParts";
import { AccountMedCardPage } from "@/components/meds/elder/pages";
import { getSpeechProvider } from "@/lib/asr";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { buildExplainCard } from "@/lib/explain/card";
import { textSha256 } from "@/lib/explain/read-aloud";
import { getMemoryStore } from "@/lib/store/memory";
import type { SessionRow } from "@/lib/store/types";
import { pageSubjectFor, selfSubject } from "@/lib/subject";
import { setTestClock } from "@/lib/time/now";
import { finalizeVisit, setItemVerdict, startVisit } from "@/lib/visit/pipeline";
import { newSession } from "../visit/helpers";

const store = getMemoryStore();
let dir: string;
const saved = { ...process.env };

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ripple-f-read-"));
  process.env.MOCK_ASR_JOB_MS = "0";
  process.env.BLOB_LOCAL_DIR = dir;
  delete process.env.BLOB_DRIVER;
  delete process.env.SPEECH_PROVIDER;
});
afterAll(() => {
  process.env = saved;
  rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
  tts.mode = "mock";
  tts.said = [];
});
afterEach(() => setTestClock(null));

/** An account whose visit prescribed amlodipine and gave the reason; he confirmed both lines: the card has its explain section. */
async function accountWithCard(): Promise<{ a: TestAccount; scope: SessionRow }> {
  setTestClock({ at: "2026-10-12T10:00:00+08:00", frozen: true });
  const a = await createAccountWithSpace(store, getAuthProvider(), { login: `ra${randomUUID().slice(0, 10)}`, password: "a long test password", space: "blank" });
  const scope = (await store.getSession(a.scope!.id))!;
  const visit = await startVisit(store, scope, { mode: "record", consent: { given: true } });
  const speech = getSpeechProvider();
  const { jobId } = await speech.createFileJob({ url: "fixture:v2", lang: "zh-en-mixed", fixture: "v2" });
  await finalizeVisit(store, scope, visit.id, await speech.getFileJob(jobId));
  const items = await store.listVisitItems(scope.id, { visit_id: visit.id });
  const med = items.find((i) => i.type === "medication" && i.slots?.drug === "amlodipine")!;
  const purposeLine = items.find((i) => i.type === "purpose")!.utterance_ids[0];
  const purpose = items.filter((i) => i.utterance_ids.includes(purposeLine));
  await setItemVerdict(store, scope, visit.id, { items: [med.id], verdict: "right" });
  await setItemVerdict(store, scope, visit.id, { items: purpose.map((p) => p.id), verdict: "right" });
  return { a, scope: (await store.getSession(scope.id))! };
}

const post = (a: TestAccount, body: unknown) =>
  new NextRequest("http://localhost/api/tts", { method: "POST", headers: { cookie: `rp_at=${a.tokens.access_token}`, "content-type": "application/json" }, body: JSON.stringify(body) });

/** Every element of a rendered tree (server components already awaited), depth first. */
function elements(node: ReactNode, out: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(node)) for (const n of node) elements(n, out);
  else if (isValidElement(node)) {
    out.push(node);
    elements((node.props as { children?: ReactNode }).children, out);
  }
  return out;
}

async function cardButtons(a: TestAccount, scope: SessionRow): Promise<ReactElement[]> {
  const ctx = pageSubjectFor(selfSubject(store, scope, a.userId));
  // the explain card is a screen of its own under the card (the timeline draft's 06-8): ?view=why
  const tree = await AccountMedCardPage({ ctx, locale: "zh-Hans", medId: "med-amlodipine", view: "why" });
  return elements(tree).filter((e) => e.type === ReadCardAloud);
}

describe("the one rule (lib/tts readAloudOffered)", () => {
  it("mock: no button on an account, the labelled test voice in the demo; trtc chosen but not wired: no button anywhere; a real voice: both", async () => {
    const real = await vi.importActual<typeof import("@/lib/tts")>("@/lib/tts");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    for (const env of [{}, { TTS_PROVIDER: "mock" }, { TTS_PROVIDER: "something" }, { TTS_PROVIDER: "trtc" }]) {
      expect([real.ttsReady(env), real.realVoiceReady(env), real.readAloudOffered("account", env), real.readAloudOffered("demo", env)]).toEqual([true, false, false, true]);
    }
    vi.restoreAllMocks();
    const keys = { TTS_PROVIDER: "trtc", TRTC_SDK_APP_ID: "1", TRTC_SDK_SECRET_KEY: "k" };
    expect(real.getTtsProvider(keys)).toMatchObject({ name: "trtc", ready: false });
    expect([real.ttsReady(keys), real.realVoiceReady(keys), real.readAloudOffered("account", keys), real.readAloudOffered("demo", keys)]).toEqual([false, false, false, false]);
    // the stub still refuses a direct call (what the 503 of a direct POST /api/tts in the demo comes from)
    await expect(real.getTtsProvider(keys).synthesize({ text: "x", lang: "en" })).rejects.toMatchObject({ code: "not_configured" });
    const voice = { name: "trtc" as const, ready: true };
    expect([real.ttsReady({}, voice), real.realVoiceReady({}, voice), real.readAloudOffered("account", {}, voice), real.readAloudOffered("demo", {}, voice)]).toEqual([true, true, true, true]);
  });
});

describe("the account's medicine card", () => {
  it("mock voice: no 「读给我听」 on the card, and the route answers 404 without synthesising anything", async () => {
    const { a, scope } = await accountWithCard();
    expect(await buildExplainCard(store, scope.id, (await store.getMed(scope.id, "med-amlodipine"))!, { day: scope.story_day, locale: "zh-Hans" })).not.toBeNull();
    expect(await cardButtons(a, scope)).toHaveLength(0);
    const res = await ttsPost(post(a, { card: "explain", med_id: "med-amlodipine", locale: "zh-Hans" }));
    expect([res.status, await res.json()]).toEqual([404, { error: "tts_unavailable" }]);
  });

  it("trtc chosen with its keys but not wired: no button, and 404 (never a button that answers 503)", async () => {
    tts.mode = "stub";
    const { a, scope } = await accountWithCard();
    expect(await cardButtons(a, scope)).toHaveLength(0);
    const res = await ttsPost(post(a, { card: "explain", med_id: "med-amlodipine", locale: "zh-Hans" }));
    expect(res.status).toBe(404);
  });

  it("a real voice: the button is on the card, and the voice reads exactly the explain section's own sentences", async () => {
    tts.mode = "voice";
    const { a, scope } = await accountWithCard();
    const buttons = await cardButtons(a, scope);
    expect(buttons).toHaveLength(1);
    expect(buttons[0].props).toMatchObject({ medId: "med-amlodipine", locale: "zh-Hans" });

    const res = await ttsPost(post(a, { card: "explain", med_id: "med-amlodipine", locale: "zh-Hans" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/wav");
    expect(res.headers.get("x-ripple-tts-provider")).toBe("trtc");
    const card = (await buildExplainCard(store, scope.id, (await store.getMed(scope.id, "med-amlodipine"))!, { day: scope.story_day, locale: "zh-Hans" }))!;
    expect(tts.said).toEqual([{ text: card.speechText, lang: "zh-Hans" }]);
    expect(tts.said[0].text.split("\n")).toEqual(card.lines.map((l) => l.text));
    expect(res.headers.get("x-ripple-tts-sha256")).toBe(textSha256(card.speechText));
    // the browser cannot make it say its own words, and a medicine that is not his is not read
    expect((await ttsPost(post(a, { card: "explain", med_id: "med-amlodipine", text: "Take two." }))).status).toBe(400);
    expect((await ttsPost(post(a, { card: "explain", med_id: "med-nope" }))).status).toBe(404);
    expect(tts.said).toHaveLength(1);
  });

  it("a card without an explain section (nothing confirmed from a visit) has no button, whatever the voice", async () => {
    tts.mode = "voice";
    setTestClock({ at: "2026-10-12T10:00:00+08:00", frozen: true });
    const a = await createAccountWithSpace(store, getAuthProvider(), { login: `ra${randomUUID().slice(0, 10)}`, password: "a long test password", space: "blank" });
    const scope = (await store.getSession(a.scope!.id))!;
    await store.upsertMed(scope.id, { id: "med-amlodipine", origin: "prescription", status: "awaiting_label", drug_id: "amlodipine", label: null, start_day: null, prescribed_visit_id: null, note: null, pharmacist_answer: null });
    expect(await cardButtons(a, scope)).toHaveLength(0);
    expect((await ttsPost(post(a, { card: "explain", med_id: "med-amlodipine" }))).status).toBe(409);
  });
});

describe("the demo is unchanged under the mock", () => {
  it("POST /api/tts still answers a demo session with the test voice", async () => {
    const s = await newSession({ story_day: 29 });
    const res = await ttsPost(new NextRequest(`http://localhost/api/tts?session=${s.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ card: "explain", med_id: "med-amlodipine", locale: "zh-Hans" }) }));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-ripple-tts-provider")).toBe("mock");
    expect(res.headers.get("x-ripple-tts-synthetic")).toBe("1");
  });
});
