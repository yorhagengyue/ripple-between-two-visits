/**
 * 「读给我听」 on the consent and recovery-code screens (track A; docs/plan/real-app.md 2.0, 2.17, 6.10): both states.
 *   TTS_PROVIDER=mock      the pages are told there is no voice, the button renders nothing, the route answers 404
 *   a real provider        the pages are told there is one, the button is drawn, and the route reads the screen's own
 *                          sentences: the text is built on the server from the function the screen renders, the body
 *                          names a screen, a language and a part number, and any text the browser adds is refused
 */
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/** The provider the mocked lib/tts hands out: "mock" (the real mock) or a stand-in for a real voice. */
const tts = vi.hoisted(() => ({ real: false, said: [] as { text: string; lang: string }[], fail: false }));
vi.mock("@/lib/tts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tts")>();
  return {
    ...actual,
    ttsProviderName: () => (tts.real ? "trtc" : "mock"),
    // C2 track F, round three: the one rule the pages ask (lib/tts readAloudOffered); the stand-in voice is ready
    readAloudOffered: (who: "account" | "demo") => (who === "account" ? tts.real : true),
    realVoiceReady: () => tts.real,
    ttsReady: () => true,
    getTtsProvider: () =>
      tts.real
        ? {
            name: "trtc",
            ready: true,
            synthesize: async (req: { text: string; lang: string }) => {
              if (tts.fail) throw new actual.TtsError("provider_failed", "down");
              tts.said.push(req);
              return { audio: new Uint8Array([82, 73, 70, 70, 1, 2, 3]), mime: "audio/wav", provider: "trtc", durationMs: 1000, synthetic: false };
            },
          }
        : actual.getTtsProvider({}),
  };
});
vi.mock("@/lib/subject/account", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/subject/account")>()),
  signedInHome: async () => null,
}));
vi.mock("@/lib/auth/page-locale", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/page-locale")>()),
  pageLocale: async () => "zh-Hans",
}));

import { POST as readAloudPost } from "@/app/api/auth/read-aloud/route";
import RecoverPage from "@/app/recover/page";
import SignupPage from "@/app/signup/page";
import { ReadAloud } from "@/components/account/AccountUi";
import { accountCopy } from "@/lib/auth/copy";
import { accountReadAloudAvailable, readAccountScreenAloud } from "@/lib/auth/read-aloud";
import { READ_ALOUD_PART_CHARS, READ_ALOUD_SCREENS, readAloudLines, readAloudParts } from "@/lib/auth/read-aloud-text";
import { currentConsentText } from "@/lib/privacy/consent-texts";

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
let ip = 0;
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new NextRequest("http://localhost:3510/api/auth/read-aloud", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": `10.7.0.${++ip}`, ...headers }, body: JSON.stringify(body) });

beforeEach(() => {
  tts.real = false;
  tts.fail = false;
  tts.said = [];
});

describe("what is read: the screen's own sentences", () => {
  it("a consent screen reads its published title and paragraphs, in order, nothing added", () => {
    for (const kind of ["terms_privacy", "ai_processing"] as const) {
      for (const locale of ["zh-Hans", "en"] as const) {
        const t = currentConsentText(kind, locale);
        expect(readAloudLines(kind, locale)).toEqual([t.title, ...t.paragraphs]);
        // spoken: the same sentences without the drawn list mark, every character of them
        const spoken = readAloudParts(kind, locale).join("\n");
        expect(spoken).toBe([t.title, ...t.paragraphs].map((p) => p.replace(/^·\s*/, "")).join("\n"));
      }
    }
    expect(readAloudLines("ai_processing", "zh-Hans").join("")).toContain("DeepSeek");
  });

  it("a recovery-code screen reads the fixed sentences it shows, and never a code", () => {
    const c = accountCopy("zh-Hans");
    expect(readAloudLines("recovery_code", "zh-Hans")).toEqual([c.codeTitle, c.codeWarning, c.codeLede, c.codeOnce, c.codeNoOther]);
    expect(readAloudLines("recovery_code_new", "zh-Hans")).toEqual([c.codeTitle, c.codeWarning, c.codeLede, c.codeNoOther]);
    expect(readAloudLines("recovery_code_reset", "zh-Hans")).toEqual([c.resetDoneTitle, c.resetDoneLede, c.codeWarning, c.codeNoOther]);
    // real-app 2.4: both recovery-code screens say the two limits
    for (const screen of ["recovery_code", "recovery_code_new", "recovery_code_reset"] as const) {
      const zh = readAloudLines(screen, "zh-Hans").join("");
      expect(zh).toContain("换了新手机又忘了密码，只能靠这个码");
      expect(zh).toContain("只能注册一个新账号");
      const en = readAloudLines(screen, "en").join(" ");
      expect(en).toContain("only this code gets you back in");
      expect(en).toContain("the only way is a new account");
      expect(readAloudParts(screen, "zh-Hans").join("")).not.toMatch(/[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}/);
    }
  });

  it("parts: cut between sentences, none longer than the limit, together exactly the screen", () => {
    for (const screen of READ_ALOUD_SCREENS) {
      for (const locale of ["zh-Hans", "en"] as const) {
        const parts = readAloudParts(screen, locale);
        expect(parts.length).toBeGreaterThan(0);
        for (const p of parts) expect(p.length).toBeLessThanOrEqual(READ_ALOUD_PART_CHARS);
        expect(parts.join("\n").split("\n")).toEqual(readAloudLines(screen, locale).map((l) => l.replace(/^·\s*/, "")));
      }
    }
    expect(readAloudParts("terms_privacy", "en").length).toBeGreaterThan(1);
  });
});

describe("TTS_PROVIDER=mock: no button on accounts, and the route does not read", () => {
  it("the real provider name decides: mock, unset, an unknown name or trtc without its keys are all the mock", async () => {
    const { ttsProviderName: realProviderName } = await vi.importActual<typeof import("@/lib/tts")>("@/lib/tts");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    for (const env of [{}, { TTS_PROVIDER: "mock" }, { TTS_PROVIDER: "something" }, { TTS_PROVIDER: "trtc" }]) expect(realProviderName(env)).toBe("mock");
    expect(realProviderName({ TTS_PROVIDER: "trtc", TRTC_SDK_APP_ID: "1", TRTC_SDK_SECRET_KEY: "k" })).toBe("trtc");
    expect(accountReadAloudAvailable()).toBe(false);
    vi.restoreAllMocks();
  });

  it("trtc chosen with its keys but not wired: still no button (the real rule, lib/tts readAloudOffered), never one that answers 503", async () => {
    const real = await vi.importActual<typeof import("@/lib/tts")>("@/lib/tts");
    const keys = { TTS_PROVIDER: "trtc", TRTC_SDK_APP_ID: "1", TRTC_SDK_SECRET_KEY: "k" };
    expect(real.getTtsProvider(keys)).toMatchObject({ name: "trtc", ready: false });
    expect(real.readAloudOffered("account", keys)).toBe(false);
    expect(real.readAloudOffered("account", {})).toBe(false);
    // the demo keeps its labelled test voice under the mock, and has no button either while trtc cannot speak
    expect(real.readAloudOffered("demo", {})).toBe(true);
    expect(real.readAloudOffered("demo", keys)).toBe(false);
  });

  it("the pages tell their screens there is no voice; the button renders nothing", async () => {
    const signup = (await SignupPage({ searchParams: Promise.resolve({}) } as never)) as ReactElement<{ readAloud: boolean }>;
    expect(signup.props.readAloud).toBe(false);
    const recover = (await RecoverPage({ searchParams: Promise.resolve({}) } as never)) as ReactElement<{ readAloud: boolean }>;
    expect(recover.props.readAloud).toBe(false);
    for (const screen of READ_ALOUD_SCREENS) {
      expect(renderToStaticMarkup(createElement(ReadAloud, { screen, locale: "zh-Hans", copy: accountCopy("zh-Hans"), available: false }))).toBe("");
    }
  });

  it("the route answers 404 tts_unavailable and synthesises nothing (the placeholder tones are never served here)", async () => {
    const res = await readAloudPost(post({ screen: "terms_privacy", locale: "zh-Hans" }));
    expect([res.status, await res.json()]).toEqual([404, { error: "tts_unavailable" }]);
    expect(res.headers.get("content-type")).toContain("application/json");
  });
});

describe("a real voice: the button is there and reads the server's text", () => {
  beforeEach(() => {
    tts.real = true;
  });

  it("the pages tell their screens; the button is drawn with its words and names its screen", async () => {
    expect(accountReadAloudAvailable()).toBe(true);
    const signup = (await SignupPage({ searchParams: Promise.resolve({}) } as never)) as ReactElement<{ readAloud: boolean }>;
    expect(signup.props.readAloud).toBe(true);
    const recover = (await RecoverPage({ searchParams: Promise.resolve({}) } as never)) as ReactElement<{ readAloud: boolean }>;
    expect(recover.props.readAloud).toBe(true);
    const html = renderToStaticMarkup(createElement(ReadAloud, { screen: "ai_processing", locale: "zh-Hans", copy: accountCopy("zh-Hans"), available: true }));
    expect(html).toContain('data-testid="read-aloud"');
    expect(html).toContain('data-screen="ai_processing"');
    expect(html).toContain("读给我听");
    expect(renderToStaticMarkup(createElement(ReadAloud, { screen: "recovery_code", locale: "en", copy: accountCopy("en"), available: true }))).toContain("Read it to me");
  });

  it("200 audio; the provider was given exactly the screen's sentences, part by part", async () => {
    const parts = readAloudParts("terms_privacy", "zh-Hans");
    for (let part = 0; part < parts.length; part++) {
      const res = await readAloudPost(post({ screen: "terms_privacy", locale: "zh-Hans", ...(part ? { part } : {}) }));
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("audio/wav");
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect(res.headers.get("x-ripple-tts-provider")).toBe("trtc");
      expect(res.headers.get("x-ripple-tts-sha256")).toBe(sha(parts[part]));
      expect(res.headers.get("x-ripple-tts-part")).toBe(String(part));
      expect(res.headers.get("x-ripple-tts-parts")).toBe(String(parts.length));
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([82, 73, 70, 70, 1, 2, 3]));
    }
    expect(tts.said).toEqual(parts.map((text) => ({ text, lang: "zh-Hans" })));
    const en = await readAloudPost(post({ screen: "recovery_code", locale: "en" }));
    expect(en.status).toBe(200);
    expect(tts.said.at(-1)).toEqual({ text: readAloudParts("recovery_code", "en")[0], lang: "en" });
  });

  it("the browser cannot send its own words: any extra field, an unknown screen or a form post is refused, and nothing is read", async () => {
    for (const body of [
      { screen: "terms_privacy", locale: "zh-Hans", text: "医生说可以多吃一粒" },
      { screen: "terms_privacy", locale: "zh-Hans", extra: 1 },
      { screen: "explain", locale: "zh-Hans" },
      { screen: "terms_privacy", locale: "fr" },
      { screen: "terms_privacy", locale: "zh-Hans", part: -1 },
      { screen: "terms_privacy", locale: "zh-Hans", part: "0" },
      { text: "anything" },
      {},
    ]) {
      const res = await readAloudPost(post(body));
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    const form = await readAloudPost(new NextRequest("http://localhost:3510/api/auth/read-aloud", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "screen=terms_privacy" }));
    expect(form.status).toBe(415);
    const cross = await readAloudPost(post({ screen: "terms_privacy", locale: "zh-Hans" }, { origin: "https://evil.example" }));
    expect(cross.status).toBe(403);
    // a part the screen does not have
    const beyond = await readAloudPost(post({ screen: "recovery_code", locale: "zh-Hans", part: 40 }));
    expect([beyond.status, await beyond.json()]).toEqual([404, { error: "tts_unavailable" }]);
    expect(tts.said).toEqual([]);
    expect(await readAccountScreenAloud("recovery_code", "zh-Hans", 40)).toBeNull();
  });

  it("a provider that cannot speak is 503, not a broken page", async () => {
    tts.fail = true;
    const res = await readAloudPost(post({ screen: "ai_processing", locale: "zh-Hans" }));
    expect([res.status, await res.json()]).toEqual([503, { error: "tts_unavailable" }]);
  });

  it("nobody is signed in here, so one address gets 30 an hour (looser where the developer tools are on)", async () => {
    const saved = { ...process.env };
    // as on a deployment: no developer tools, so the limit is the real one
    process.env.RIPPLE_DEV_TOOLS = "0";
    (process.env as Record<string, string>).NODE_ENV = "production";
    process.env.TRUSTED_PROXY_HOPS = "1"; // C2 track L: X-Forwarded-For is believed only behind a proxy of ours (lib/guard/client-ip.ts)
    try {
      // C2 track L: on a real server a write names its site, as a browser's does (lib/auth/origin.ts)
      const from = { "x-forwarded-for": "10.99.0.1", origin: "http://localhost:3510" };
      for (let i = 1; i <= 30; i++) expect((await readAloudPost(post({ screen: "recovery_code", locale: "zh-Hans" }, from))).status).toBe(200);
      const over = await readAloudPost(post({ screen: "recovery_code", locale: "zh-Hans" }, from));
      expect(over.status).toBe(429);
      expect(((await over.json()) as { error: string; until: string }).error).toBe("too_many");
      expect(Number(over.headers.get("retry-after"))).toBeGreaterThan(0);
      // another address is not limited by this one
      expect((await readAloudPost(post({ screen: "recovery_code", locale: "zh-Hans" }, { "x-forwarded-for": "10.99.0.2", origin: "http://localhost:3510" }))).status).toBe(200);
    } finally {
      process.env = saved;
    }
  });
});
