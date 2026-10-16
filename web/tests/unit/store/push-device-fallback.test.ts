/**
 * A push subscription on a database that does not have push_subscription.device_hash yet (C2 track D, round two:
 * supabase/migrations/0015_d_push_device.sql is a file until the integrator applies it). The Supabase adapter names the
 * column when the phone's device is known; PostgREST then answers PGRST204 (no such column in the payload). Turning
 * reminders on must not depend on the migration: the subscription is saved as before, without the device.
 *
 * A stand-in for PostgREST's push_subscription table with a switch for "the column exists" (the with-column path on a
 * real PostgreSQL is the store contract over PGlite, tests/unit/store/pglite.contract.test.ts).
 */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SupabaseStore } from "@/lib/store/supabase";

type Row = Record<string, unknown>;

function fakeTable(opts: { hasColumn: boolean }) {
  const rows: Row[] = [];
  const seen: { method: string; body: Row | null }[] = [];
  const refuse = () => new Response(JSON.stringify({ code: "PGRST204", message: "Could not find the 'device_hash' column of 'push_subscription' in the schema cache" }), { status: 400, headers: { "content-type": "application/json" } });
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(String(init.body)) as Row) : null;
    seen.push({ method, body });
    if (!url.pathname.endsWith("/push_subscription")) return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    if (body && "device_hash" in body && !opts.hasColumn) return refuse();
    const endpoint = (url.searchParams.get("endpoint") ?? "").replace(/^eq\./, "");
    if (method === "PATCH") {
      const hit = rows.filter((r) => r.endpoint === endpoint);
      for (const r of hit) Object.assign(r, body);
      return new Response(JSON.stringify(hit), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (method === "POST") {
      rows.push({ ...body });
      return new Response(null, { status: 201 });
    }
    return new Response(JSON.stringify(rows), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { rows, seen, fetchImpl };
}

const store = (fetchImpl: typeof fetch) => new SupabaseStore({ url: "http://postgrest.test", serviceKey: "test-key", fetch: fetchImpl });
const HASH = "c".repeat(64);

describe("savePushSubscription and the device column", () => {
  it("the column is there: the device is stored with the subscription", async () => {
    const t = fakeTable({ hasColumn: true });
    const user = randomUUID();
    const saved = await store(t.fetchImpl as typeof fetch).savePushSubscription({ user_id: user, endpoint: "https://push.example/a", p256dh: "k", auth: "a", device_hash: HASH });
    expect(saved.device_hash).toBe(HASH);
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0]).toMatchObject({ user_id: user, endpoint: "https://push.example/a", device_hash: HASH });
  });

  it("the column is not there yet: the subscription is saved without the device, once", async () => {
    const t = fakeTable({ hasColumn: false });
    const user = randomUUID();
    const s = store(t.fetchImpl as typeof fetch);
    const saved = await s.savePushSubscription({ user_id: user, endpoint: "https://push.example/b", p256dh: "k", auth: "a", device_hash: HASH });
    expect(saved).toMatchObject({ user_id: user, endpoint: "https://push.example/b", p256dh: "k" });
    expect(saved.device_hash ?? null).toBeNull();
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0]).not.toHaveProperty("device_hash");
    // subscribing again (new keys) updates the one row, again without the device
    const again = await s.savePushSubscription({ user_id: user, endpoint: "https://push.example/b", p256dh: "k2", auth: "a2", device_hash: HASH });
    expect(again).toMatchObject({ p256dh: "k2" });
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0]).toMatchObject({ p256dh: "k2", auth: "a2" });
  });

  it("no device known: the column is never named, so nothing depends on it", async () => {
    const t = fakeTable({ hasColumn: false });
    await store(t.fetchImpl as typeof fetch).savePushSubscription({ user_id: randomUUID(), endpoint: "https://push.example/c", p256dh: "k", auth: "a" });
    expect(t.rows).toHaveLength(1);
    expect(t.seen.some((r) => r.body && "device_hash" in r.body)).toBe(false);
  });

  it("any other refusal is still an error", async () => {
    const failing = (async () => new Response(JSON.stringify({ code: "23503", message: "violates foreign key constraint" }), { status: 409, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    await expect(store(failing).savePushSubscription({ user_id: randomUUID(), endpoint: "https://push.example/d", p256dh: "k", auth: "a", device_hash: HASH })).rejects.toBeTruthy();
  });
});
