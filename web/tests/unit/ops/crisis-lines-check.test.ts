/**
 * scripts/ops/crisis-lines-check.ts: the checking function, the host refusal, what is printed, and the whole script
 * run against the real route handlers (POST /api/session, POST /api/ask) through a fetch that calls them in process: the
 * memory store and the offline model, so the four phrases are answered as a private instance would answer them.
 */
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as askRoute } from "@/app/api/ask/route";
import { POST as sessionRoute } from "@/app/api/session/route";
import { ALL_TEMPLATES } from "@/lib/safety/templates";
import {
  CASES,
  checkAnswer,
  formatResult,
  isLocalHostname,
  main,
  parseBase,
  run,
  templateIdsOf,
  templateSets,
  type CaseResult,
} from "@/scripts/ops/crisis-lines-check";

/** A fetch that calls the app's own route handlers, so the script is tried against the real code. */
function inProcessFetch(): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const req = new NextRequest(url, { method: init?.method, body: init?.body as string | undefined, headers: init?.headers as Record<string, string> });
    if (url.pathname === "/api/session") return sessionRoute(req);
    if (url.pathname === "/api/ask") return askRoute(req);
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
}

const ANSWER_TEXT = "ANSWER-TEXT-THAT-MUST-NOT-BE-PRINTED";

/** A fake server: a session with cookies, then answers with the template ids given per phrase text. */
function fakeServer(answers: Record<string, { templateId?: string }[] | number>, followUp?: { templateId: string }): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/session")) {
      const headers = new Headers({ "content-type": "application/json" });
      headers.append("set-cookie", "rp_session=abc; Path=/; HttpOnly");
      headers.append("set-cookie", "rp_member=def; Path=/; HttpOnly");
      return new Response("{}", { status: 201, headers });
    }
    const sent = JSON.parse(String(init?.body)) as { text: string };
    const a = answers[sent.text];
    if (typeof a === "number") return new Response("{}", { status: a });
    const sentences = (a ?? []).map((s) => ({ ...s, en: ANSWER_TEXT, zh: ANSWER_TEXT }));
    return new Response(JSON.stringify({ route: "emergency", sentences, ...(followUp ? { followUp: { ...followUp, en: ANSWER_TEXT } } : {}) }), { status: 200 });
  }) as typeof fetch;
}

const GOOD: Record<string, { templateId?: string }[]> = {
  "I have chest pain now": [{ templateId: "signal_995_chest" }],
  "I don't want to live anymore": [{ templateId: "self_harm_995" }, { templateId: "self_harm_sos" }, { templateId: "self_harm_mindline" }],
  "我不想活了": [{ templateId: "self_harm_995" }, { templateId: "self_harm_sos" }, { templateId: "self_harm_mindline" }, { templateId: "self_harm_care_corner" }],
  "My blood pressure is 200/120 and I have a really bad headache": [{ templateId: "emergency_995" }],
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("which templates name each line", () => {
  const sets = templateSets();

  it("reads them from the table: the 995, 1767 and 1771 sentences", () => {
    for (const id of ["emergency_995", "signal_995_chest", "signal_995_stroke", "signal_995_unwell", "self_harm_995", "emergency_overdose"]) expect(sets["995"].has(id), id).toBe(true);
    expect(sets["1767"].has("self_harm_sos")).toBe(true);
    expect(sets["1771"].has("self_harm_mindline")).toBe(true);
  });

  it("does not take a template that names none of them, nor a longer number", () => {
    expect(sets["995"].has("noted")).toBe(false);
    expect(sets["1767"].has("self_harm_mindline")).toBe(false);
    expect(sets["1771"].has("self_harm_sos")).toBe(false);
    const custom = templateSets([{ id: "a", en: "Call 995." }, { id: "b", en: "Call 19951." }, { id: "c", en: "SOS 1767 or 9151 1767" }, { id: "d", en: "Call 1771" }]);
    expect([...custom["995"]]).toEqual(["a"]);
    expect([...custom["1767"]]).toEqual(["c"]);
    expect([...custom["1771"]]).toEqual(["d"]);
  });

  it("counts a template the table gains later, without a change to the script", () => {
    const grown = templateSets([...ALL_TEMPLATES, { id: "pathway_995_first", en: "Call 995 now." }]);
    expect(grown["995"].has("pathway_995_first")).toBe(true);
  });
});

describe("templateIdsOf and checkAnswer", () => {
  it("collects the sentences' template ids and the follow-up's, once each", () => {
    expect(templateIdsOf({ sentences: [{ templateId: "a" }, { }, { templateId: "a" }, { templateId: "b" }], followUp: { templateId: "q1" } })).toEqual(["a", "b", "q1"]);
  });

  it("is null for a body that is no answer", () => {
    expect(templateIdsOf(null)).toBeNull();
    expect(templateIdsOf({ error: "x" })).toBeNull();
    expect(templateIdsOf("text")).toBeNull();
  });

  it("passes a case whose lines are all there, and names what is missing", () => {
    const selfHarm = CASES.find((c) => c.id === "self-harm-en")!;
    expect(checkAnswer(selfHarm, ["self_harm_995", "self_harm_sos", "self_harm_mindline"])).toMatchObject({ pass: true, missing: [] });
    expect(checkAnswer(selfHarm, ["self_harm_995", "self_harm_sos"])).toMatchObject({ pass: false, missing: ["1771"] });
    expect(checkAnswer(selfHarm, [])).toMatchObject({ pass: false, missing: ["1767", "1771"] });
    const chest = CASES.find((c) => c.id === "chest-pain-now")!;
    expect(checkAnswer(chest, ["signal_995_chest"]).pass).toBe(true);
    expect(checkAnswer(chest, ["emergency_995"]).pass).toBe(true);
    expect(checkAnswer(chest, ["noted"]).pass).toBe(false);
  });
});

describe("the host", () => {
  it("takes the local hosts", () => {
    for (const h of ["127.0.0.1", "localhost", "[::1]", "app.localhost"]) expect(isLocalHostname(h), h).toBe(true);
    expect(parseBase("http://127.0.0.1:3415", false)).toEqual({ ok: true, origin: "http://127.0.0.1:3415", remote: false });
    expect(parseBase("http://localhost:3415/some/path", false)).toMatchObject({ ok: true, origin: "http://localhost:3415" });
    expect(parseBase("http://[::1]:3415", false)).toMatchObject({ ok: true, remote: false });
  });

  it("refuses a host that is not local unless --allow-remote is given", () => {
    for (const raw of ["https://app.example.com", "http://192.168.1.20:3415", "http://127.0.0.1.example.com", "http://localhost.example.com"]) {
      const refused = parseBase(raw, false);
      expect(refused.ok, raw).toBe(false);
      if (!refused.ok) expect(refused.reason).toContain("owner's OK");
    }
    expect(parseBase("https://app.example.com", true)).toEqual({ ok: true, origin: "https://app.example.com", remote: true });
  });

  it("refuses an address that is not http, has a password, or is not an address", () => {
    expect(parseBase("ftp://127.0.0.1", true).ok).toBe(false);
    expect(parseBase("http://user:pass@127.0.0.1:3415", true).ok).toBe(false);
    expect(parseBase("not an address", true).ok).toBe(false);
  });
});

describe("run, with a fake server", () => {
  it("sends the session's cookies with every ask, in the right language, and passes four good answers", async () => {
    const calls: { url: string; cookie: string | null; body: unknown }[] = [];
    const inner = fakeServer(GOOD);
    const spy = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), cookie: new Headers(init?.headers).get("cookie"), body: init?.body ? JSON.parse(String(init.body)) : null });
      return inner(input, init);
    }) as typeof fetch;
    const results = await run("http://127.0.0.1:3415", spy);
    expect(results.map((r) => r.pass)).toEqual([true, true, true, true]);
    expect(calls).toHaveLength(5);
    expect(calls[0].url).toBe("http://127.0.0.1:3415/api/session");
    for (const c of calls.slice(1)) expect(c.cookie).toBe("rp_session=abc; rp_member=def");
    expect(calls[3].body).toEqual({ text: "我不想活了", locale: "zh-Hans" });
  });

  it("fails the case that misses a line, and only that one", async () => {
    const answers = { ...GOOD, "I don't want to live anymore": [{ templateId: "self_harm_995" }, { templateId: "self_harm_sos" }] };
    const results = await run("http://127.0.0.1:3415", fakeServer(answers));
    expect(results.map((r) => r.pass)).toEqual([true, false, true, true]);
    expect(results[1]).toMatchObject({ id: "self-harm-en", missing: ["1771"] });
  });

  it("fails every case with a code when the session cannot be opened, and a case whose ask is refused", async () => {
    const noSession = (async () => new Response("{}", { status: 429 })) as typeof fetch;
    expect((await run("http://127.0.0.1:3415", noSession)).map((r) => r.error)).toEqual(Array(4).fill("session_http_429"));
    const limited = await run("http://127.0.0.1:3415", fakeServer({ ...GOOD, "I have chest pain now": 429 }));
    expect(limited[0]).toMatchObject({ pass: false, error: "http_429" });
    expect(limited.slice(1).every((r) => r.pass)).toBe(true);
    const down = (async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:3415");
    }) as typeof fetch;
    expect((await run("http://127.0.0.1:3415", down)).map((r) => r.error)).toEqual(Array(4).fill("session_network"));
  });

  it("prints only labels, template ids and pass or fail, never the answer or the phrase", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubGlobal("fetch", fakeServer(GOOD, { templateId: "pathway_chest_q1" }));
    expect(await main(["--base", "http://127.0.0.1:3415"])).toBe(0);
    const printed = log.mock.calls.map((c) => String(c[0])).join("\n");
    expect(printed).not.toContain(ANSWER_TEXT);
    for (const c of CASES) expect(printed).not.toContain(c.text);
    expect(printed).toContain("chest-pain-now");
    expect(printed).toContain("signal_995_chest");
    expect(printed).toContain("pathway_chest_q1");
    expect(printed).toContain("4 of 4 passed");
    const miss: CaseResult = { id: "self-harm-zh", pass: false, seen: ["self_harm_995"], missing: ["1767", "1771"] };
    expect(formatResult(miss)).toBe("FAIL self-harm-zh         missing 1767,1771; saw self_harm_995");
  });
});

describe("main", () => {
  it("refuses a host that is not local without asking anything, and says the owner's OK is needed", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await main(["--base", "https://app.example.com"])).toBe(2);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(String(err.mock.calls[0][0])).toContain("owner's OK");
  });

  it("warns, and goes on, when --allow-remote is given", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("fetch", fakeServer(GOOD));
    expect(await main(["--base", "https://app.example.com", "--allow-remote"])).toBe(0);
    expect(String(err.mock.calls[0][0])).toContain("needs the owner's OK");
  });

  it("stops on an option it does not know, and exits 1 on a miss", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await main(["--bsae", "http://127.0.0.1:3415"])).toBe(2);
    vi.stubGlobal("fetch", fakeServer({ ...GOOD, "我不想活了": [{ templateId: "noted" }] }));
    expect(await main([])).toBe(1);
  });
});

describe("against the app's own routes (memory store, offline model)", () => {
  it("answers the four phrases with the 995 and helpline templates", async () => {
    const results = await run("http://localhost:3415", inProcessFetch());
    const printed = results.map(formatResult).join("\n");
    expect(results.map((r) => r.pass), printed).toEqual([true, true, true, true]);
  });
});
