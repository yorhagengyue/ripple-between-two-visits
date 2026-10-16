/**
 * Store selection and the Supabase adapter's HTTP shape, without network (fake fetch). The live behaviour is
 * in supabase.live.test.ts (STORE_LIVE=1).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { getStore, storeKind, StoreError } from "@/lib/store";
import { getMemoryStore } from "@/lib/store/memory";
import { createSupabaseStore, getSupabaseStore, PostgrestError, SupabaseStore } from "@/lib/store/supabase";

const FAKE_URL = "https://fake-project.example.invalid";
const FAKE_KEY = "sb_secret_fake_value_for_tests_only";

afterEach(() => {
  vi.unstubAllEnvs();
});

type Call = { url: string; init: RequestInit };

function fakeFetch(respond: (call: Call) => Response | Promise<Response>): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const f = (async (input: string | URL | Request, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    return respond(call);
  }) as typeof fetch;
  return { fetch: f, calls };
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("store selection", () => {
  it("defaults to the process-wide memory store", () => {
    vi.stubEnv("STORE", "");
    expect(storeKind()).toBe("memory");
    expect(getStore()).toBe(getMemoryStore());
    vi.stubEnv("STORE", "Memory");
    expect(getStore()).toBe(getMemoryStore());
  });

  it("STORE=supabase without a URL and key fails loudly, never falls back to memory", () => {
    vi.stubEnv("STORE", "supabase");
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_KEY", "");
    expect(() => getStore()).toThrow(/not configured/);
    try {
      getStore();
    } catch (err) {
      expect(err).toBeInstanceOf(StoreError);
      expect((err as StoreError).code).toBe("not_configured");
    }
    vi.stubEnv("STORE", "mongo");
    expect(() => getStore()).toThrow(StoreError);
  });

  it("STORE=supabase with a URL and key gives one adapter per process (no network until a call)", () => {
    vi.stubEnv("STORE", "supabase");
    vi.stubEnv("SUPABASE_URL", FAKE_URL);
    vi.stubEnv("SUPABASE_SERVICE_KEY", FAKE_KEY);
    const store = getStore();
    expect(store.kind).toBe("supabase");
    expect(store).toBeInstanceOf(SupabaseStore);
    expect(getStore()).toBe(store);
    vi.stubEnv("SUPABASE_SERVICE_KEY", `${FAKE_KEY}-rotated`);
    expect(getSupabaseStore()).not.toBe(store); // a new key gets a new adapter
  });
});

describe("supabase adapter over PostgREST (fake fetch)", () => {
  it("sends the key only in headers and reads rows back like the memory store", async () => {
    const { fetch, calls } = fakeFetch(() =>
      json(200, [
        {
          id: "s1",
          join_code: "ABCDEF",
          template: "mr-tan",
          story_day: 29,
          story_time: null,
          filming_mode: false,
          created_at: "2026-10-09T00:00:00+00:00",
          expires_at: null,
          seq: 7,
        },
      ]),
    );
    const store = createSupabaseStore({ url: FAKE_URL, serviceKey: FAKE_KEY, fetch });
    const s = await store.getSession("s1");
    expect(s).toEqual({
      id: "s1",
      join_code: "ABCDEF",
      template: "mr-tan",
      story_day: 29,
      story_time: null,
      filming_mode: false,
      created_at: "2026-10-09T00:00:00.000Z",
      expires_at: null,
    });
    expect(calls).toHaveLength(1);
    const url = new URL(calls[0].url);
    expect(url.pathname).toBe("/rest/v1/session");
    expect(url.searchParams.get("id")).toBe("eq.s1");
    expect(url.search).not.toContain(FAKE_KEY);
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.apikey).toBe(FAKE_KEY);
    expect(headers.authorization).toBe(`Bearer ${FAKE_KEY}`);
  });

  it("errors carry the operation, status and code only: no key, no URL, no response text", async () => {
    const leaky = { code: "XX000", message: `boom ${FAKE_KEY} at ${FAKE_URL}`, details: FAKE_KEY };
    const { fetch } = fakeFetch(() => json(500, leaky));
    const store = createSupabaseStore({ url: FAKE_URL, serviceKey: FAKE_KEY, fetch });
    const err = await store.listMeds("s1").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PostgrestError);
    const text = `${(err as Error).message} ${JSON.stringify(err)}`;
    expect(text).not.toContain(FAKE_KEY);
    expect(text).not.toContain("fake-project");
    expect(text).not.toContain("boom");
    expect((err as PostgrestError).code).toBe("XX000");
  });

  it("a missing schema or a rejected key is not_configured, with the fix and nothing secret", async () => {
    const missing = createSupabaseStore({ url: FAKE_URL, serviceKey: FAKE_KEY, fetch: fakeFetch(() => json(404, { code: "PGRST205", message: "x" })).fetch });
    await expect(missing.getSession("s1")).rejects.toMatchObject({ code: "not_configured", message: expect.stringContaining("migrate.mjs") });
    const rejected = createSupabaseStore({ url: FAKE_URL, serviceKey: FAKE_KEY, fetch: fakeFetch(() => json(401, { code: "42501", message: "x" })).fetch });
    const err = (await rejected.getSession("s1").catch((e: unknown) => e)) as StoreError;
    expect(err).toMatchObject({ code: "not_configured" });
    expect(err.message).not.toContain(FAKE_KEY);
  });

  it("a network failure is retried once for reads and never echoes the URL", async () => {
    let n = 0;
    const { fetch, calls } = fakeFetch(() => {
      n++;
      throw new TypeError(`fetch failed for ${FAKE_URL}`);
    });
    const store = createSupabaseStore({ url: FAKE_URL, serviceKey: FAKE_KEY, fetch });
    const err = (await store.getSession("s1").catch((e: unknown) => e)) as Error;
    expect(n).toBe(2);
    expect(calls).toHaveLength(2);
    expect(err.message).toBe("Supabase read session: no response (network)");
    // writes are not retried (no double insert)
    n = 0;
    await store.addEvalRun({ git_sha: null, results: {} }).catch(() => {});
    expect(n).toBe(1);
  });

  it("session_not_found when a list is empty because the session does not exist", async () => {
    const { fetch, calls } = fakeFetch(() => json(200, []));
    const store = createSupabaseStore({ url: FAKE_URL, serviceKey: FAKE_KEY, fetch });
    await expect(store.listMeds("nope")).rejects.toMatchObject({ code: "session_not_found" });
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual(["/rest/v1/medication", "/rest/v1/session"]);
  });
});
