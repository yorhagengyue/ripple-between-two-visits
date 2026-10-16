/**
 * The readiness check the pages ask, with the real lib/tts (nothing of it is mocked here) and a stand-in for Tencent
 * behind global fetch:
 *   - TTS_PROVIDER=trtc with its three values: the check is true, the account pages get the button (the sign-up and
 *     recover screens, the medicine card), and both read-aloud routes answer audio/wav made by the adapter from the
 *     server's own text;
 *   - the mock voice: no button on an account, 404;
 *   - trtc chosen with a value missing, or refused by the service a moment ago: no button anywhere, 404.
 * No network: every request ends in the stand-in. Whether the real service answers these requests is not shown here.
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/subject/account", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/subject/account")>()),
  signedInHome: async () => null,
}));
vi.mock("@/lib/auth/page-locale", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/page-locale")>()),
  pageLocale: async () => "zh-Hans",
}));

import { POST as screenPost } from "@/app/api/auth/read-aloud/route";
import { POST as ttsPost } from "@/app/api/tts/route";
import RecoverPage from "@/app/recover/page";
import SignupPage from "@/app/signup/page";
import { ReadCardAloud } from "@/components/meds/elder/CardParts";
import { AccountMedCardPage } from "@/components/meds/elder/pages";
import { getSpeechProvider } from "@/lib/asr";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { accountReadAloudAvailable } from "@/lib/auth/read-aloud";
import { readAloudParts } from "@/lib/auth/read-aloud-text";
import { buildExplainCard } from "@/lib/explain/card";
import { textSha256 } from "@/lib/explain/read-aloud";
import { getMemoryStore } from "@/lib/store/memory";
import type { SessionRow } from "@/lib/store/types";
import { pageSubjectFor, selfSubject } from "@/lib/subject";
import { setTestClock } from "@/lib/time/now";
import { getTtsProvider, readAloudOffered, realVoiceReady, ttsProviderName, ttsReady } from "@/lib/tts";
import { resetTrtcTtsHealth, trtcUnits } from "@/lib/tts/trtc";
import { finalizeVisit, setItemVerdict, startVisit } from "@/lib/visit/pipeline";
import { encodeWav, parseWav } from "@/lib/visit/wav";

const store = getMemoryStore();
let dir: string;
const saved = { ...process.env };

/** What the stand-in was asked, and what it answers next. */
const tencent = {
  sent: [] as { url: string; text: string; language: string }[],
  refuse: null as string | null,
};
const stand = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body ?? "{}")) as { Text: string; Language: string };
  tencent.sent.push({ url: String(input), text: body.Text, language: body.Language });
  if (tencent.refuse) return Response.json({ Response: { Error: { Code: tencent.refuse, Message: "m" }, RequestId: "req-1" } });
  const wav = encodeWav(new Int16Array(2400).fill(500), 24_000);
  return Response.json({ Response: { Audio: Buffer.from(wav).toString("base64"), RequestId: "req-1" } });
}) as typeof fetch;

const TRTC = { TTS_PROVIDER: "trtc", TRTC_SDK_APP_ID: "160001234", TENCENT_SECRET_ID: "test-secret-id", TENCENT_SECRET_KEY: "test-secret-key" };
const TTS_VARS = ["TTS_PROVIDER", "TRTC_SDK_APP_ID", "TRTC_SDK_SECRET_KEY", "TENCENT_SECRET_ID", "TENCENT_SECRET_KEY", "TRTC_TTS_ENDPOINT", "TRTC_TTS_REGION", "TRTC_TTS_VOICE_ZH", "TRTC_TTS_VOICE_EN", "TRTC_TTS_SPEED", "TRTC_TTS_SAMPLE_RATE", "TRTC_TTS_TIMEOUT_MS"];
function setTtsEnv(values: Record<string, string | undefined>): void {
  for (const name of TTS_VARS) delete process.env[name];
  Object.assign(process.env, values);
}

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ripple-t-read-"));
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
  tencent.sent = [];
  tencent.refuse = null;
  resetTrtcTtsHealth();
  vi.stubGlobal("fetch", stand);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  setTestClock(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** An account whose visit prescribed amlodipine and gave the reason; he confirmed both lines: the card has its explain section. */
async function accountWithCard(): Promise<{ a: TestAccount; scope: SessionRow }> {
  setTestClock({ at: "2026-10-12T10:00:00+08:00", frozen: true });
  const a = await createAccountWithSpace(store, getAuthProvider(), { login: `rt${randomUUID().slice(0, 10)}`, password: "a long test password", space: "blank" });
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

const cardPost = (a: TestAccount, body: unknown) =>
  new NextRequest("http://localhost/api/tts", { method: "POST", headers: { cookie: `rp_at=${a.tokens.access_token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
let ip = 0;
const screenRequest = (body: unknown) =>
  new NextRequest("http://localhost:3650/api/auth/read-aloud", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `10.9.0.${++ip}` }, body: JSON.stringify(body) });

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
async function screenFlags(): Promise<boolean[]> {
  const signup = (await SignupPage({ searchParams: Promise.resolve({}) } as never)) as ReactElement<{ readAloud: boolean }>;
  const recover = (await RecoverPage({ searchParams: Promise.resolve({}) } as never)) as ReactElement<{ readAloud: boolean }>;
  return [signup.props.readAloud, recover.props.readAloud];
}
/** The four answers of lib/tts, as the pages get them (from the process environment). */
const rule = () => [ttsReady(), realVoiceReady(), readAloudOffered("account"), readAloudOffered("demo"), accountReadAloudAvailable()];
const squeeze = (s: string) => s.replace(/\s+/g, "");

describe("TTS_PROVIDER=trtc with its application id and cloud API key pair", () => {
  beforeEach(() => setTtsEnv(TRTC));

  it("the readiness check is true, and nothing was sent to find that out", async () => {
    expect(ttsProviderName()).toBe("trtc");
    expect(getTtsProvider()).toMatchObject({ name: "trtc", ready: true });
    expect(rule()).toEqual([true, true, true, true, true]);
    expect(await screenFlags()).toEqual([true, true]);
    expect(tencent.sent).toHaveLength(0);
  });

  it("the medicine card has 「读给我听」, and the route answers the adapter's WAV of exactly the card's sentences", async () => {
    const { a, scope } = await accountWithCard();
    const buttons = await cardButtons(a, scope);
    expect(buttons).toHaveLength(1);
    expect(buttons[0].props).toMatchObject({ medId: "med-amlodipine", locale: "zh-Hans" });

    const res = await ttsPost(cardPost(a, { card: "explain", med_id: "med-amlodipine", locale: "zh-Hans" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/wav");
    expect(res.headers.get("x-ripple-tts-provider")).toBe("trtc");
    expect(res.headers.get("x-ripple-tts-synthetic")).toBe("0");
    const audio = new Uint8Array(await res.arrayBuffer());
    expect(Number(res.headers.get("content-length"))).toBe(audio.byteLength);
    expect(parseWav(audio)).toMatchObject({ sampleRate: 24000, channels: 1, bitsPerSample: 16 });

    const card = (await buildExplainCard(store, scope.id, (await store.getMed(scope.id, "med-amlodipine"))!, { day: scope.story_day, locale: "zh-Hans" }))!;
    expect(res.headers.get("x-ripple-tts-sha256")).toBe(textSha256(card.speechText));
    // what went to the service: the card's own sentences, all of them, in order, each request within the limit
    expect(tencent.sent.length).toBeGreaterThan(0);
    for (const s of tencent.sent) {
      expect(s.url).toBe("https://trtc.intl.tencentcloudapi.com/");
      expect(trtcUnits(s.text)).toBeLessThanOrEqual(255);
      expect(s.language).toBe(/\p{Script=Han}/u.test(s.text) ? "zh" : "en");
    }
    expect(squeeze(tencent.sent.map((s) => s.text).join(""))).toBe(squeeze(card.speechText));
    // the browser still cannot make it say its own words
    const before = tencent.sent.length;
    expect((await ttsPost(cardPost(a, { card: "explain", med_id: "med-amlodipine", text: "Take two." }))).status).toBe(400);
    expect(tencent.sent).toHaveLength(before);
  });

  it("the consent screen is read too, part by part, from the server's text", async () => {
    const parts = readAloudParts("terms_privacy", "zh-Hans");
    const res = await screenPost(screenRequest({ screen: "terms_privacy", locale: "zh-Hans" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/wav");
    expect(res.headers.get("x-ripple-tts-provider")).toBe("trtc");
    expect(parseWav(new Uint8Array(await res.arrayBuffer()))).not.toBeNull();
    expect(squeeze(tencent.sent.map((s) => s.text).join(""))).toBe(squeeze(parts[0]));
    for (const s of tencent.sent) expect(trtcUnits(s.text)).toBeLessThanOrEqual(255);
  });

  it("the service refuses the keys: that tap fails once, then the button is gone everywhere and nothing more is sent", async () => {
    const { a, scope } = await accountWithCard();
    tencent.refuse = "AuthFailure.SignatureFailure";
    const first = await ttsPost(cardPost(a, { card: "explain", med_id: "med-amlodipine", locale: "zh-Hans" }));
    expect([first.status, await first.json()]).toEqual([503, { error: "tts_not_configured" }]);
    const sent = tencent.sent.length;
    expect(rule()).toEqual([false, false, false, false, false]);
    expect(await screenFlags()).toEqual([false, false]);
    expect(await cardButtons(a, scope)).toHaveLength(0);
    const second = await ttsPost(cardPost(a, { card: "explain", med_id: "med-amlodipine", locale: "zh-Hans" }));
    expect([second.status, await second.json()]).toEqual([404, { error: "tts_unavailable" }]);
    expect((await screenPost(screenRequest({ screen: "terms_privacy", locale: "zh-Hans" }))).status).toBe(404);
    expect(tencent.sent).toHaveLength(sent);
  });

  it("a slow moment (the service is busy) fails that tap with 503 and leaves the button", async () => {
    const { a, scope } = await accountWithCard();
    tencent.refuse = "RequestLimitExceeded";
    const res = await ttsPost(cardPost(a, { card: "explain", med_id: "med-amlodipine", locale: "zh-Hans" }));
    expect([res.status, await res.json()]).toEqual([503, { error: "tts_provider_failed" }]);
    expect(rule()).toEqual([true, true, true, true, true]);
    expect(await cardButtons(a, scope)).toHaveLength(1);
  });
});

describe("the mock voice", () => {
  it("no button on an account page, 404 from both routes; the demo keeps its labelled test voice", async () => {
    for (const env of [{}, { TTS_PROVIDER: "mock" }]) {
      setTtsEnv(env);
      expect(rule()).toEqual([true, false, false, true, false]);
      expect(await screenFlags()).toEqual([false, false]);
    }
    const { a, scope } = await accountWithCard();
    expect(await cardButtons(a, scope)).toHaveLength(0);
    const res = await ttsPost(cardPost(a, { card: "explain", med_id: "med-amlodipine", locale: "zh-Hans" }));
    expect([res.status, await res.json()]).toEqual([404, { error: "tts_unavailable" }]);
    expect((await screenPost(screenRequest({ screen: "terms_privacy", locale: "zh-Hans" }))).status).toBe(404);
    expect(tencent.sent).toHaveLength(0);
  });
});

describe("trtc chosen, a value missing", () => {
  it("no application id: the mock, with a warning", () => {
    setTtsEnv({ TTS_PROVIDER: "trtc", TENCENT_SECRET_ID: "test-secret-id", TENCENT_SECRET_KEY: "test-secret-key" });
    expect(ttsProviderName()).toBe("mock");
    expect(rule()).toEqual([true, false, false, true, false]);
  });

  it("the application's own pair without a cloud API key pair: trtc, not ready, no button anywhere, and the log names what is missing once", async () => {
    setTtsEnv({ TTS_PROVIDER: "trtc", TRTC_SDK_APP_ID: "160001234", TRTC_SDK_SECRET_KEY: "an-sdk-secret" });
    const warn = vi.mocked(console.warn);
    expect(ttsProviderName()).toBe("trtc");
    expect(rule()).toEqual([false, false, false, false, false]);
    expect(await screenFlags()).toEqual([false, false]);
    const { a, scope } = await accountWithCard();
    expect(await cardButtons(a, scope)).toHaveLength(0);
    expect((await ttsPost(cardPost(a, { card: "explain", med_id: "med-amlodipine", locale: "zh-Hans" }))).status).toBe(404);
    const lines = warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("cannot speak"));
    expect(lines).toEqual(["[tts] TTS_PROVIDER=trtc cannot speak, read-aloud is off: TENCENT_SECRET_ID is not set; TENCENT_SECRET_KEY is not set"]);
    expect(lines.join("")).not.toContain("an-sdk-secret");
    expect(tencent.sent).toHaveLength(0);
  });
});
