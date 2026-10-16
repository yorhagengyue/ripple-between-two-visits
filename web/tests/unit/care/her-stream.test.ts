/**
 * Her side of the live stream, piece by piece (C2 track D, the one-second fix round; lib/care/her-stream.ts,
 * lib/family/events.ts createFamilyStream, lib/bus.ts subscribeEarly). The times are in one-second.test.ts; this is the
 * behaviour those times rest on:
 *
 *   - the bus tells an early listener of a publish before the event is stored, and the stored event still follows
 *   - her stream takes a change of his switches once and in order: the same change twice, or an older one late, is
 *     dropped and never moves the switches back
 *   - the re-read of her link and switches closes the stream when the link ended, and brings switches the stream had
 *     not heard of (a lost event)
 *   - her home is pushed only to a stream that asked, in one round; when what the stream held was out of date (a
 *     setting of his changed) the copy is built again from what the store says; each push is logged as a look
 *   - nothing of a section is sent after the frame that told her it is off, even an event published just before
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { GET as eventsGet } from "@/app/api/events/route";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { Bus, type BusEvent } from "@/lib/bus";
import { herSide, VIEW_EVENT } from "@/lib/care/her-stream";
import type { FamilyHomeData } from "@/lib/care/home-types";
import { hashToken, newInviteToken } from "@/lib/care/tokens";
import { createFamilyStream } from "@/lib/family/events";
import { NO_GRANTS } from "@/lib/family/types";
import { getMemoryStore } from "@/lib/store/memory";
import type { CareLinkRow, FamilyGrantItems, FamilyGrantRow, SessionRow } from "@/lib/store/types";
import { familySubject } from "@/lib/subject";
import { linkConsent } from "@/lib/care/reconsent";
import { agreedLink } from "../../support/agreed-link";
import { installSlowStore, MemoryEventLog, slowLog, wait, type SlowStore } from "../../support/slow-store";

const store = getMemoryStore();
const decoder = new TextDecoder();
const login = (p: string) => `${p}${randomUUID().replace(/-/g, "").slice(0, 10)}`;
const account = (space: "example" | "blank" | "none"): Promise<TestAccount> => createAccountWithSpace(store, getAuthProvider(), { login: login(space === "none" ? "w" : "t"), password: "a long test password", space });

async function linked(him: TestAccount, her: TestAccount, items: Partial<FamilyGrantItems> = {}): Promise<CareLinkRow> {
  const t = newInviteToken();
  await store.createInvite({ id: t.linkId, patient_id: him.userId, family_label: "Wei Ling", patient_label: "爸爸", invite_token_hash: hashToken(t.token), invite_expires_at: new Date(Date.now() + 3600_000).toISOString() }, {});
  await store.acceptInvite(hashToken(t.token), her.userId);
  await store.confirmLink(t.linkId, him.userId, true);
  if (Object.keys(items).length) await store.setFamilyGrant(him.userId, t.linkId, items);
  // the two records an invitation he confirmed carries (without them her view is the alert-only form: lib/care/reconsent.ts)
  await agreedLink(store, { id: t.linkId, patient_id: him.userId, family_id: her.userId });
  return (await store.getCareLink(t.linkId))!;
}

const grantEvent = (id: number, scope: string, grant: FamilyGrantRow): BusEvent => ({ id, type: "family_grant.changed", session_id: scope, at: new Date().toISOString(), say: "", data: { grant, changed: {} } });
const row = (scope: string, link: string, items: Partial<FamilyGrantItems>, version: number): FamilyGrantRow => ({ session_id: scope, member: link, items: { ...NO_GRANTS, ...items }, created_at: "2026-10-11T00:00:00.000Z", updated_at: "2026-10-11T00:00:00.000Z", link_id: link, version });
const doseEvent = (id: number, scope: string): BusEvent => ({ id, type: "dose.logged", session_id: scope, at: new Date().toISOString(), say: "he ticked taken", data: { dose: { medication_id: "med-amlodipine", day: 0, slot: "morning", state: "taken" } } });
const dataOf = (frame: string) => JSON.parse(frame.split("\n").find((l) => l.startsWith("data: "))!.slice(6)) as Record<string, unknown>;

type G = typeof globalThis & { __rippleBus?: Bus };
let slow: SlowStore | null = null;
const buses: Bus[] = [];
let busBefore: Bus | undefined;
let swapped = false;
afterEach(() => {
  slow?.restore();
  slow = null;
  for (const b of buses.splice(0)) b.close();
  if (swapped) (globalThis as G).__rippleBus = busBefore;
  swapped = false;
});
function installBus(bus: Bus): Bus {
  const g = globalThis as G;
  if (!swapped) busBefore = g.__rippleBus;
  swapped = true;
  g.__rippleBus = bus;
  buses.push(bus);
  return bus;
}

describe("the bus tells an early listener before the event is stored", () => {
  it("shared log: the early listener hears the event at once with id 0; the stored event follows with its id", async () => {
    const bus = new Bus({ log: slowLog(new MemoryEventLog(), 60), pollMs: 40, lingerMs: 50 });
    buses.push(bus);
    const heard: { how: string; id: number; at: number; data: unknown }[] = [];
    const t0 = performance.now();
    bus.subscribe("scope-a", (e) => heard.push({ how: "stored", id: e.id, at: performance.now() - t0, data: e.data }));
    bus.subscribeEarly("scope-a", (e) => heard.push({ how: "early", id: e.id, at: performance.now() - t0, data: e.data }));
    await wait(200); // the tail has read the (empty) channel
    const start = performance.now() - t0;
    const payload = { link: { id: "l1", status: "revoked" } };
    bus.publish("scope-a", "care_link.revoked", "He stopped sharing", payload);
    expect(heard.map((h) => h.how)).toEqual(["early"]); // in the same tick as publish()
    expect(heard[0].id).toBe(0);
    payload.link.status = "changed later"; // the caller's object is not what was sent
    await bus.flush("scope-a");
    await wait(30);
    expect(heard.map((h) => h.how)).toEqual(["early", "stored"]);
    expect(heard[1].id).toBe(1);
    expect(heard[1].at - start).toBeGreaterThanOrEqual(55); // one write later
    expect(heard[0].data).toEqual({ link: { id: "l1", status: "revoked" } });
    expect(heard[1].data).toEqual({ link: { id: "l1", status: "revoked" } });
    // another scope's publish is not heard; an unsubscribed listener neither
    bus.publish("scope-b", "dose.logged", "", {});
    expect(heard).toHaveLength(2);
  });

  it("in process: nothing is delivered early (subscribe() already hears a publish at once)", () => {
    const bus = new Bus();
    const heard: string[] = [];
    bus.subscribe("s", () => heard.push("stored"));
    const off = bus.subscribeEarly("s", () => heard.push("early"));
    bus.publish("s", "dose.logged", "", {});
    expect(heard).toEqual(["stored"]);
    off();
  });
});

describe("her stream takes a change of his switches once and in order", () => {
  const scope = "scope-1";
  const link = "link-1";

  it("a newer change is sent and taken; the same change again, or an older one late, is dropped", () => {
    const s = createFamilyStream({ ...NO_GRANTS, dose_summary: true }, { linkId: link, version: 3 });
    expect(s.version()).toBe(3);
    // change 4: his medicine off (told early, id 0)
    const first = s.view(grantEvent(0, scope, row(scope, link, {}, 4)));
    expect(first.kind).toBe("pass");
    expect((first.event!.data as { grant: { version: number } }).grant.version).toBe(4);
    expect(s.grants().dose_summary).toBe(false);
    // the stored copy of change 4 arrives: not sent again
    expect(s.view(grantEvent(17, scope, row(scope, link, {}, 4))).kind).toBe("dropped");
    // change 3 (his medicine ON), published by another instance, read from the table late: never moves them back
    expect(s.view(grantEvent(16, scope, row(scope, link, { dose_summary: true }, 3))).kind).toBe("dropped");
    expect(s.grants().dose_summary).toBe(false);
    expect(s.version()).toBe(4);
    // so a tick of his is not sent
    expect(s.view(doseEvent(18, scope)).kind).toBe("dropped");
    // change 5: on again
    expect(s.view(grantEvent(19, scope, row(scope, link, { dose_summary: true }, 5))).kind).toBe("pass");
    expect(s.view(doseEvent(20, scope)).kind).toBe("trimmed");
  });

  it("another family member's switches are never hers, whatever their version", () => {
    const s = createFamilyStream({ ...NO_GRANTS }, { linkId: link, version: 1 });
    expect(s.view(grantEvent(5, scope, row(scope, "link-2", { notes: true, dose_summary: true }, 9))).kind).toBe("dropped");
    expect(s.grants()).toEqual({ ...NO_GRANTS });
    expect(s.version()).toBe(1);
  });

  it("adopt: switches read from the store are taken when newer, ignored when not", () => {
    const s = createFamilyStream({ ...NO_GRANTS, notes: true }, { linkId: link, version: 2 });
    expect(s.adopt({ ...NO_GRANTS }, 2)).toBe(false);
    expect(s.adopt({ ...NO_GRANTS, bp_summary: true }, 1)).toBe(false);
    expect(s.grants().notes).toBe(true);
    expect(s.adopt({ ...NO_GRANTS }, 3)).toBe(true);
    expect(s.grants().notes).toBe(false);
    expect(s.version()).toBe(3);
  });

  it("the demo's stream (no link, no versions) follows every change as before", () => {
    const s = createFamilyStream({ ...NO_GRANTS });
    const demo: FamilyGrantRow = { session_id: scope, member: "wei-ling", items: { ...NO_GRANTS, notes: true }, created_at: "", updated_at: "" };
    expect(s.view(grantEvent(1, scope, demo)).kind).toBe("pass");
    expect(s.view(grantEvent(2, scope, demo)).kind).toBe("pass");
    expect(s.grants().notes).toBe(true);
    expect(s.version()).toBe(0);
  });
});

/** Her side as GET /api/events builds it: her store through her link, his scope row, her switches as stored. */
async function side(him: TestAccount, her: TestAccount, link: CareLinkRow, pushView: boolean) {
  const scope = (await store.getSession(him.userId)) as SessionRow;
  // whether each of them has agreed to the family text in force, as the request's resolution reads it (lib/subject/resolve.ts)
  const subject = familySubject(getMemoryStore(), scope, her.userId, link, await linkConsent(getMemoryStore(), link));
  const grant = await subject.store.getFamilyGrant(scope.id, link.id);
  const stream = createFamilyStream(grant?.items ?? { ...NO_GRANTS }, { linkId: link.id, version: grant?.version ?? 0 });
  return { stream, scope, her: herSide({ store: subject.store, scope, link, userId: her.userId, stream, grant, pushView }) };
}

describe("the re-read of her link and switches", () => {
  it("nothing changed: nothing to say; the first frame is her switches as they are, without his scope's id", async () => {
    const him = await account("blank");
    const her = await account("none");
    const link = await linked(him, her, { dose_summary: true });
    const s = await side(him, her, link, false);
    expect(await s.her.check()).toBeNull();
    const hello = dataOf(s.her.hello);
    expect(hello).toMatchObject({ id: 0, type: "family_grant.changed", session_id: "", say: "" });
    expect((hello.data as { grant: { items: FamilyGrantItems; version: number; member: string } }).grant).toMatchObject({ member: link.id, version: s.stream.version(), items: { dose_summary: true, notes: false } });
    expect(s.her.hello).not.toContain(him.userId);
    expect(s.her.hello).not.toMatch(/^id:/m);
  });

  it("his switches changed and the event never came: the re-read brings them, and the stream filters by them from then on", async () => {
    const him = await account("blank");
    const her = await account("none");
    const link = await linked(him, her, { dose_summary: true, notes: true });
    const s = await side(him, her, link, false);
    expect(s.stream.view(doseEvent(1, him.userId)).kind).toBe("trimmed");
    await store.setFamilyGrant(him.userId, link.id, { dose_summary: false }); // no event
    const r = await s.her.check();
    expect(r).toMatchObject({ end: false, changed: true });
    expect((dataOf(r!.frame).data as { grant: { items: FamilyGrantItems } }).grant.items).toMatchObject({ dose_summary: false, notes: true });
    expect(r!.frame).not.toContain(him.userId);
    expect(s.stream.view(doseEvent(2, him.userId)).kind).toBe("dropped");
    expect(await s.her.check()).toBeNull(); // told once
  });

  it("her link ended, or went with his account: the closing frame says who, and the stream is over", async () => {
    const him = await account("blank");
    const her = await account("none");
    const link = await linked(him, her, { dose_summary: true });
    const s = await side(him, her, link, false);
    await store.revokeLink(link.id, him.userId, "patient");
    const stopped = await s.her.check();
    expect(stopped).toMatchObject({ end: true });
    expect(dataOf(stopped!.frame)).toMatchObject({ type: "care_link.revoked", data: { link: { id: link.id, status: "revoked", by: "patient" } } });

    const him2 = await account("blank");
    const link2 = await linked(him2, her, {});
    const s2 = await side(him2, her, link2, false);
    await store.deleteAccount(him2.userId);
    expect(dataOf((await s2.her.check())!.frame)).toMatchObject({ data: { link: { id: link2.id, by: "gone" } } });
  });
});

describe("her home, pushed by her stream", () => {
  it("only to a stream that asked for it", async () => {
    const him = await account("example");
    const her = await account("none");
    const link = await linked(him, her, { dose_summary: true });
    const before = (await store.listCareAccessLog(him.userId)).length;
    expect(await (await side(him, her, link, false)).her.view()).toBe("");
    expect((await store.listCareAccessLog(him.userId)).length).toBe(before);
  });

  it("one frame named `view` with her home as it is, her look logged, his scope's id nowhere in it", async () => {
    const him = await account("example");
    const her = await account("none");
    const link = await linked(him, her, { dose_summary: true, bp_summary: true });
    const s = await side(him, her, link, true);
    const before = (await store.listCareAccessLog(him.userId)).length;
    const frame = await s.her.view();
    expect(frame.startsWith(`event: ${VIEW_EVENT}\n`)).toBe(true);
    expect(frame).not.toMatch(/^id:/m);
    expect(frame).not.toContain(him.userId);
    const home = dataOf(frame) as unknown as FamilyHomeData;
    expect(home.linkId).toBe(link.id);
    expect(home.grants).toMatchObject({ dose_summary: true, bp_summary: true, notes: false });
    expect(home.grantsVersion).toBe(s.stream.version());
    expect(home.week?.days).toHaveLength(7);
    expect(home.questions).toBeNull();
    const rows = await store.listCareAccessLog(him.userId);
    expect(rows.length).toBe(before + 1);
    expect(rows.at(-1)).toMatchObject({ link_id: link.id, family_user_id: her.userId, route: "/f", items: ["dose_summary", "bp_summary"] });
  });

  it("what the stream held was out of date (he moved his reminder since it connected): the copy is built from what the store says", async () => {
    const him = await account("example");
    const her = await account("none");
    const link = await linked(him, her, { dose_summary: true });
    const s = await side(him, her, link, true);
    const then = (dataOf(await s.her.view()) as unknown as FamilyHomeData).reminder?.at;
    const scope = (await store.getSession(him.userId))!;
    await store.updateScope(him.userId, { settings: { ...(scope.settings ?? {}), reminder_time: "07:05" } });
    const home = dataOf(await s.her.view()) as unknown as FamilyHomeData;
    expect(then).not.toBe("07:05");
    expect(home.reminder?.at).toBe("07:05");
    expect(home.week?.days).toHaveLength(7);
  });

  it("his switches moved in the store and the stream had not heard: the copy carries the new switches and the stream follows", async () => {
    const him = await account("example");
    const her = await account("none");
    const link = await linked(him, her, { dose_summary: true, bp_summary: true });
    const s = await side(him, her, link, true);
    await store.setFamilyGrant(him.userId, link.id, { dose_summary: false }); // no event reached the stream
    const home = dataOf(await s.her.view()) as unknown as FamilyHomeData;
    expect(home.grants.dose_summary).toBe(false);
    expect(home.week).toBeNull();
    expect(home.status).toBeNull();
    expect(s.stream.grants().dose_summary).toBe(false);
    expect(s.stream.version()).toBe(home.grantsVersion);
  });

  it("her link ended while it was read: nothing is sent", async () => {
    const him = await account("example");
    const her = await account("none");
    const link = await linked(him, her, { dose_summary: true });
    const s = await side(him, her, link, true);
    await store.revokeLink(link.id, him.userId, "patient");
    expect(await s.her.view()).toBe("");
  });
});

describe("nothing of a section after the frame that told her it is off", () => {
  it("a tick of his published just before he switched his medicine off, stored just after: it is not sent", async () => {
    const him = await account("example");
    const her = await account("none");
    const link = await linked(him, her, { dose_summary: true });
    const bus = installBus(new Bus({ log: slowLog(new MemoryEventLog(), 80), pollMs: 300, lingerMs: 50 }));
    slow = installSlowStore(10);
    const abort = new AbortController();
    const res = await eventsGet(new NextRequest(`http://localhost/api/events?link=${link.id}&since=0`, { headers: { cookie: `rp_at=${her.tokens.access_token}` }, signal: abort.signal }));
    const reader = res.body!.getReader();
    let text = "";
    const pump = (async () => {
      for (;;) {
        const r = await reader.read();
        if (r.done) return;
        text += decoder.decode(r.value);
      }
    })();
    await wait(450); // connected, her first frame in, the bus following his channel
    const mark = text.length;

    // he ticks 「吃了」 (the event's write takes 80 ms) and, 20 ms later, his switch change is published
    bus.publish(him.userId, "dose.logged", "he ticked taken", { dose: { medication_id: "med-amlodipine", day: 0, slot: "morning", state: "taken" } });
    await wait(20);
    const grant = await getMemoryStore().setFamilyGrant(him.userId, link.id, { dose_summary: false });
    bus.publish(him.userId, "family_grant.changed", "He changed what a family member can see", { grant, changed: { dose_summary: false } });
    await wait(700); // both events are stored and have come back through the table
    const after = text.slice(mark);
    const types = after.split("\n").filter((l) => l.startsWith("data: ")).map((l) => (JSON.parse(l.slice(6)) as { type: string }).type);
    expect(types).toEqual(["family_grant.changed"]);
    expect(after).not.toContain("med-amlodipine");
    abort.abort();
    await pump.catch(() => {});
  }, 15_000);
});
