/**
 * The brief as it was shown to the doctor (C2 track B, second round; real-app 6.6 「快照照序 19」; e2e-chains 14.2): opening
 * 「给医生看」 keeps which day's brief it was, which version, that it was shown and when; the same version shown again
 * that day is one row; a later look at the kept page has the same numbers whatever he logged since.
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as briefPost } from "@/app/api/brief/route";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { getMemoryStore } from "@/lib/store/memory";
import { buildAccountBrief } from "@/lib/summary/account-brief";
import { briefVersion, isBriefSnapshotData, lastShownBrief, recordBriefShown, shownBrief, viewForSnapshot } from "@/lib/summary/brief-snapshot";
import { setTestClock } from "@/lib/time/now";

const store = getMemoryStore();
let him: TestAccount;

function req(token: string | null, body: unknown, query = ""): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.cookie = `rp_at=${token}`;
  return new NextRequest(`http://localhost/api/brief${query}`, { method: "POST", headers, body: JSON.stringify(body) });
}

const clock = (iso: string) => setTestClock({ at: iso, frozen: true });
const scope = async () => (await store.getSession(him.userId))!;

beforeAll(async () => {
  clock("2026-10-12T07:00:00+08:00");
  him = await createAccountWithSpace(store, getAuthProvider(), { login: `s${randomUUID().slice(0, 10)}`, password: "a long test password", space: "example" });
});
afterAll(() => setTestClock(null));

describe("POST /api/brief { shown: 'doctor' }", () => {
  it("nothing is kept until he opens 「给医生看」; then one row: the day, the doctor, the version, both pages, shown_at", async () => {
    clock("2026-10-12T10:05:00+08:00");
    expect(await store.listBriefSnapshots(him.userId)).toEqual([]);
    expect(await lastShownBrief(store, await scope())).toBeNull();

    const res = await briefPost(req(him.tokens.access_token, { shown: "doctor" }));
    expect(res.status).toBe(200);
    const { shown } = (await res.json()) as { shown: { id: string; date: string; version: string; shown_at: string; created: boolean } };
    expect(shown).toMatchObject({ date: "2026-10-12", shown_at: "2026-10-12T02:05:00.000Z", created: true });
    expect(shown.version).toMatch(/^[0-9a-f]{12}$/);

    const rows = await store.listBriefSnapshots(him.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: shown.id, shown_at: "2026-10-12T02:05:00.000Z" });
    const data = rows[0].data;
    expect(isBriefSnapshotData(data)).toBe(true);
    if (!isBriefSnapshotData(data)) throw new Error("not a snapshot");
    expect(data).toMatchObject({ v: 1, kind: "account", date: "2026-10-12", to: "doctor", version: shown.version, window: { fromDate: "2026-09-09", toDate: "2026-10-12", lastVisitDate: "2026-09-08" } });
    // the two pages as the screen drew them: the same counts in both languages
    expect(data.views.en.doses).toMatchObject({ due: 34, taken: 29, missed: 4, unconfirmed: 1 });
    expect(data.views["zh-Hans"].doses).toEqual(data.views.en.doses);
    expect(data.views.en.bp).toMatchObject({ count: 10, avgSystolic: 140, avgDiastolic: 85 });
    expect(data.views.en.questions.shown.map((q) => q.id)).toEqual(["q-extra-tablet", "q-tai-chi", "q-knee-2"]);
    // no clip link is kept, and nothing names the scope
    expect(JSON.stringify(data)).not.toMatch(/clipUrl":"|\/api\/visits\//);
    expect(JSON.stringify(data)).not.toContain(him.userId);
  });

  it("the same brief shown again that day is the same row (shown_at moves); a brief that changed is a new version", async () => {
    clock("2026-10-12T10:20:00+08:00");
    const again = (await (await briefPost(req(him.tokens.access_token, { shown: "doctor" }))).json()).shown;
    expect(again.created).toBe(false);
    const rows = await store.listBriefSnapshots(him.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0].shown_at).toBe("2026-10-12T02:20:00.000Z");
    expect(again.id).toBe(rows[0].id);

    // he copies a reading from the monitor in the waiting room: the page is another page
    clock("2026-10-12T10:30:00+08:00");
    await store.addBp(him.userId, { day: 42, slot: "morning", systolic: 150, diastolic: 95 });
    const next = (await (await briefPost(req(him.tokens.access_token, { shown: "doctor" }))).json()).shown;
    expect(next.created).toBe(true);
    expect(next.version).not.toBe(again.version);
    expect(await store.listBriefSnapshots(him.userId)).toHaveLength(2);
  });

  it("a later look is the same page: the kept numbers do not follow what he logs afterwards", async () => {
    const s = await scope();
    const last = (await lastShownBrief(store, s))!;
    expect(last.data.views.en.bp.count).toBe(11);
    clock("2026-10-13T09:00:00+08:00");
    await store.addBp(him.userId, { day: 43, slot: "morning", systolic: 160, diastolic: 99 });
    const now = await buildAccountBrief(store, await scope(), "en", { translate: "cache" });
    expect(now.bp.count).toBe(12);
    const kept = (await shownBrief(store, await scope(), last.id))!;
    expect(kept.data.date).toBe("2026-10-12");
    expect(kept.data.views.en.bp.count).toBe(11);
    expect(kept.shownAt).toBe("2026-10-12T02:30:00.000Z");
    // another scope's id, or an id that is not there: nothing
    expect(await shownBrief(store, await scope(), "no-such")).toBeNull();
  });

  it("the version is the content's: the same pages give the same version whatever order their keys were built in", async () => {
    const s = await scope();
    const [en, zh] = await Promise.all([buildAccountBrief(store, s, "en", { translate: "cache" }), buildAccountBrief(store, s, "zh-Hans", { translate: "cache" })]);
    const a = briefVersion({ en: viewForSnapshot(en), "zh-Hans": viewForSnapshot(zh) });
    const shuffled = Object.fromEntries(Object.entries(viewForSnapshot(en)).reverse()) as typeof en;
    expect(briefVersion({ en: shuffled, "zh-Hans": viewForSnapshot(zh) })).toBe(a);
    expect(briefVersion({ en: { ...viewForSnapshot(en), date: "2026-10-14" }, "zh-Hans": viewForSnapshot(zh) })).not.toBe(a);
  });

  it("only his: a body that is not { shown: 'doctor' } is refused; the demo has none; no sign-in, nothing", async () => {
    expect((await briefPost(req(him.tokens.access_token, { shown: "family" }))).status).toBe(400);
    expect((await briefPost(req(him.tokens.access_token, {}))).status).toBe(400);
    expect((await briefPost(req(null, { shown: "doctor" }))).status).toBe(400);
    const demo = await store.createSession({ story_day: 41, story_time: "20:00", ttl_hours: 1 });
    expect((await briefPost(req(null, { shown: "doctor" }, `?session=${demo.id}`))).status).toBe(404);
    // recordBriefShown itself refuses a demo scope
    await expect(recordBriefShown(store, demo)).rejects.toThrow();
  });
});
