/**
 * The judges' page (real-app 5.3; real-status "导演台和评委页"): the browser looking at the demo (rp_view=demo, and "Back
 * to my account"), the phone's language from the browser's, Singapore times that read the same on the server and in a
 * browser, /eval read from the real results (no paths), the old addresses redirecting, and the crew-only words.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { DELETE as viewDelete, POST as viewPost } from "@/app/api/demo/view/route";
import { DEMO_VIEW, localeFromAcceptLanguage, PHONE_APP_PATH, sgtClock, sgtDateTime, VIEW_COOKIE } from "@/lib/crew/demo-view";
import { evalRunView, readEvalPage } from "@/lib/crew/eval";
import { LOCALE_COOKIE } from "@/lib/i18n";
import { VIEW_COOKIE as RESOLVER_VIEW_COOKIE } from "@/lib/subject/resolve";

describe("the phone's language follows the browser's the first time", () => {
  it("the most preferred of Chinese and English; anything else is English (the default since the owner's 10-15)", () => {
    expect(localeFromAcceptLanguage("en-US,en;q=0.9")).toBe("en");
    expect(localeFromAcceptLanguage("en-GB,zh-CN;q=0.8")).toBe("en");
    expect(localeFromAcceptLanguage("zh-CN,zh;q=0.9,en;q=0.8")).toBe("zh-Hans");
    expect(localeFromAcceptLanguage("zh-TW")).toBe("zh-Hans");
    expect(localeFromAcceptLanguage("ms-MY,en;q=0.7")).toBe("en");
    expect(localeFromAcceptLanguage("en;q=0.5,zh;q=0.9")).toBe("zh-Hans");
    expect(localeFromAcceptLanguage("fr-FR,de;q=0.9")).toBe("en");
    expect(localeFromAcceptLanguage("")).toBe("en");
    expect(localeFromAcceptLanguage(null)).toBe("en");
  });
});

describe("POST and DELETE /api/demo/view", () => {
  const req = (method: string, headers: Record<string, string> = {}) => new NextRequest("http://localhost/api/demo/view", { method, headers });

  it("POST sets rp_view=demo (httpOnly, no lifetime) and, when there is none, the phone's language from Accept-Language", async () => {
    expect(VIEW_COOKIE).toBe(RESOLVER_VIEW_COOKIE);
    const res = await viewPost(req("POST", { "accept-language": "en-US,en;q=0.9" }));
    expect(await res.json()).toEqual({ view: DEMO_VIEW, lang: "en" });
    const set = res.headers.getSetCookie();
    const view = set.find((c) => c.startsWith(`${VIEW_COOKIE}=`))!;
    expect(view).toContain(`${VIEW_COOKIE}=demo`);
    expect(view.toLowerCase()).toContain("httponly");
    expect(view.toLowerCase()).not.toContain("max-age");
    const lang = set.find((c) => c.startsWith(`${LOCALE_COOKIE}=`))!;
    expect(lang).toContain(`${LOCALE_COOKIE}=en`);
    expect(lang.toLowerCase()).not.toContain("httponly"); // the phone's own switch writes it
  });

  it("POST keeps a language the browser already chose", async () => {
    const res = await viewPost(req("POST", { "accept-language": "en-US", cookie: `${LOCALE_COOKIE}=zh-Hans` }));
    expect(await res.json()).toEqual({ view: DEMO_VIEW, lang: "zh-Hans" });
    expect(res.headers.getSetCookie().some((c) => c.startsWith(`${LOCALE_COOKIE}=`))).toBe(false);
  });

  it("DELETE (Back to my account) clears rp_view", async () => {
    const res = await viewDelete();
    expect(await res.json()).toEqual({ view: null });
    expect(res.headers.getSetCookie().join("\n")).toMatch(new RegExp(`${VIEW_COOKIE}=;.*Max-Age=0`, "i"));
  });

  it("a judge's own phone starts the real app at sign-up", () => {
    expect(PHONE_APP_PATH).toBe("/");
  });
});

describe("Singapore times, the same text everywhere", () => {
  it("the backstage clock and the expiry line are UTC+8, no Intl involved", () => {
    expect(sgtClock("2026-10-10T12:15:03.000Z")).toBe("20:15:03");
    expect(sgtClock("2026-10-10T21:20:00.000Z")).toBe("05:20:00"); // real-status: 21:20 UTC was 5:20am in Singapore
    expect(sgtClock("nonsense")).toBe("");
    expect(sgtDateTime("2026-10-12T12:15:00.000Z")).toBe("Mon 12 Oct, 8:15 pm");
    expect(sgtDateTime("2026-10-11T16:05:00.000Z")).toBe("Mon 12 Oct, 12:05 am");
    expect(sgtDateTime("2026-10-12T04:00:00.000Z")).toBe("Mon 12 Oct, 12:00 pm");
  });
});

describe("/eval reads the real results", () => {
  const live = {
    meta: {
      created_at: "2026-10-09T20:07:50.085Z",
      case_count: 3,
      llm: { provider: "hunyuan", model: "hy3", checkerModel: "hy4-preview", checkerIndependence: "same_vendor", spend: { runUsd: 0.069801, ledger: { file: "D:\\secret\\path\\llm-spend.jsonl" } } },
    },
    thresholds: [{ name: "a", pass: true }, { name: "b", pass: true }],
    metrics: {
      overall: { n: 3, k: 3, rate: 1, ci95: [0.44, 1] },
      perCategory: { emergency: { accuracy: { n: 1, k: 1, rate: 1 } }, dose_change: { accuracy: { n: 2, k: 2, rate: 1 } } },
      perLanguage: { en: { n: 2, k: 2, rate: 1 }, zh: { n: 1, k: 1, rate: 1 } },
      mustRefuseRecall: { n: 2, k: 2, rate: 1 },
      emergencyRouteRecall: { n: 1, k: 1, rate: 1 },
      blockedPerLayer: { layer1: 0, layer2: 1, layer3: 0 },
      layer3Invoked: { checkerCalls: 0 },
      latencyMs: { p50: 877, p95: 1640, max: 2967 },
      modelWordedSentencesShown: { count: 0, items: [] },
      doNotDisplayNumbersFound: 0,
    },
  };
  const offline = { ...live, meta: { ...live.meta, created_at: "2026-10-09T10:35:51.931Z", llm: { provider: "mock", model: "deterministic-composer" } } };

  it("takes the numbers, never a file path", () => {
    const v = evalRunView(live)!;
    expect(v).toMatchObject({ cases: 3, passed: 3, provider: "hunyuan", model: "hy3", checkerModel: "hy4-preview", sameVendorChecker: true, costUsd: 0.069801 });
    expect(v.blocked).toEqual({ layer1: 0, layer2: 1, layer3: 0 });
    expect(v.latency).toEqual({ p50: 877, p95: 1640, max: 2967 });
    expect(v.thresholdsPassed).toBe(2);
    expect(JSON.stringify(v)).not.toContain("secret");
    expect(evalRunView({ at: "x", rows: [] })).toBeNull(); // not a run of the question set
  });

  it("the newest live run and the offline latest.json; a folder without results says none", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "ripple-eval-"));
    try {
      mkdirSync(path.join(dir, "results"));
      writeFileSync(path.join(dir, "results", "hunyuan-run1.json"), JSON.stringify({ ...live, meta: { ...live.meta, created_at: "2026-10-09T06:23:50.248Z" } }));
      writeFileSync(path.join(dir, "results", "hunyuan-run2.json"), JSON.stringify(live));
      writeFileSync(path.join(dir, "results", "latest.json"), JSON.stringify(offline));
      writeFileSync(path.join(dir, "results", "hunyuan-round1.json"), JSON.stringify({ at: "2026-10-09", rows: [] }));
      writeFileSync(path.join(dir, "pending.jsonl"), '{"id":"p1"}\n{"id":"p2"}\n');
      const page = readEvalPage(dir);
      expect(page.live?.at).toBe("2026-10-09T20:07:50.085Z");
      expect(page.offline?.provider).toBe("mock");
      expect(page.pending).toBe(2);
      expect(readEvalPage(path.join(dir, "nowhere"))).toEqual({ live: null, offline: null, pending: null });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("this repository's own results: no live run since Hunyuan replaced DeepSeek (10-16; the DeepSeek runs went with it), and the offline run", () => {
    const page = readEvalPage();
    expect(page.live).toBeNull();
    expect(page.offline).toMatchObject({ cases: 51, provider: "mock" });
  });
});
