/**
 * The Director's "New filming session" without the crew key (M8 judge-link gating, round-4 fixer pass): the button no
 * longer swallows the 403. Its own request (createSession in components/session/StartSession.tsx), sent to the real
 * POST /api/session, rejects with the route's code; startSessionProblem turns crew_key_required / crew_key_wrong /
 * crew_key_attempts into the crew-key line, anything else into a plain retry line; StartSessionProblem says it in
 * plain zh / en words with a link to /backstage/crew, where the crew types the key once.
 * The click on the real page is in e2e/m2-fallback.spec.ts (the judge's path).
 */
import { NextRequest } from "next/server";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as sessionPOST } from "@/app/api/session/route";
import { createSession, StartSessionError, startSessionProblem, StartSessionProblem } from "@/components/session/StartSession";
import { t, type Locale } from "@/lib/i18n";
import { resetCrewAttempts } from "@/lib/session/crew-key";
import { DEV_ONLY_CREW_KEY } from "@/lib/visit/crew";

const LOCALES: Locale[] = ["zh-Hans", "en"];

/** The text React wrote, with its entities decoded (the apostrophe in "crew's" comes out as &#x27;). */
const decoded = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

/** The browser's fetch, answered by the real route handler (same-origin POST /api/session). */
function routeFetch(): (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    expect(url).toBe("/api/session");
    return sessionPOST(new NextRequest(`http://localhost:3200${url}`, init as ConstructorParameters<typeof NextRequest>[1]));
  };
}

beforeEach(async () => {
  await resetCrewAttempts();
  vi.stubGlobal("fetch", routeFetch());
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await resetCrewAttempts();
});

async function refusal(body: Parameters<typeof createSession>[0]): Promise<unknown> {
  try {
    await createSession(body);
  } catch (err) {
    return err;
  }
  throw new Error("expected POST /api/session to be refused");
}

describe("the button's own request against POST /api/session", () => {
  it("no crew key: 404 not_found (the crew gate), which the button shows as the crew-key line", async () => {
    const err = await refusal({ kind: "filming", role: "director" });
    expect(err).toBeInstanceOf(StartSessionError);
    expect(err).toMatchObject({ status: 404, code: "not_found" });
    expect(startSessionProblem(err)).toBe("crew_key");
  });

  it("a wrong crew key: the same 404 as no key (one gate), the same line", async () => {
    const err = await refusal({ kind: "filming", role: "director", crew_key: "open sesame" });
    expect(err).toMatchObject({ status: 404, code: "not_found" });
    expect(startSessionProblem(err)).toBe("crew_key");
  });

  it("with the crew key, or for a sandbox, it goes through (no line at all)", async () => {
    await expect(createSession({ kind: "filming", role: "director", crew_key: DEV_ONLY_CREW_KEY })).resolves.toBeUndefined();
    await expect(createSession({ kind: "sandbox", role: "judge" })).resolves.toBeUndefined();
  });
});

describe("startSessionProblem", () => {
  it("the three crew-key codes read as the crew key; anything else is a plain retry", () => {
    for (const code of ["crew_key_required", "crew_key_wrong"]) expect(startSessionProblem(new StartSessionError(403, code))).toBe("crew_key");
    expect(startSessionProblem(new StartSessionError(429, "crew_key_attempts"))).toBe("crew_key");
    expect(startSessionProblem(new StartSessionError(400, "bad_body"))).toBe("failed");
    expect(startSessionProblem(new StartSessionError(500, null))).toBe("failed");
    expect(startSessionProblem(new TypeError("Failed to fetch"))).toBe("failed");
    expect(startSessionProblem(undefined)).toBe("failed");
  });
});

describe("StartSessionProblem: plain words, zh and en", () => {
  for (const locale of LOCALES) {
    it(`crew key (${locale}): the line and a link to /backstage/crew`, () => {
      const html = renderToStaticMarkup(createElement(StartSessionProblem, { problem: "crew_key", locale, testId: "new-filming-session-problem" }));
      expect(html).toContain('role="alert"');
      expect(html).toContain(`lang="${locale}"`);
      expect(html).toContain('data-problem="crew_key"');
      expect(decoded(html)).toContain(t(locale, "startSession.crewKey"));
      const link = /<a [^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/.exec(html);
      expect(link?.[1]).toBe("/backstage/crew");
      expect(decoded(link?.[2] ?? "")).toContain(t(locale, "startSession.crewKeyLink"));
      expect(html).toContain('data-testid="new-filming-session-problem-crew-link"');
    });

    it(`anything else (${locale}): a plain retry line, no crew link`, () => {
      const html = renderToStaticMarkup(createElement(StartSessionProblem, { problem: "failed", locale }));
      expect(decoded(html)).toContain(t(locale, "startSession.failed"));
      expect(html).not.toContain("/backstage/crew");
    });
  }

  it("the words: crew key in both languages, no codes on screen", () => {
    expect(t("en", "startSession.crewKey")).toBe("A filming session needs the film crew's key. Your own sandbox stays as it is.");
    expect(t("zh-Hans", "startSession.crewKey")).toBe("开拍摄场次要先输入拍摄组口令。你自己的沙盒不受影响。");
    for (const locale of LOCALES) {
      const html = renderToStaticMarkup(createElement(StartSessionProblem, { problem: "crew_key", locale }));
      expect(html).not.toMatch(/crew_key_|403/);
    }
  });
});
