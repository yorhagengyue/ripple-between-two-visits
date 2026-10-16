/**
 * His question list (track C; journey 07 「他能自己加、改、跳过问题」, real-app 2.11, e2e-chains 序 2): add, edit, skip, put
 * back, merge duplicates; the list shows his own words and the clinicians' answers word for word with their time
 * point; nobody else acts on his list; no scope id and no day number in what the routes answer.
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeAll, describe, expect, it } from "vitest";
import { PATCH as questionPatch } from "@/app/api/questions/[id]/route";
import { GET as questionsGet, POST as questionsPost } from "@/app/api/questions/route";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { getBus } from "@/lib/bus";
import { addQuestionFor, changeQuestion, questionKey, questionList, QuestionInputError } from "@/lib/profile/questions";
import { MemoryStore, getMemoryStore } from "@/lib/store/memory";
import type { SessionRow } from "@/lib/store/types";
import { seedAccount } from "@/lib/story/example";
import { localDate, zonedTimeToUtcMs } from "@/lib/time/clock";

const store = getMemoryStore();
const PASSWORD = "a long test password";
let him: TestAccount;
let blank: TestAccount;

beforeAll(async () => {
  him = await createAccountWithSpace(store, getAuthProvider(), { login: `q${randomUUID().slice(0, 10)}`, password: PASSWORD, space: "example" });
  blank = await createAccountWithSpace(store, getAuthProvider(), { login: `b${randomUUID().slice(0, 10)}`, password: PASSWORD, space: "blank" });
});

function req(p: string, opts: { token?: string; body?: unknown; method?: string; cookies?: Record<string, string> } = {}): NextRequest {
  const jar = { ...(opts.cookies ?? {}), ...(opts.token ? { rp_at: opts.token } : {}) };
  const cookie = Object.entries(jar)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(`http://localhost${p}`, { method: opts.method ?? (opts.body === undefined ? "GET" : "POST"), headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

/** A fresh example account in its own store at a fixed moment (the lib functions, without routes). */
async function exampleAt(date = "2026-10-10", time = "10:00") {
  const t = zonedTimeToUtcMs(date, time);
  const s = new MemoryStore({ now: () => new Date(t) });
  const scope = await seedAccount(s, { userId: randomUUID(), space: "example", nowMs: t });
  return { store: s, scope };
}
const quiet = { publish: () => {} };

describe("addQuestionFor: the same words never make a second row", () => {
  it("a new question of his, then the same words again (any spacing, punctuation or width) merge into it", async () => {
    const { store: s, scope } = await exampleAt();
    const a = await addQuestionFor(s, scope, { text: "  我可以去游泳吗？ " }, quiet);
    expect(a.outcome).toBe("created");
    expect(a.question).toMatchObject({ for: "doctor", origin: "own", text: "我可以去游泳吗？", lang: "zh-Hans", status: "open", created_day: 42 });
    const again = await addQuestionFor(s, scope, { text: "我可以去游泳吗?" }, quiet);
    expect(again).toMatchObject({ outcome: "merged", question: { id: a.question.id } });
    // to the pharmacist it is another question
    expect((await addQuestionFor(s, scope, { text: "我可以去游泳吗？", for: "pharmacist" }, quiet)).outcome).toBe("created");
    expect((await s.listQuestions(scope.id)).filter((q) => questionKey(q.text) === questionKey("我可以去游泳吗"))).toHaveLength(2);
  });

  it("the same words as one he set aside put it back; as one the doctor answered hand back the answer", async () => {
    const { store: s, scope } = await exampleAt();
    const a = await addQuestionFor(s, scope, { text: "Can I swim?" }, quiet);
    await changeQuestion(s, scope, a.question.id, { kind: "skip" }, quiet);
    const back = await addQuestionFor(s, scope, { text: "can i swim" }, quiet);
    expect(back).toMatchObject({ outcome: "reopened", question: { id: a.question.id, status: "open" } });
    // q-machine was answered by the doctor at the first visit
    const answered = await addQuestionFor(s, scope, { text: "家里那个机器是绑手腕的，可以用吗？" }, quiet);
    expect(answered).toMatchObject({ outcome: "answered", question: { id: "q-machine", status: "answered" } });
  });

  it("refuses empty or overlong words and origins that are Ripple's own", async () => {
    const { store: s, scope } = await exampleAt();
    await expect(addQuestionFor(s, scope, { text: "   " }, quiet)).rejects.toBeInstanceOf(QuestionInputError);
    await expect(addQuestionFor(s, scope, { text: "字".repeat(301) }, quiet)).rejects.toMatchObject({ code: "text_too_long" });
    await expect(addQuestionFor(s, scope, { text: "x", origin: "pattern" as never }, quiet)).rejects.toMatchObject({ code: "origin_not_addable" });
  });

  it("other modules add theirs the same way (prevention, watch) and the event says what happened", async () => {
    const { store: s, scope } = await exampleAt();
    const seen: string[] = [];
    const r = await addQuestionFor(s, scope, { text: "Should I get the flu jab this year?", origin: "preventive", evidence: "prevent:flu" }, { publish: (_sid, type) => void seen.push(type) });
    expect(r.question).toMatchObject({ origin: "preventive", evidence: "prevent:flu" });
    await addQuestionFor(s, scope, { text: "should i get the flu jab this year" }, { publish: (_sid, type) => void seen.push(type) });
    expect(seen).toEqual(["question.created", "question.updated"]);
  });
});

describe("changeQuestion: his words, set aside, put back, merged", () => {
  it("edit keeps his new words (edited_at), skip and put back, merge and undo", async () => {
    const { store: s, scope } = await exampleAt();
    const own = (await addQuestionFor(s, scope, { text: "膝盖止痛药可以每天吃吗" }, quiet)).question;
    const edited = await changeQuestion(s, scope, own.id, { kind: "edit", text: "膝盖痛的止痛药，可以每天吃吗？" }, { ...quiet, now: () => "2026-10-10T02:00:00.000Z" });
    expect(edited).toMatchObject({ ok: true, question: { text: "膝盖痛的止痛药，可以每天吃吗？", edited_at: "2026-10-10T02:00:00.000Z" } });

    const skipped = await changeQuestion(s, scope, own.id, { kind: "skip" }, quiet);
    expect(skipped).toMatchObject({ ok: true, question: { status: "skipped" } });
    expect(await changeQuestion(s, scope, own.id, { kind: "reopen" }, quiet)).toMatchObject({ ok: true, question: { status: "open" } });

    // q-knee-2 (his own, open) and his new one are about the same thing: he merges his new one into it
    const merged = await changeQuestion(s, scope, own.id, { kind: "merge", into: "q-knee-2" }, quiet);
    expect(merged).toMatchObject({ ok: true, question: { status: "skipped", merged_into: "q-knee-2" }, into: { id: "q-knee-2" } });
    const list = await questionList(s, (await s.getSession(scope.id)) as SessionRow, "zh-Hans");
    expect([...list.open, ...list.skipped].map((q) => q.id)).not.toContain(own.id);
    // a merged question cannot be edited or merged again; putting it back undoes the merge
    expect(await changeQuestion(s, scope, own.id, { kind: "skip" }, quiet)).toEqual({ ok: false, status: 409, error: "merged" });
    const undone = await changeQuestion(s, scope, own.id, { kind: "reopen" }, quiet);
    expect(undone.ok && undone.question.status).toBe("open");
    expect(undone.ok && undone.question.merged_into).toBeUndefined();
  });

  it("refuses what would misrepresent a record", async () => {
    const { store: s, scope } = await exampleAt();
    // the doctor's answer stays with the words he answered
    expect(await changeQuestion(s, scope, "q-machine", { kind: "edit", text: "something else" }, quiet)).toEqual({ ok: false, status: 409, error: "answered" });
    expect(await changeQuestion(s, scope, "q-machine", { kind: "skip" }, quiet)).toEqual({ ok: false, status: 409, error: "answered" });
    // a pattern question is worded from his log, not by him
    expect(await changeQuestion(s, scope, "q-tai-chi", { kind: "edit", text: "x" }, quiet)).toEqual({ ok: false, status: 409, error: "pattern_words" });
    // merging: not into itself, not across people, not into a missing or set-aside one
    expect(await changeQuestion(s, scope, "q-knee-2", { kind: "merge", into: "q-knee-2" }, quiet)).toEqual({ ok: false, status: 409, error: "same_question" });
    const ph = (await addQuestionFor(s, scope, { text: "Which painkiller is safe?", for: "pharmacist" }, quiet)).question;
    expect(await changeQuestion(s, scope, ph.id, { kind: "merge", into: "q-knee-2" }, quiet)).toEqual({ ok: false, status: 409, error: "other_person" });
    expect(await changeQuestion(s, scope, "q-knee-2", { kind: "merge", into: "nope" }, quiet)).toEqual({ ok: false, status: 404, error: "into_not_found" });
    expect(await changeQuestion(s, scope, "nope", { kind: "skip" }, quiet)).toEqual({ ok: false, status: 404, error: "not_found" });
  });
});

describe("questionList: what his page shows", () => {
  it("the example's list: still to ask first, the clinicians' answers word for word with date and time point", async () => {
    const { store: s, scope } = await exampleAt();
    const list = await questionList(s, scope, "zh-Hans");
    expect(list.open.map((q) => q.id)).toEqual(["q-extra-tablet", "q-tai-chi", "q-knee-2"]);
    expect(list.answered.map((q) => q.id)).toEqual(["q-machine", "q-knee-1", "q-relative-box"]);
    const knee = list.answered.find((q) => q.id === "q-knee-1")!;
    expect(knee.answer).toMatchObject({ text: "Which one? Bring it next time and show me. For now, try not to take it every day.", speaker: "doctor", inferred: false, visitId: "v2" });
    expect(knee.answer!.date).toBe(scope.d0 ? new Date(Date.parse(`${scope.d0}T00:00:00Z`) + 8 * 86_400_000).toISOString().slice(0, 10) : null);
    expect(knee.answer!.tStartMs).toBe(64246);
    expect(list.answered.find((q) => q.id === "q-relative-box")!.answer).toMatchObject({ speaker: "pharmacist", tStartMs: 8284 });
    // his own words; the hero question still the recorded summary until he asks it himself
    expect(list.open.find((q) => q.id === "q-knee-2")).toMatchObject({ wording: "own_words", text: "膝盖止痛药还可以吃吗？", canEdit: true });
    expect(list.open.find((q) => q.id === "q-extra-tablet")).toMatchObject({ wording: "recorded_summary", canEdit: true });
    expect(list.open.find((q) => q.id === "q-tai-chi")).toMatchObject({ wording: "pattern", canEdit: false });
    expect(list.counts).toEqual({ open: 3, doctor: 3, pharmacist: 0, answered: 3, skipped: 0 });
  });

  it("an edited summary shows his words; a second open question with the same words is marked as a duplicate", async () => {
    const { store: s, scope } = await exampleAt();
    await changeQuestion(s, scope, "q-extra-tablet", { kind: "edit", text: "血压高的时候可以多吃一粒吗？" }, quiet);
    // two rows with the same words (as the ask pipeline can leave behind): the later one offers to merge
    const dup = await s.addQuestion(scope.id, { for: "doctor", origin: "refused_question", text: "膝盖止痛药还可以吃吗?" });
    const list = await questionList(s, scope, "zh-Hans");
    expect(list.open.find((q) => q.id === "q-extra-tablet")).toMatchObject({ text: "血压高的时候可以多吃一粒吗？", wording: "own_words", edited: true, summary: null });
    expect(list.open.find((q) => q.id === dup.id)?.duplicateOf).toBe("q-knee-2");
    expect(list.open.find((q) => q.id === "q-knee-2")?.duplicateOf).toBeNull();
  });
});

describe("the routes", () => {
  it("he adds, edits, skips and merges through the API; the answers carry no scope id and no day number", async () => {
    const t = him.tokens.access_token;
    const add = await questionsPost(req("/api/questions", { token: t, body: { text: "我可以吃榴莲吗？" } }));
    expect(add.status).toBe(201);
    const added = (await add.json()) as { question: { id: string; created_date: string }; outcome: string };
    expect(added.outcome).toBe("created");
    expect(added.question.created_date).toBe(localDate(Date.now()));
    const same = await questionsPost(req("/api/questions", { token: t, body: { text: "我可以吃榴莲吗" } }));
    expect(same.status).toBe(200);
    expect(((await same.json()) as { outcome: string }).outcome).toBe("merged");

    const edit = await questionPatch(req(`/api/questions/${added.question.id}`, { token: t, method: "PATCH", body: { text: "我可以吃一点榴莲吗？" } }), params(added.question.id));
    expect(edit.status).toBe(200);
    const skip = await questionPatch(req(`/api/questions/${added.question.id}`, { token: t, method: "PATCH", body: { status: "skipped" } }), params(added.question.id));
    expect(((await skip.json()) as { question: { status: string } }).question.status).toBe("skipped");
    const back = await questionPatch(req(`/api/questions/${added.question.id}`, { token: t, method: "PATCH", body: { status: "open" } }), params(added.question.id));
    expect(back.status).toBe(200);
    const merge = await questionPatch(req(`/api/questions/${added.question.id}`, { token: t, method: "PATCH", body: { merge_into: "q-knee-2" } }), params(added.question.id));
    expect(merge.status).toBe(200);
    expect(((await merge.json()) as { into: { id: string } }).into.id).toBe("q-knee-2");
    const refused = await questionPatch(req("/api/questions/q-machine", { token: t, method: "PATCH", body: { text: "x" } }), params("q-machine"));
    expect(refused.status).toBe(409);

    const list = await questionsGet(req("/api/questions", { token: t }));
    const text = await list.text();
    expect(list.status).toBe(200);
    expect(text).not.toContain(him.userId);
    expect(text).not.toMatch(/Day \d+|第\d+天/);
    expect(text).not.toContain("session_id");
  });

  it("bad bodies are 400 and say why; a blank account starts with an empty list", async () => {
    const t = blank.tokens.access_token;
    expect((await questionsPost(req("/api/questions", { token: t, body: { text: "  " } }))).status).toBe(400);
    expect((await questionsPost(req("/api/questions", { token: t, body: { text: "x", day: 3 } }))).status).toBe(400);
    expect((await questionsPost(req("/api/questions", { token: t, body: { text: "x", origin: "pattern" } }))).status).toBe(400);
    const r = await questionsGet(req("/api/questions", { token: t }));
    expect(((await r.json()) as { list: { open: unknown[] } }).list.open).toEqual([]);
  });

  it("nobody but him: no sign-in is refused, another account only ever sees its own list", async () => {
    expect((await questionsGet(req("/api/questions"))).status).toBe(400);
    expect((await questionsGet(req("/api/questions", { token: "not-a-token" }))).status).toBe(401);
    const other = await questionsGet(req("/api/questions", { token: blank.tokens.access_token }));
    const text = await other.text();
    expect(text).not.toContain("q-knee-2");
    // an account's id never opens another account's list
    expect((await questionsGet(req(`/api/questions?session=${him.userId}`, { token: blank.tokens.access_token }))).status).toBe(404);
  });

  it("her care link does not open his list (she only sees the count he shares, on /f)", async () => {
    const her = await createAccountWithSpace(store, getAuthProvider(), { login: `w${randomUUID().slice(0, 10)}`, password: PASSWORD, space: "none" });
    const tokenHash = randomUUID().replace(/-/g, "").padEnd(64, "0");
    const inv = await store.createInvite({ patient_id: him.userId, invite_token_hash: tokenHash, invite_expires_at: new Date(Date.now() + 86_400_000).toISOString() });
    expect(inv.ok).toBe(true);
    const acc = await store.acceptInvite(tokenHash, her.userId, "Wei Ling");
    const linkId = acc.ok ? acc.link.id : "";
    await store.confirmLink(linkId, him.userId, true);
    const before = (await store.listQuestions(him.userId)).length;
    const read = await questionsGet(req(`/api/questions?link=${linkId}`, { token: her.tokens.access_token }));
    expect([403, 404]).toContain(read.status);
    const write = await questionsPost(req(`/api/questions?link=${linkId}`, { token: her.tokens.access_token, body: { text: "她替他问" } }));
    expect([403, 404]).toContain(write.status);
    expect((await store.listQuestions(him.userId)).length).toBe(before);
  });

  it("publishes the change on his scope's channel (the server's bus), never his id to the browser", async () => {
    const t = him.tokens.access_token;
    const before = getBus().recent(him.userId, { limit: 1 })[0]?.id ?? 0;
    await questionsPost(req("/api/questions", { token: t, body: { text: "医生，我能坐飞机吗？" } }));
    const events = getBus().recent(him.userId, { sinceId: before });
    expect(events.map((e) => e.type)).toContain("question.created");
  });
});
