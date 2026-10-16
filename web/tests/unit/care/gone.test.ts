/**
 * 「这个联系已经结束」 after his account is deleted (C2 track D, round two; real-app 3.11 删除账号 step 5: 「她那边：链接没了，
 * 她的 /f 显示『这个联系已经结束』」). Track H reported that her page said 「你还没有在看谁的 Ripple」 instead. Run against
 * H's real deletion (lib/privacy/delete.ts deleteAccountEverywhere) on the memory store:
 *   - while her page is open: the closing frame on her stream says by "gone" (not that he stopped sharing)
 *   - afterwards the link row is gone with him; her requests through it answer 404
 *   - her page, rendered as the server component: with the old link in the address, and with no link at all (she
 *     opened Ripple from her home screen), both say the connection has ended. What still says she followed someone is
 *     her own family_accept record (lib/care/links.ts vanishedLinks)
 *   - someone who never followed anyone still gets 「你还没有在看谁的 Ripple」; someone who left by herself too
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
  // her account has no space, and a link that is gone resolves to nothing: the page gets no subject
  getPageSubject: async () => null,
}));
vi.mock("@/lib/subject/care", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/subject/care")>()),
  getPageUser: async () => page.user,
}));
import FamilyPage from "@/app/f/page";
import { GET as eventsGet } from "@/app/api/events/route";
import { POST as acceptPost } from "@/app/api/family/invites/accept/route";
import { POST as invitePost } from "@/app/api/family/invites/route";
import { POST as confirmPost } from "@/app/api/family/links/[id]/confirm/route";
import { POST as leavePost } from "@/app/api/family/links/[id]/leave/route";
import { GET as linksGet } from "@/app/api/family/links/route";
import { GET as viewGet } from "@/app/api/family/view/route";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { createLocalBlobStore, type LocalBlobStore } from "@/lib/blob";
import { familyLinks, vanishedLinks } from "@/lib/care/links";
import { deleteAccountEverywhere } from "@/lib/privacy/delete";
import { careEntryStore } from "@/lib/subject/care";
import { scopedStore } from "@/lib/subject/scoped-store";

const store = getMemoryStore();
const PASSWORD = "a long test password";
const decoder = new TextDecoder();
let dir: string;
let blob: LocalBlobStore;
const savedEnv = { ...process.env };

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "ripple-d-gone-"));
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
function req(p: string, opts: { token?: string; body?: unknown; signal?: AbortSignal } = {}): NextRequest {
  const headers: Record<string, string> = opts.token ? { cookie: `rp_at=${opts.token}` } : {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(`http://localhost${p}`, { method: opts.body === undefined ? "GET" : "POST", headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body), signal: opts.signal });
}

/** Linked through the real routes, so her family_accept record is the one the app writes. */
async function linked(him: TestAccount, her: TestAccount): Promise<string> {
  const res = await invitePost(req("/api/family/invites", { token: t(him), body: { family_label: "Wei Ling", relation: "daughter", patient_label: "爸爸" } }));
  const body = (await res.json()) as { link: { id: string }; path: string };
  expect((await acceptPost(req("/api/family/invites/accept", { token: t(her), body: { token: body.path.replace(/^\/invite\//, "") } }))).status).toBe(200);
  expect((await confirmPost(req(`/api/family/links/${body.link.id}/confirm`, { token: t(him), body: { yes: true } }), params(body.link.id))).status).toBe(200);
  return body.link.id;
}

const deleteHim = (him: TestAccount) => deleteAccountEverywhere({ store, auth: getAuthProvider(), blob, care: careEntryStore(store) }, him.userId, { reason: "user" });

/** Her page as the server component gives it: which screen, and its sentence. */
async function herPage(her: TestAccount, link?: string): Promise<{ state: string; title: string; redirect?: string }> {
  const account = (await store.getAccount(her.userId))!;
  page.user = { user: { userId: her.userId, sessionId: null, account }, scope: null, store: scopedStore(store, { id: `no-scope:${her.userId}` }, "self", { userId: her.userId, maskSessionId: true }) };
  try {
    const el = (await FamilyPage({ searchParams: Promise.resolve(link ? { link } : {}), params: Promise.resolve({}) } as never)) as ReactElement<{ testState?: string; title?: string; "data-state"?: string }>;
    return { state: String(el.props.testState ?? el.props["data-state"] ?? ""), title: String(el.props.title ?? "") };
  } catch (err) {
    const digest = String((err as { digest?: unknown }).digest ?? "");
    if (digest.startsWith("NEXT_REDIRECT;")) return { state: "redirect", title: "", redirect: digest.split(";")[2] ?? "" };
    throw err;
  } finally {
    page.user = null;
  }
}

async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, needle: string): Promise<string> {
  let text = "";
  for (let i = 0; i < 50 && !text.includes(needle); i++) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value);
  }
  return text;
}

describe("his account is deleted while she follows him", () => {
  it("her open stream ends with by: gone; afterwards the link row is gone and her requests answer 404", async () => {
    const him = await account("blank", "陈先生");
    const her = await account("none", "Wei Ling");
    const id = await linked(him, her);
    const abort = new AbortController();
    const res = await eventsGet(req(`/api/events?link=${id}`, { token: t(her), signal: abort.signal }));
    const reader = res.body!.getReader();
    await readUntil(reader, "connected");

    const r = await deleteHim(him);
    expect(r).toMatchObject({ ok: true, counts: { links_revoked: 1 } });

    const text = await readUntil(reader, "care_link.revoked");
    const frame = text.split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6))).find((e) => e.type === "care_link.revoked");
    expect(frame.data).toEqual({ link: { id, status: "revoked", by: "gone" } });
    expect((await reader.read()).done).toBe(true);
    abort.abort();

    expect(await store.getCareLink(id)).toBeNull();
    const view = await viewGet(req(`/api/family/view?link=${id}`, { token: t(her) }));
    expect(view.status).toBe(404);
    expect(await view.json()).toEqual({ error: "link_not_found" });
    expect(((await (await linksGet(req("/api/family/links", { token: t(her) }))).json()) as { family: unknown[] }).family).toEqual([]);
  });

  it("her /f says 「这个联系已经结束。」 with the old link in the address and with none; before the deletion it does not", async () => {
    const him = await account("blank", "陈先生");
    const her = await account("none", "Wei Ling");
    const id = await linked(him, her);
    const own = scopedStore(store, { id: `no-scope:${her.userId}` }, "self", { userId: her.userId, maskSessionId: true });
    expect(await vanishedLinks(own, her.userId, await familyLinks(own, her.userId, Date.now()))).toEqual([]);
    // with her link alive and no link in the address, /f sends her to it
    expect(await herPage(her)).toMatchObject({ state: "redirect", redirect: `/f?link=${id}` });

    expect((await deleteHim(him)).ok).toBe(true);

    expect(await familyLinks(own, her.userId, Date.now())).toEqual([]);
    expect(await vanishedLinks(own, her.userId, [])).toEqual([id]);
    // what track H saw: she opens Ripple with no link in the address and it was her only link
    expect(await herPage(her)).toEqual({ state: "gone", title: "这个联系已经结束。" });
    expect(await herPage(her, id)).toEqual({ state: "gone", title: "这个联系已经结束。" });
  });

  it("someone who never followed anyone, and someone who left by herself, are not told a connection ended", async () => {
    const stranger = await account("none", "Someone");
    expect(await herPage(stranger)).toEqual({ state: "no_link", title: "你还没有在看谁的 Ripple。" });

    const him = await account("blank", "陈先生");
    const her = await account("none", "Wei Ling");
    const id = await linked(him, her);
    expect((await leavePost(req(`/api/family/links/${id}/leave`, { token: t(her), body: {} }), params(id))).status).toBe(200);
    expect((await herPage(her, id)).state).toBe("left");
    expect((await deleteHim(him)).ok).toBe(true);
    const own = scopedStore(store, { id: `no-scope:${her.userId}` }, "self", { userId: her.userId, maskSessionId: true });
    expect(await vanishedLinks(own, her.userId, [])).toEqual([]);
    expect((await herPage(her)).state).toBe("no_link");
  });

  it("he only stopped sharing: the row stays, her page says he stopped, not that the connection ended", async () => {
    const him = await account("blank", "陈先生");
    const her = await account("none", "Wei Ling");
    const id = await linked(him, her);
    const { POST: revokePost } = await import("@/app/api/family/links/[id]/revoke/route");
    expect((await revokePost(req(`/api/family/links/${id}/revoke`, { token: t(him), body: {} }), params(id))).status).toBe(200);
    const own = scopedStore(store, { id: `no-scope:${her.userId}` }, "self", { userId: her.userId, maskSessionId: true });
    expect(await vanishedLinks(own, her.userId, await familyLinks(own, her.userId, Date.now()))).toEqual([]);
    expect((await herPage(her, id)).state).toBe("ended");
  });
});
