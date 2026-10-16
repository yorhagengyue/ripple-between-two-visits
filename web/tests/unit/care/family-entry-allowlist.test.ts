/**
 * Her way into his space (C2 track D; real-app 8.5 「单元 care/family-entry-allowlist」, 3.10 「她的入口」: 「一个单元测试逐个
 * 列出 app/api/** 的路由，没登记的路由带 link 也落不到他的范围；新加路由没登记，测试就红」).
 *
 * Two lists, and every route under app/api is checked against them, by reading it and by calling it:
 *
 *   FAMILY_ENTRY   the routes that accept ?link=<her care link> and then read his space through it (family mode). The
 *                  design names seven; the others are listed with the reason each is needed (web/progress/d.md has the
 *                  same lines).
 *   CARE_FLOW      the routes that touch a link row without entering his space: his own management of his links, and
 *                  her own actions on her own side (accepting, leaving, her account).
 *
 * Reading (static): a route whose source shows any way of taking her link (allowFamily in any form, the link query,
 * familySubject, a family-mode scoped store, the page helper that resolves a link) must be in FAMILY_ENTRY; a route
 * that imports the care flow or names a link method of the store must be in one of the two lists.
 *
 * Calling (behavioural): EVERY handler of EVERY route is called as her, with her active link in the query, in the body
 * and in the path's dynamic segments. Two things are watched while each handler runs:
 *   - whether a family-mode scoped store was made (the one door into his space: lib/subject/scoped-store.ts). Only a
 *     FAMILY_ENTRY route may make one, however it gets there: through a helper, an option passed along, or its own code.
 *   - every call to the process-wide store whose arguments or result name his space or her link. A route on neither
 *     list must make none.
 * And his records are counted before and after: nothing of his changes through a route that is not her entry.
 * A new route that reaches her link in any way, or a listed route that stops doing so, turns this red.
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { NextRequest } from "next/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { hashToken, newInviteToken } from "@/lib/care/tokens";
import { getMemoryStore } from "@/lib/store/memory";

/** Family-mode stores made while a handler runs (the mock below counts them; everything else is the real module). */
const watch = vi.hoisted(() => ({ familyStores: 0 }));
vi.mock("@/lib/subject/scoped-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/subject/scoped-store")>();
  return {
    ...actual,
    scopedStore: (...args: Parameters<typeof actual.scopedStore>) => {
      if (args[2] === "family") watch.familyStores += 1;
      return actual.scopedStore(...args);
    },
  };
});

const WEB = process.cwd();

/** Every route that accepts her link and reads his space through it, and why. The first seven are real-app 3.10's. */
const FAMILY_ENTRY: Record<string, string> = {
  "app/api/family/view/route.ts": "3.10: her home, only the sections he switched on",
  "app/api/family/alerts/route.ts": "3.10: the no-reply alerts sent to her link (his no_reply_alert switch)",
  "app/api/events/route.ts": "3.10: her live stream, filtered by his switches for her link; closes when her link ends",
  "app/api/reminders/route.ts": "3.10: her recordings, the list and registering a new one",
  "app/api/reminders/[id]/audio/route.ts": "3.10: playing a reminder recording back",
  "app/api/upload-url/route.ts": "3.10: the upload link for her reminder recording (kind reminder only)",
  "app/api/profile/facts/route.ts": "3.10: a fact she proposes, unconfirmed until he says yes (track C's route)",
  // ---- beyond the seven, each needed (web/progress/d.md 「入口名单」)
  "app/api/reminders/[id]/route.ts": "section 10 第三波必修 「她的录音能听回、能删、能重录」: deleting her own recording (checked against the stored row)",
  "app/api/reminders/[id]/use/route.ts": "the same line's 重录: going back to one of her own older recordings without recording it again",
  "app/api/family/week/route.ts": "「这一周」 day by day and the weeks before: the dose_summary section of family/view, paged, so her home stays one read",
  "app/api/family/shared/route.ts": "his visit records and notes, each only while its switch is on: the visit_transcripts and notes sections of family/view, read only when she opens them",
  "app/api/family/clip/route.ts": "the sound of one clinician's line he shares (visit_transcripts): a signed 10-minute link per play, never a path in the page",
  // C2 track I (only add): her tap on her own no-reply alert marks it opened (real-app 2.24 「她看到通知」), nothing else
  "app/api/push/opened/route.ts": "the opened mark on the no-reply alert sent to her link",
  // owner 10-14 (only add): a follow-up on her 「留意」 goes on his question list with one tap. The server builds the words
  // from his record (she sends an item's id, never text); his questions_count switch and his acknowledgement are checked
  "app/api/family/questions/route.ts": "a suggested question for his doctor, put on his list in her name (his questions_count switch; lib/care/family-questions.ts)",
  // owner 10-14 (only add): the long press of his side on hers too. She holds one of his records on her screen and
  // Ripple's read of it opens, through her link and cut by his switches line by line (lib/explain/evidence.ts; a type
  // whose switch is off is 404). The same route serves his own long press, without ?link=
  "app/api/explain/route.ts": "Ripple's read of one of his records she held (each line and source needs its switch; tests/unit/explain/family-viewer.test.ts)",
  "app/api/explain/add/route.ts": "「加入待问问题」 on that sheet: a question about the thing she held, worded by the server, in her name (his questions_count switch and his acknowledgement)",
  // scene 1 (owner 10-15, only add): his visit as it is recorded, on her phone. The state of one recording (whether it is
  // still recording, since when) and, only while his visit_transcripts switch is on and it records, the lines heard so
  // far and Ripple's live summary (lib/care/live-visit.ts); read only, her look logged
  "app/api/family/live/route.ts": "his visit as it is recorded: its state, and its lines and live summary while he shares his visit records (lib/care/live-visit.ts)",
};

/** Routes that touch a link row without entering his space through it, and why. */
const CARE_FLOW: Record<string, string> = {
  "app/api/family/invites/route.ts": "he invites (his own space)",
  "app/api/family/invites/[id]/route.ts": "he cancels an invitation nobody accepted",
  "app/api/family/invites/accept/route.ts": "she accepts as herself, before any link binds her (3.10 她自己的动作)",
  "app/api/family/links/route.ts": "each person's own links: his as the patient, hers as the family member",
  "app/api/family/links/[id]/access/route.ts": "he reads when she looked",
  "app/api/family/links/[id]/confirm/route.ts": "he confirms it is her",
  "app/api/family/links/[id]/grants/route.ts": "he changes the switches of one link",
  "app/api/family/links/[id]/revoke/route.ts": "he stops sharing",
  "app/api/family/links/[id]/leave/route.ts": "she leaves her own link (3.10 她自己的动作): no ?link=, never his space",
  // track A (found by the calls below when it was merged: the route file itself names no link)
  "app/api/family/links/[id]/reset-code/route.ts": "she gets the code that helps him reset his password (3.10 她自己的动作): her own link, no ?link=, never his space",
  "app/api/me/route.ts": "track A: a person's own account, with the links they are party to (her side: id, relation, his label, status)",
  "app/api/me/export/route.ts": "track H: a person's own export, with their own side of their links",
  // line bind (only add): binding by account and his 「知道了」; neither takes ?link=, neither enters his space through her link
  "app/api/family/bind/route.ts": "a family member types the elder's account, or he hers: the link is made as the signed-in person, on binding's own narrow store (lib/subject/bind.ts)",
  "app/api/family/bind/seen/route.ts": "he acknowledges a link a family member bound (his own space)",
  // the family texts asked again (owner 10-14, only add): each agrees to the text in force for their own link
  "app/api/family/links/[id]/agree/route.ts": "each of the two agrees to the family text in force for their own link (his record from his own space, hers on her own side): no ?link=, never his space through her link",
};

/** Any way a route's source can take her link. */
const FAMILY_MARKS: [string, RegExp][] = [
  ["allowFamily", /allowFamily/],
  ["the link query", /LINK_QUERY|queryLink|searchParams\.get\(\s*["'`]link["'`]\s*\)/],
  ["familySubject", /familySubject\s*\(/],
  ["a family-mode scoped store", /scopedStore\s*\([^)]*["'`]family["'`]/],
  ["the page helper with a link", /getPageSubject\s*\(\s*[^)\s]/],
  ["herOf", /\bherOf\s*\(/],
];
/** Any way a route's source can reach a link row. */
const CARE_MARKS: [string, RegExp][] = [
  ["the care flow", /from\s+["']@\/lib\/care\//],
  ["the care flow's store", /from\s+["']@\/lib\/subject\/care["']|careEntryStore/],
  ["a link method of the store", /\b(getCareLink|listCareLinks|createInvite|acceptInvite|confirmLink|revokeLink|listGrantHistory|expireInvites)\s*\(/],
];

function routes(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...routes(p));
    else if (name === "route.ts") out.push(path.relative(WEB, p).split(path.sep).join("/"));
  }
  return out.sort();
}
const ALL = routes(path.join(WEB, "app", "api"));
const source = (r: string) => readFileSync(path.join(WEB, r), "utf8");
const marksIn = (r: string, marks: [string, RegExp][]) => marks.filter(([, re]) => re.test(source(r))).map(([name]) => name);

describe("only the listed routes accept her link (reading every route)", () => {
  it("the lists name routes that exist, and no route is on both", () => {
    expect(ALL.length).toBeGreaterThan(100);
    for (const r of [...Object.keys(FAMILY_ENTRY), ...Object.keys(CARE_FLOW)]) expect(ALL, r).toContain(r);
    expect(Object.keys(FAMILY_ENTRY).filter((r) => r in CARE_FLOW)).toEqual([]);
    expect(Object.keys(FAMILY_ENTRY)).toHaveLength(17);
  });

  it("a route that shows any way of taking her link is a listed entry, and every listed entry shows one", () => {
    const taking = ALL.filter((r) => marksIn(r, FAMILY_MARKS).length > 0);
    expect(taking).toEqual(Object.keys(FAMILY_ENTRY).sort());
  });

  it("a route that reaches a link row in any way is on one of the two lists", () => {
    const reaching = ALL.filter((r) => marksIn(r, CARE_MARKS).length > 0);
    const unlisted = reaching.filter((r) => !(r in FAMILY_ENTRY) && !(r in CARE_FLOW)).map((r) => `${r}: ${marksIn(r, CARE_MARKS).join(", ")}`);
    expect(unlisted).toEqual([]);
  });

  it("the marks catch the ways around the literal `allowFamily: true`", () => {
    const hit = (src: string) => FAMILY_MARKS.filter(([, re]) => re.test(src)).map(([n]) => n);
    expect(hit("const opts = { allowFamily }; await requireSubject(req, opts);")).toContain("allowFamily");
    expect(hit("await requireSubject(req, { allowFamily: !!link });")).toContain("allowFamily");
    expect(hit('const link = req.nextUrl.searchParams.get("link");')).toContain("the link query");
    expect(hit("const id = req.nextUrl.searchParams.get(LINK_QUERY);")).toContain("the link query");
    expect(hit("const s = familySubject(base, scope, userId, link);")).toContain("familySubject");
    expect(hit('scopedStore(base, scope, "family", { userId, linkId })')).toContain("a family-mode scoped store");
    expect(hit("const ctx = await getPageSubject(linkId);")).toContain("the page helper with a link");
    expect(hit("const ctx = await getPageSubject();")).toEqual([]);
    expect(hit("const found = await requireSubject(req);")).toEqual([]);
  });
});

// ------------------------------------------------------------------ calling every route

const store = getMemoryStore();
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
type Handler = (req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response> | Response;

/** Calls to the process-wide store while a handler runs: method names whose arguments or result name him or her link. */
const seen: { needles: string[]; hits: string[]; on: boolean } = { needles: [], hits: [], on: false };
function names(value: unknown): boolean {
  if (!seen.needles.length) return false;
  let text: string;
  try {
    text = typeof value === "string" ? value : (JSON.stringify(value) ?? "");
  } catch {
    return false;
  }
  return seen.needles.some((n) => text.includes(n));
}
function instrument(): void {
  const proto = Object.getPrototypeOf(store) as Record<string, unknown>;
  for (const name of Object.getOwnPropertyNames(proto)) {
    const original = proto[name];
    if (name === "constructor" || typeof original !== "function") continue;
    (store as unknown as Record<string, unknown>)[name] = function (this: unknown, ...args: unknown[]) {
      const out = (original as (...a: unknown[]) => unknown).apply(store, args);
      if (!seen.on) return out;
      if (names(args)) seen.hits.push(name);
      else if (out instanceof Promise) void out.then((v) => void (names(v) && seen.hits.push(name))).catch(() => undefined);
      else if (names(out)) seen.hits.push(name);
      return out;
    };
  }
}

/** Run something on the store without it counting as a route's call. */
async function quietly<T>(fn: () => Promise<T>): Promise<T> {
  const was = seen.on;
  seen.on = false;
  try {
    return await fn();
  } finally {
    seen.on = was;
  }
}

const PASSWORD = "a long test password";
const id = () => `x${randomUUID().replace(/-/g, "").slice(0, 10)}`;
let him: TestAccount;
let her: TestAccount;
let herToken = "";
let linkId = "";

/** set while her entries are called with a link that is on purpose not active: `ready` then leaves the link alone */
let keepLink = false;

/** A fresh link between them (the store's own steps: invite, accept, and his confirm unless told not to), every switch on. */
async function relink(opts: { confirm?: boolean } = {}): Promise<void> {
  const t = newInviteToken();
  const made = await store.createInvite({ id: t.linkId, patient_id: him.userId, family_label: "Wei Ling", relation: "daughter", patient_label: "爸爸", invite_token_hash: hashToken(t.token), invite_expires_at: new Date(Date.now() + 3600_000).toISOString() }, {});
  if (!made.ok) throw new Error(made.code);
  const accepted = await store.acceptInvite(hashToken(t.token), her.userId);
  if (!accepted.ok) throw new Error(accepted.code);
  if (opts.confirm !== false) {
    const confirmed = await store.confirmLink(t.linkId, him.userId, true);
    if (!confirmed.ok) throw new Error(confirmed.code);
  }
  await store.setFamilyGrant(him.userId, t.linkId, { dose_summary: true, bp_summary: true, questions_count: true, no_reply_alert: true, visit_transcripts: true, notes: true });
  linkId = t.linkId;
  seen.needles = [him.userId, linkId];
}

/** Her sign-in and her link, as good as new before each call (a route may have signed her out or ended the link). */
async function ready(): Promise<void> {
  await quietly(async () => {
    const auth = getAuthProvider();
    const alive = herToken && (await store.getCareLink(linkId))?.status === "active";
    const session = herToken ? await auth.signInWithPassword(her.login.email, PASSWORD).catch(() => null) : null;
    if (!herToken || !session) herToken = (await auth.signInWithPassword(her.login.email, PASSWORD)).access_token;
    else herToken = session.access_token;
    if (!alive && !keepLink) await relink();
  });
}

/** His records, counted (nothing she does through a route that is not her entry may change them). */
async function hisRecords(): Promise<Record<string, number>> {
  return quietly(async () => {
    const sid = him.userId;
    return {
      doses: (await store.listDoses(sid)).length,
      bp: (await store.listBp(sid)).length,
      notes: (await store.listNotes(sid)).length,
      questions: (await store.listQuestions(sid)).length,
      visits: (await store.listVisits(sid)).length,
      meds: (await store.listMeds(sid)).length,
      facts: (await store.listProfileFacts(sid)).length,
      clips: (await store.listReminderClips(sid)).length,
      access: (await store.listCareAccessLog(sid)).length,
      deliveries: (await store.listDeliveries(sid)).length,
      consents: (await store.listConsentRecords(him.userId)).length,
      events: (await store.listAccountEvents(him.userId)).length,
    };
  });
}

interface Call {
  route: string;
  method: string;
  status: number;
  familyStores: number;
  hits: string[];
}

/** One handler, called as her with her link wherever a request can carry it. */
async function callAsHer(route: string, method: (typeof METHODS)[number], handler: Handler): Promise<Call> {
  await ready();
  const segments = route.replace(/^app/, "").replace(/\/route\.ts$/, "").split("/");
  const params: Record<string, string> = {};
  const url = segments
    .map((s) => {
      const m = /^\[(?:\.\.\.)?(\w+)\]$/.exec(s);
      if (!m) return s;
      params[m[1]] = linkId;
      return encodeURIComponent(linkId);
    })
    .join("/");
  const withBody = method !== "GET";
  const req = new NextRequest(`http://localhost${url}?link=${encodeURIComponent(linkId)}&link_id=${encodeURIComponent(linkId)}&ms=0`, {
    method,
    headers: { cookie: `rp_at=${herToken}`, ...(withBody ? { "content-type": "application/json" } : {}) },
    body: withBody ? JSON.stringify({ link: linkId, link_id: linkId, linkId }) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  watch.familyStores = 0;
  seen.hits = [];
  seen.on = true;
  let status = 0;
  try {
    const res = await Promise.race([Promise.resolve(handler(req, { params: Promise.resolve(params) })), new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000))]);
    status = res ? res.status : -1;
    // a stream is closed, a body is read: what the handler does after answering still counts
    if (res?.body) await res.body.cancel().catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));
  } catch {
    status = 500;
  } finally {
    seen.on = false;
  }
  return { route, method, status, familyStores: watch.familyStores, hits: [...new Set(seen.hits)] };
}

describe("only the listed routes accept her link (calling every handler of every route as her)", () => {
  const calls: Call[] = [];
  /** her entries called again with a link he has not confirmed yet, and with one he stopped */
  const notYet: Call[] = [];
  const stopped: Call[] = [];
  let before: Record<string, number>;
  let afterOthers: Record<string, number>;

  beforeAll(async () => {
    process.env.BLOB_LOCAL_DIR = mkdtempSync(path.join(tmpdir(), "ripple-entry-"));
    delete process.env.BLOB_DRIVER;
    him = await createAccountWithSpace(store, getAuthProvider(), { login: id(), password: PASSWORD, space: "example" });
    her = await createAccountWithSpace(store, getAuthProvider(), { login: id(), password: PASSWORD, space: "none" });
    herToken = her.tokens.access_token;
    await relink();
    instrument();
    before = await hisRecords();
    // first every route that is not her entry, then the count of his records, then her entries
    const order = [...ALL.filter((r) => !(r in FAMILY_ENTRY)), ...ALL.filter((r) => r in FAMILY_ENTRY)];
    let counted = false;
    for (const route of order) {
      if (route in FAMILY_ENTRY && !counted) {
        afterOthers = await hisRecords();
        counted = true;
      }
      const mod = (await import(/* @vite-ignore */ pathToFileURL(path.join(WEB, route)).href)) as Record<string, unknown>;
      for (const method of METHODS) {
        const handler = mod[method];
        if (typeof handler === "function") calls.push(await callAsHer(route, method, handler as Handler));
      }
    }
    // real-app 2.20: 「他确认那一下之前，她什么都看不到」, and 2.22: 之后的请求一律 403. Her entries again, with her link
    // accepted but not confirmed, then with a link he stopped: `ready` is told to leave the link as it is.
    for (const [state, into] of [["accepted", notYet], ["revoked", stopped]] as const) {
      await quietly(async () => {
        // one open link between two people at a time: the one before ends first
        await store.revokeLink(linkId, him.userId, "patient");
        await relink({ confirm: state !== "accepted" });
        if (state === "revoked") await store.revokeLink(linkId, him.userId, "patient");
      });
      keepLink = true;
      for (const route of Object.keys(FAMILY_ENTRY)) {
        const mod = (await import(/* @vite-ignore */ pathToFileURL(path.join(WEB, route)).href)) as Record<string, unknown>;
        for (const method of METHODS) {
          const handler = mod[method];
          if (typeof handler === "function") into.push(await callAsHer(route, method, handler as Handler));
        }
      }
      keepLink = false;
    }
  }, 240_000);

  it("every route was called, each of its handlers once", () => {
    expect(new Set(calls.map((c) => c.route)).size).toBe(ALL.length);
    expect(calls.length).toBeGreaterThan(ALL.length);
    // nothing hung: a handler that did not answer in time would hide what it does
    expect(calls.filter((c) => c.status === -1).map((c) => `${c.method} ${c.route}`)).toEqual([]);
  });

  it("no route outside her entries ever gets a family-mode store, however it is written", () => {
    const entered = calls.filter((c) => !(c.route in FAMILY_ENTRY) && c.familyStores > 0).map((c) => `${c.method} ${c.route}`);
    expect(entered).toEqual([]);
  });

  it("a route on neither list never touches her link or his space in the store", () => {
    const touched = calls.filter((c) => !(c.route in FAMILY_ENTRY) && !(c.route in CARE_FLOW) && c.hits.length > 0).map((c) => `${c.method} ${c.route}: ${c.hits.join(", ")}`);
    expect(touched).toEqual([]);
  });

  it("routes that only work on her own space answer 404 no_profile or refuse; none of them answers 200 with his data", () => {
    // she has no space of her own: a 2xx from a route on neither list can only be about her own account or the demo
    const ok = calls.filter((c) => !(c.route in FAMILY_ENTRY) && !(c.route in CARE_FLOW) && c.status >= 200 && c.status < 300 && c.hits.length > 0);
    expect(ok).toEqual([]);
  });

  it("his records are the same after all of that", () => {
    expect(afterOthers).toEqual(before);
  });

  it("each of her entries does take her link (the watch sees a family-mode store), so a listed route that stopped is noticed", () => {
    const quiet = Object.keys(FAMILY_ENTRY).filter((r) => !calls.some((c) => c.route === r && c.familyStores > 0));
    expect(quiet).toEqual([]);
  });

  it("her entries with a link he has not confirmed, or one he stopped: 403 link_not_active, no way in, on every one of them", () => {
    for (const [name, list] of [["not confirmed", notYet], ["stopped", stopped]] as const) {
      expect(new Set(list.map((c) => c.route)).size, name).toBe(Object.keys(FAMILY_ENTRY).length);
      expect(list.filter((c) => c.familyStores > 0).map((c) => `${c.method} ${c.route}`), name).toEqual([]);
      expect(list.filter((c) => c.status !== 403).map((c) => `${c.status} ${c.method} ${c.route}`), name).toEqual([]);
    }
  });

  it("the care flow's routes are really reached (the watch sees the link), so the second list holds nothing stale", () => {
    const stale = Object.keys(CARE_FLOW).filter((r) => !calls.some((c) => c.route === r && c.hits.length > 0) && marksIn(r, CARE_MARKS).length === 0);
    expect(stale).toEqual([]);
  });
});
