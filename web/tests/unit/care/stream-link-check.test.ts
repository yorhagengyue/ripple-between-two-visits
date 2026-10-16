/**
 * Her stream reads her link again before anything that came from the shared event table goes to her (C2 track D, round
 * two; real-app 3.10 「撤回，1 秒内……流在每次读表时也再查一次链接」). The closing event normally ends her stream; this is
 * the case where that event never arrived (lost, or not yet written when the next event was read): with STORE=supabase
 * the stream used to live until the next 3-second check and would have sent her what was read in between.
 *
 * A shared event log (the bus_event table's contract, as in tests/unit/store/bus-remote.test.ts) under the process
 * bus; the store is the memory store. His link is revoked in the store WITHOUT its event, then something of his is
 * published: her stream gets the closing frame instead of it, at once.
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/events/route";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { Bus, type BusEvent, type BusLog } from "@/lib/bus";
import { hashToken, newInviteToken } from "@/lib/care/tokens";
import { getMemoryStore } from "@/lib/store/memory";
import { agreedLink } from "../../support/agreed-link";

const store = getMemoryStore();
const decoder = new TextDecoder();

class SharedLog implements BusLog {
  private events = new Map<string, BusEvent[]>();
  async append(event: Omit<BusEvent, "id">): Promise<number> {
    const list = this.events.get(event.session_id) ?? [];
    const id = list.length + 1;
    list.push(structuredClone({ ...event, id }));
    this.events.set(event.session_id, list);
    return id;
  }
  async after(sessionId: string, afterId: number, limit: number): Promise<BusEvent[]> {
    return structuredClone((this.events.get(sessionId) ?? []).filter((e) => e.id > afterId).slice(0, limit));
  }
  async latest(sessionId: string, limit: number): Promise<BusEvent[]> {
    return structuredClone((this.events.get(sessionId) ?? []).slice(-limit));
  }
  async head(sessionId: string): Promise<number> {
    return (this.events.get(sessionId) ?? []).length;
  }
  async clear(sessionId: string): Promise<void> {
    this.events.set(sessionId, []);
  }
}

type G = typeof globalThis & { __rippleBus?: Bus };
const buses: Bus[] = [];
afterEach(() => {
  for (const b of buses.splice(0)) b.close();
});

async function withSharedBus<T>(run: (bus: Bus) => Promise<T>): Promise<T> {
  const g = globalThis as G;
  const before = g.__rippleBus;
  const bus = new Bus({ log: new SharedLog(), pollMs: 20, lingerMs: 50 });
  buses.push(bus);
  g.__rippleBus = bus;
  try {
    return await run(bus);
  } finally {
    g.__rippleBus = before;
  }
}

const login = (p: string) => `${p}${randomUUID().replace(/-/g, "").slice(0, 10)}`;
const account = (space: "blank" | "none"): Promise<TestAccount> => createAccountWithSpace(store, getAuthProvider(), { login: login(space === "none" ? "w" : "t"), password: "a long test password", space });

async function linked(him: TestAccount, her: TestAccount): Promise<string> {
  const t = newInviteToken();
  await store.createInvite({ id: t.linkId, patient_id: him.userId, family_label: "Wei Ling", invite_token_hash: hashToken(t.token), invite_expires_at: new Date(Date.now() + 3600_000).toISOString() }, {});
  await store.acceptInvite(hashToken(t.token), her.userId);
  await store.confirmLink(t.linkId, him.userId, true);
  await store.setFamilyGrant(him.userId, t.linkId, { dose_summary: true });
  // the two records an invitation he confirmed carries (without them her stream is cut: lib/care/reconsent.ts)
  await agreedLink(store, { id: t.linkId, patient_id: him.userId, family_id: her.userId });
  return t.linkId;
}

async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, needle: string | RegExp): Promise<string> {
  let text = "";
  const hit = () => (typeof needle === "string" ? text.includes(needle) : needle.test(text));
  for (let i = 0; i < 80 && !hit(); i++) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value);
  }
  return text;
}
const frames = (text: string) => text.split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)) as BusEvent);
const dose = { dose: { medication_id: "med-amlodipine", day: 0, slot: "morning", state: "taken" } };

function open(her: TestAccount, linkId: string) {
  const abort = new AbortController();
  const req = new NextRequest(`http://localhost/api/events?link=${linkId}&since=0`, { headers: { cookie: `rp_at=${her.tokens.access_token}` }, signal: abort.signal });
  return { abort, res: GET(req) };
}

describe("her stream over the shared event table", () => {
  it("an active link: what he logs reaches her, trimmed (the control)", async () => {
    const him = await account("blank");
    const her = await account("none");
    const id = await linked(him, her);
    await withSharedBus(async (bus) => {
      const { abort, res } = open(her, id);
      const r = await res;
      expect(r.status).toBe(200);
      const reader = r.body!.getReader();
      await readUntil(reader, /id: 0\n\n/);
      bus.publish(him.userId, "dose.logged", "he ticked taken", dose);
      const text = await readUntil(reader, "dose.logged");
      expect(frames(text)).toEqual([expect.objectContaining({ type: "dose.logged", say: "", session_id: "", data: dose })]);
      abort.abort();
    });
  });

  it("his link ended and its event never came: the next read of the table closes her stream, and what was read is not sent", async () => {
    const him = await account("blank");
    const her = await account("none");
    const id = await linked(him, her);
    await withSharedBus(async (bus) => {
      const { abort, res } = open(her, id);
      const reader = (await res).body!.getReader();
      await readUntil(reader, /id: 0\n\n/);

      // revoked in the store; no care_link.revoked is published
      expect((await store.revokeLink(id, him.userId, "patient")).ok).toBe(true);
      const t0 = Date.now();
      bus.publish(him.userId, "dose.logged", "he ticked taken", dose);
      const text = await readUntil(reader, "care_link.revoked");
      const elapsed = Date.now() - t0;
      const got = frames(text);
      expect(got).toHaveLength(1);
      expect(got[0]).toMatchObject({ type: "care_link.revoked", data: { link: { id, status: "revoked", by: "patient" } } });
      expect(text).not.toContain("dose.logged");
      expect(text).not.toContain("med-amlodipine");
      // well inside the second the design allows, not the 3-second timer
      expect(elapsed).toBeLessThan(1000);
      expect((await reader.read()).done).toBe(true);
      abort.abort();
    });
  });

  it("his account is gone (no link row at all): the closing frame says so", async () => {
    const him = await account("blank");
    const her = await account("none");
    const id = await linked(him, her);
    await withSharedBus(async (bus) => {
      const { abort, res } = open(her, id);
      const reader = (await res).body!.getReader();
      await readUntil(reader, /id: 0\n\n/);
      await store.deleteAccount(him.userId);
      bus.publish(him.userId, "dose.logged", "a late event", dose);
      const text = await readUntil(reader, "care_link.revoked");
      expect(frames(text)).toEqual([expect.objectContaining({ type: "care_link.revoked", data: { link: { id, status: "revoked", by: "gone" } } })]);
      expect((await reader.read()).done).toBe(true);
      abort.abort();
    });
  });
});
