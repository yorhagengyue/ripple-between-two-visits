/**
 * An empty read does not ask the database a second time whether the session exists, when this adapter has just read
 * that session (C2 track D, the one-second fix round; lib/store/supabase.ts knownScope).
 *
 * On the hosted database every call is a round trip. "An empty result is only an answer when the session exists" used
 * to cost a second trip for every empty list and every missing row: today's deliveries before the first reminder, a
 * week without readings, her switches before he set any. Every request reads its scope first, so within 10 seconds of
 * that read the adapter takes the session as there. The memory store's contract is unchanged for a session nobody
 * read, and for one this adapter deleted.
 *
 * A stand-in for PostgREST that counts the requests (the real database's side is the store contract over PGlite,
 * tests/unit/store/pglite.contract.test.ts, and the live one).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { SupabaseStore } from "@/lib/store/supabase";

const SESSION = {
  id: "sess-known-1",
  kind: "sandbox",
  template: "mr-tan",
  join_code: "ABCD12",
  story_day: 0,
  story_time: null,
  filming_mode: false,
  filming: false,
  clock_offset_ms: null,
  expires_at: null,
  created_at: "2026-10-11T00:00:00.000Z",
};

function postgrest(opts: { sessionExists: () => boolean }) {
  const seen: string[] = [];
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const table = url.pathname.split("/").pop() ?? "";
    seen.push(`${init?.method ?? "GET"} ${table}`);
    const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    if (table === "session" && (init?.method ?? "GET") === "GET") return json(opts.sessionExists() ? [SESSION] : []);
    return json([]);
  };
  return { seen, store: new SupabaseStore({ url: "http://postgrest.test", serviceKey: "test-key", fetch: fetchImpl as typeof fetch }) };
}

afterEach(() => vi.useRealTimers());

describe("an empty read on the hosted store", () => {
  it("a session nobody read: the empty list still asks whether it exists (two requests), and says so when it does not", async () => {
    const there = postgrest({ sessionExists: () => true });
    expect(await there.store.listDeliveries(SESSION.id, { fromDay: 0, toDay: 0 })).toEqual([]);
    expect(there.seen).toEqual(["GET reminder_delivery", "GET session"]);

    const gone = postgrest({ sessionExists: () => false });
    await expect(gone.store.listMeds("nope")).rejects.toMatchObject({ code: "session_not_found" });
    await expect(gone.store.getFamilyGrant("nope", "wei-ling")).rejects.toMatchObject({ code: "session_not_found" });
  });

  it("the request read its scope first: empty lists and a missing row are one request each", async () => {
    const t = postgrest({ sessionExists: () => true });
    expect((await t.store.getSession(SESSION.id))?.id).toBe(SESSION.id);
    t.seen.length = 0;
    expect(await t.store.listDeliveries(SESSION.id, { fromDay: 0, toDay: 0 })).toEqual([]);
    expect(await t.store.listBp(SESSION.id)).toEqual([]);
    expect(await t.store.listProfileFacts(SESSION.id)).toEqual([]);
    expect(await t.store.getFamilyGrant(SESSION.id, "some-link")).toBeNull();
    expect(t.seen).toEqual(["GET reminder_delivery", "GET bp_reading", "GET profile_fact", "GET family_grant"]);
  });

  it("ten seconds later it asks again", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-11T04:00:00.000Z"));
    const t = postgrest({ sessionExists: () => true });
    await t.store.getSession(SESSION.id);
    vi.setSystemTime(new Date("2026-10-11T04:00:09.000Z"));
    t.seen.length = 0;
    await t.store.listMeds(SESSION.id);
    expect(t.seen).toEqual(["GET medication"]);
    vi.setSystemTime(new Date("2026-10-11T04:00:11.000Z"));
    t.seen.length = 0;
    await t.store.listMeds(SESSION.id);
    expect(t.seen).toEqual(["GET medication", "GET session"]);
  });

  it("a session this adapter deleted is not found at once", async () => {
    let exists = true;
    const t = postgrest({ sessionExists: () => exists });
    await t.store.getSession(SESSION.id);
    await t.store.deleteSession(SESSION.id);
    exists = false;
    await expect(t.store.listMeds(SESSION.id)).rejects.toMatchObject({ code: "session_not_found" });
  });
});
