/**
 * Her own account's screens once her link has ended (the fe-d2 follow-up; lib/care/her-page.ts herOwnPage). 「我的」 and
 * the three screens under it (a new password, her devices, a new recovery code) used to open through a link in force
 * only, so after he stopped sharing, she left, or he said it was not her, she could not reach them. Checked here, with
 * the link in the address not opening as a page subject (it is not active), on links made through the real routes:
 *   - a link of hers that is revoked, left or declined: the screens open, `ended` says how, and the paths keep the link
 *     (the way back is /f?link=, which says what happened)
 *   - everything else is as herPage has it, back to /f: no link named, a link that is not hers, one still waiting for
 *     him, an active one that did not open, one whose row went with his account, nobody signed in
 *   - an account with a space of its own goes to its own 「我」
 *   - /f itself hands 「我的」 to the three ended screens, and not to the screens that have no link to name
 */
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import type { ReactElement } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getMemoryStore } from "@/lib/store/memory";

const page = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/session/server", () => ({ getPatientLocale: async () => "zh-Hans" }));
vi.mock("@/lib/subject", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/subject")>()),
  // the link in the address is not in force (or there is none): no page subject
  getPageSubject: async () => null,
}));
vi.mock("@/lib/subject/care", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/subject/care")>()),
  getPageUser: async () => page.user,
}));
import FamilyPage from "@/app/f/page";
import { POST as acceptPost } from "@/app/api/family/invites/accept/route";
import { POST as invitePost } from "@/app/api/family/invites/route";
import { POST as confirmPost } from "@/app/api/family/links/[id]/confirm/route";
import { POST as leavePost } from "@/app/api/family/links/[id]/leave/route";
import { POST as revokePost } from "@/app/api/family/links/[id]/revoke/route";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { createLocalBlobStore, type LocalBlobStore } from "@/lib/blob";
import { herOwnPage, type HerOwnPage } from "@/lib/care/her-page";
import { deleteAccountEverywhere } from "@/lib/privacy/delete";
import { careEntryStore } from "@/lib/subject/care";
import { scopedStore, selfSubject } from "@/lib/subject";

const store = getMemoryStore();
const PASSWORD = "a long test password";
let dir: string;
let blob: LocalBlobStore;
const savedEnv = { ...process.env };

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "ripple-d-own-"));
  process.env.BLOB_LOCAL_DIR = dir;
  delete process.env.BLOB_DRIVER;
  blob = createLocalBlobStore({ dir });
});
afterAll(async () => {
  process.env = savedEnv;
  await rm(dir, { recursive: true, force: true });
});

const login = (p: string) => `${p}${randomUUID().replace(/-/g, "").slice(0, 10)}`;
const account = (space: "blank" | "none", display: string): Promise<TestAccount> => createAccountWithSpace(store, getAuthProvider(), { login: login(space === "none" ? "w" : "t"), password: PASSWORD, space, display_name: display });
const t = (a: TestAccount) => a.tokens.access_token;
const params = (id: string) => ({ params: Promise.resolve({ id }) });
function req(p: string, token: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost${p}`, { method: "POST", headers: { cookie: `rp_at=${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
}

/** His invitation and her acceptance through the real routes; `confirm`: what he answers (null: he has not yet). */
async function linked(him: TestAccount, her: TestAccount, confirm: boolean | null = true): Promise<string> {
  const res = await invitePost(req("/api/family/invites", t(him), { family_label: "Wei Ling", relation: "daughter", patient_label: "爸爸" }));
  const body = (await res.json()) as { link: { id: string }; path: string };
  expect((await acceptPost(req("/api/family/invites/accept", t(her), { token: body.path.replace(/^\/invite\//, "") }))).status).toBe(200);
  if (confirm !== null) expect((await confirmPost(req(`/api/family/links/${body.link.id}/confirm`, t(him), { yes: confirm }), params(body.link.id))).status).toBe(200);
  return body.link.id;
}

const stop = async (him: TestAccount, id: string) => expect((await revokePost(req(`/api/family/links/${id}/revoke`, t(him), {}), params(id))).status).toBe(200);
const leave = async (her: TestAccount, id: string) => expect((await leavePost(req(`/api/family/links/${id}/leave`, t(her), {}), params(id))).status).toBe(200);

/** The signed-in person as a page gets them (lib/subject/care.ts getPageUser): hers has no space, his is bound to his own. */
async function signIn(who: TestAccount | null): Promise<void> {
  if (!who) {
    page.user = null;
    return;
  }
  const row = await store.getSession(who.userId);
  const user = { userId: who.userId, sessionId: row?.id ?? null, account: (await store.getAccount(who.userId))! };
  page.user = row ? { user, scope: row, store: selfSubject(store, row, who.userId).store } : { user, scope: null, store: scopedStore(store, { id: `no-scope:${who.userId}` }, "self", { userId: who.userId, maskSessionId: true }) };
}

/** Where a page start sends her, or what it hands the page. */
async function start(who: TestAccount | null, link?: string, pathName = "/f/me"): Promise<{ redirect: string } | HerOwnPage> {
  await signIn(who);
  try {
    return await herOwnPage(link ? { link } : {}, pathName);
  } catch (err) {
    const digest = String((err as { digest?: unknown }).digest ?? "");
    if (digest.startsWith("NEXT_REDIRECT;")) return { redirect: digest.split(";")[2] ?? "" };
    throw err;
  } finally {
    page.user = null;
  }
}

/** /f for her: which screen, and where its 「我的」 leads (undefined: the screen has none). */
async function home(who: TestAccount, link?: string): Promise<{ state: string; meHref: string | undefined }> {
  await signIn(who);
  try {
    const el = (await FamilyPage({ searchParams: Promise.resolve(link ? { link } : {}), params: Promise.resolve({}) } as never)) as ReactElement<{ testState?: string; meHref?: string }>;
    return { state: String(el.props.testState ?? ""), meHref: el.props.meHref };
  } finally {
    page.user = null;
  }
}

describe("her own account's screens after her link has ended", () => {
  it("he stopped sharing, she left, he said it was not her: the screens open with `ended`, and the paths keep the link", async () => {
    const him = await account("blank", "陈先生");
    for (const [how, state] of [
      ["stop", "revoked"],
      ["leave", "left"],
      ["no", "declined"],
    ] as const) {
      const her = await account("none", "Wei Ling");
      const id = await linked(him, her, how === "no" ? false : true);
      if (how === "stop") await stop(him, id);
      if (how === "leave") await leave(her, id);
      const q = `link=${id}`;
      for (const pathName of ["/f/me", "/f/me/password", "/f/me/devices", "/f/me/recovery"]) {
        const p = await start(her, id, pathName);
        expect(p, `${how} ${pathName}`).toMatchObject({ active: null, ended: state, locale: "zh-Hans", dad: "爸爸" });
        expect((p as HerOwnPage).paths).toMatchObject({ home: `/f?${q}`, me: `/f/me?${q}`, password: `/f/me/password?${q}`, devices: `/f/me/devices?${q}`, recovery: `/f/me/recovery?${q}`, remove: `/f/me/delete?${q}` });
        // the language switch comes back to the same screen
        expect((p as HerOwnPage).langHref).toBe(`/api/profile/lang?to=en&next=${encodeURIComponent(`${pathName}?${q}`)}`);
      }
      // and the screen that says so leads there
      expect(await home(her, id)).toEqual({ state: state === "revoked" ? "ended" : state, meHref: `/f/me?${q}` });
    }
  });

  it("everything else goes back to /f, as before", async () => {
    const him = await account("blank", "陈先生");
    const her = await account("none", "Wei Ling");
    // no link named; a link that is not hers
    expect(await start(her)).toEqual({ redirect: "/f" });
    const other = await account("none", "Mei");
    const theirs = await linked(him, other);
    await stop(him, theirs);
    expect(await start(her, theirs)).toEqual({ redirect: `/f?link=${theirs}` });
    // one still waiting for him; an active one whose page subject did not open (the mock: a race with his change)
    const waiting = await linked(him, her, null);
    expect(await start(her, waiting)).toEqual({ redirect: `/f?link=${waiting}` });
    expect((await confirmPost(req(`/api/family/links/${waiting}/confirm`, t(him), { yes: true }), params(waiting))).status).toBe(200);
    expect(await start(her, waiting, "/f/me/password")).toEqual({ redirect: `/f?link=${waiting}` });
    // nobody signed in (the proxy sends her to the login before any page; a page with no proxy in front goes to /f)
    await stop(him, waiting);
    expect(await start(null, waiting)).toEqual({ redirect: `/f?link=${waiting}` });
    // the screens that have no link to name keep no 「我的」
    const stranger = await account("none", "Someone");
    expect(await home(stranger)).toEqual({ state: "no_link", meHref: undefined });
  });

  it("his account is deleted: the link's row is gone, so its address opens nothing of hers but /f, which says so without 「我的」", async () => {
    const him = await account("blank", "陈先生");
    const her = await account("none", "Wei Ling");
    const id = await linked(him, her);
    expect((await deleteAccountEverywhere({ store, auth: getAuthProvider(), blob, care: careEntryStore(store) }, him.userId, { reason: "user" })).ok).toBe(true);
    expect(await start(her, id)).toEqual({ redirect: `/f?link=${id}` });
    expect(await home(her, id)).toEqual({ state: "gone", meHref: undefined });
    expect(await home(her)).toEqual({ state: "gone", meHref: undefined });
  });

  it("an account with a space of its own goes to its own 「我」", async () => {
    const him = await account("blank", "陈先生");
    const her = await account("blank", "Wei Ling");
    const id = await linked(him, her);
    await stop(him, id);
    expect(await start(her, id)).toEqual({ redirect: "/p/me" });
    expect(await start(her, id, "/f/me/devices")).toEqual({ redirect: "/p/me" });
  });
});
