/**
 * She adds a line to his details from her side (C2 track D, round two; real-app 3.10 「补档案」, line 1445 「他点『对』后……她的
 * /f 出现『爸爸确认了』；点『不对』后不再显示」, 2.5 建档):
 *   - what she may propose: the design's kinds for a family member, her own words; never a dose or a reading; a routine
 *     only as a well-formed breakfast time (his 「对」 puts it into the settings his reminders run on)
 *   - what she sees of it: her own lines through her own link, waiting or confirmed; never his own facts, never another
 *     family member's lines, never his reworded text; a line he said 「不对」 to is gone
 *   - her home's numbers (GET /api/family/view) and her stream: his answer about HER line reaches her phone as a
 *     content-free hint, and nobody else's phone
 */
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { GET as eventsGet } from "@/app/api/events/route";
import { POST as acceptPost } from "@/app/api/family/invites/accept/route";
import { POST as invitePost } from "@/app/api/family/invites/route";
import { POST as confirmPost } from "@/app/api/family/links/[id]/confirm/route";
import { GET as viewGet } from "@/app/api/family/view/route";
import { PATCH as factPatch } from "@/app/api/profile/facts/[id]/route";
import { POST as factsPost } from "@/app/api/profile/facts/route";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace, type TestAccount } from "@/lib/auth/dev-accounts";
import { publish, type BusEvent } from "@/lib/bus";
import { breakfastProposal, familyFactProblem, hasDoseOrReading, HER_FACT_KINDS, herFacts } from "@/lib/care/facts";
import { herFactsWords } from "@/lib/care/her-view";
import type { FamilyHomeData } from "@/lib/care/home-types";
import { familyEvent, FAMILY_DROPS, HER_FACT_TYPES } from "@/lib/family/events";
import { FACT_KINDS } from "@/lib/profile/facts";
import { getMemoryStore } from "@/lib/store/memory";
import { scopeRoutine } from "@/lib/store/scope";

const store = getMemoryStore();
/** Every switch on (the fact hint does not depend on his switches: it is about her own writing). */
const ALL_ON_FOR_TEST = { dose_summary: true, bp_summary: true, questions_count: true, no_reply_alert: true, visit_transcripts: true, notes: true };
const PASSWORD = "a long test password";
const decoder = new TextDecoder();
const login = (p: string) => `${p}${randomUUID().replace(/-/g, "").slice(0, 10)}`;
const account = (space: "example" | "blank" | "none", display: string): Promise<TestAccount> => createAccountWithSpace(store, getAuthProvider(), { login: login(space === "none" ? "w" : "t"), password: PASSWORD, space, display_name: display });
const t = (a: TestAccount) => a.tokens.access_token;
const params = (id: string) => ({ params: Promise.resolve({ id }) });

function req(p: string, opts: { token?: string; body?: unknown; method?: string; signal?: AbortSignal } = {}): NextRequest {
  const headers: Record<string, string> = opts.token ? { cookie: `rp_at=${opts.token}` } : {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(`http://localhost${p}`, { method: opts.method ?? (opts.body === undefined ? "GET" : "POST"), headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body), signal: opts.signal });
}

async function linked(him: TestAccount, her: TestAccount, label = "Wei Ling"): Promise<string> {
  const res = await invitePost(req("/api/family/invites", { token: t(him), body: { family_label: label, relation: "daughter", patient_label: "爸爸" } }));
  const body = (await res.json()) as { link: { id: string }; path: string };
  expect((await acceptPost(req("/api/family/invites/accept", { token: t(her), body: { token: body.path.replace(/^\/invite\//, "") } }))).status).toBe(200);
  expect((await confirmPost(req(`/api/family/links/${body.link.id}/confirm`, { token: t(him), body: { yes: true } }), params(body.link.id))).status).toBe(200);
  return body.link.id;
}

const propose = (her: TestAccount, linkId: string, body: unknown) => factsPost(req(`/api/profile/facts?link=${linkId}`, { token: t(her), body }));
const answer = (him: TestAccount, id: string, body: unknown) => factPatch(req(`/api/profile/facts/${id}`, { token: t(him), method: "PATCH", body }), params(id));
const homeOf = async (her: TestAccount, linkId: string) => (await (await viewGet(req(`/api/family/view?link=${linkId}`, { token: t(her) }))).json()) as FamilyHomeData;

async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, needle: string): Promise<string> {
  let text = "";
  for (let i = 0; i < 50 && !text.includes(needle); i++) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value);
  }
  return text;
}
const frames = (text: string): BusEvent[] => text.split("\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)) as BusEvent);

describe("what a family member may propose", () => {
  it("her kinds are the design's: a condition, an allergy, his clinic, breakfast, something else", () => {
    expect([...HER_FACT_KINDS]).toEqual(["condition", "allergy", "clinic", "routine", "other"]);
    for (const k of HER_FACT_KINDS) expect(FACT_KINDS as readonly string[]).toContain(k);
    for (const k of ["name", "age", "home", "language"]) expect(familyFactProblem({ kind: k, text: "x" })).toBe("kind_not_for_family");
    for (const text of ["爸爸有乙肝", "对青霉素过敏", "他喜欢早上去公园", "Blossom Family Clinic", "2019 年做过心脏支架", "糖尿病 10 年了", "He is allergic to seafood"]) {
      expect(hasDoseOrReading(text), text).toBe(false);
      expect(familyFactProblem({ kind: "other", text }), text).toBeNull();
    }
  });

  it("never a dose or a reading in her words", () => {
    for (const text of ["每天吃两粒", "Amlodipine 5 mg", "氨氯地平 5 毫克", "血压 150/95", "take 2 tablets", "早上一片"]) {
      expect(hasDoseOrReading(text), text).toBe(true);
      expect(familyFactProblem({ kind: "condition", text }), text).toBe("text_clinical");
    }
  });

  it("a routine is the breakfast entry with a real time, and nothing else carries data", () => {
    const ok = breakfastProposal("7:30");
    expect(ok).toEqual({ kind: "routine", text: "早饭 · 早上 7:30", data: { entry: { label: "Breakfast", label_zh: "早饭", days: "daily", time: "07:30" } } });
    expect(familyFactProblem(ok)).toBeNull();
    const entry = ok.data.entry;
    expect(familyFactProblem({ kind: "routine", text: "早饭" })).toBe("routine_invalid");
    // the words must be the entry's own: he never confirms one sentence while another time is set
    expect(familyFactProblem({ ...ok, text: "早饭 · 早上 9:00" })).toBe("routine_invalid");
    expect(familyFactProblem({ ...ok, text: "他喜欢早上去公园" })).toBe("routine_invalid");
    expect(familyFactProblem({ kind: "routine", text: "早饭", data: { entry: { ...entry, time: "25:99" } } })).toBe("routine_invalid");
    expect(familyFactProblem({ kind: "routine", text: "早饭", data: { entry: { ...entry, time: "7:30" } } })).toBe("routine_invalid");
    expect(familyFactProblem({ kind: "routine", text: "x", data: { entry: { ...entry, label: "Tai chi", label_zh: "打太极", days: ["Tue"] } } })).toBe("routine_invalid");
    expect(familyFactProblem({ kind: "routine", text: "x", data: { entry: { ...entry, extra: 1 } } })).toBe("routine_invalid");
    expect(familyFactProblem({ kind: "routine", text: "x", data: { entry, more: true } })).toBe("routine_invalid");
    expect(familyFactProblem({ kind: "condition", text: "乙肝", data: { entry } })).toBe("data_not_allowed");
    expect(familyFactProblem({ kind: "condition", text: "乙肝", data: null })).toBeNull();
  });

  it("the route refuses those from her (400) and leaves his own facts as they were", async () => {
    const him = await account("blank", "陈先生");
    const her = await account("none", "Wei Ling");
    const id = await linked(him, her);
    const refused: [unknown, string][] = [
      [{ kind: "name", text: "陈大文" }, "kind_not_for_family"],
      [{ kind: "age", text: "67" }, "kind_not_for_family"],
      [{ kind: "other", text: "每天吃两粒" }, "text_clinical"],
      [{ kind: "condition", text: "血压 150/95" }, "text_clinical"],
      [{ kind: "routine", text: "早饭", data: { entry: { label: "Breakfast", label_zh: "早饭", days: "daily", time: "99:00" } } }, "routine_invalid"],
      [{ kind: "allergy", text: "青霉素", data: { none: true } }, "data_not_allowed"],
    ];
    for (const [body, code] of refused) {
      const res = await propose(her, id, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(await res.json()).toEqual({ error: code });
    }
    expect(await store.listProfileFacts(him.userId)).toEqual([]);
    // his own account: every kind as before, numbers included (they are his own words about himself)
    expect((await factsPost(req("/api/profile/facts", { token: t(him), body: { kind: "name", text: "陈大文" } }))).status).toBe(201);
    expect((await factsPost(req("/api/profile/facts", { token: t(him), body: { kind: "other", text: "我每天走 30 分钟" } }))).status).toBe(201);
  });
});

describe("what she sees of her own lines", () => {
  it("waiting, then 「爸爸确认了」; reworded by him: her own words and that he confirmed; 「不对」: gone", async () => {
    const him = await account("blank", "陈先生");
    const her = await account("none", "Wei Ling");
    const son = await account("none", "Wei Jie");
    const id = await linked(him, her);
    const sonId = await linked(him, son, "Wei Jie");
    // his own fact, and the son's proposal: neither is hers to see
    await factsPost(req("/api/profile/facts", { token: t(him), body: { kind: "allergy", text: "海鲜" } }));
    expect((await propose(son, sonId, { kind: "other", text: "他周末爱钓鱼" })).status).toBe(201);

    expect((await homeOf(her, id)).facts).toEqual({ waiting: 0, confirmed: 0 });
    const made = await propose(her, id, { kind: "condition", text: "爸爸有乙肝" });
    expect(made.status).toBe(201);
    const fact = ((await made.json()) as { fact: { id: string; source: string; confirmed: boolean } }).fact;
    expect(fact).toMatchObject({ source: "family", confirmed: false });
    const second = ((await (await propose(her, id, { kind: "clinic", text: "Blossom Family Clinic" })).json()) as { fact: { id: string } }).fact;
    const third = ((await (await propose(her, id, { kind: "other", text: "他喜欢早上去公园" })).json()) as { fact: { id: string } }).fact;

    let mine = await herFacts(store, { id: him.userId }, id);
    expect(mine.map((f) => `${f.kind}:${f.text}:${f.state}`).sort()).toEqual(["clinic:Blossom Family Clinic:waiting", "condition:爸爸有乙肝:waiting", "other:他喜欢早上去公园:waiting"]);
    expect(await herFacts(store, { id: him.userId }, sonId)).toHaveLength(1);
    let home = await homeOf(her, id);
    expect(home.facts).toEqual({ waiting: 3, confirmed: 0 });
    expect(herFactsWords(home.facts, "爸爸", "zh-Hans")).toBe("3 条等爸爸确认");
    // her whole home never carries his own fact or the son's words
    expect(JSON.stringify(home)).not.toMatch(/海鲜|钓鱼|乙肝/);

    // 对: confirmed
    expect((await answer(him, fact.id, { answer: "yes" })).status).toBe(200);
    // 改一下: his words in his profile, her own words on her side
    expect((await answer(him, second.id, { answer: "edit", text: "Blossom Family Clinic, Toa Payoh" })).status).toBe(200);
    // 不对: gone from her list
    expect((await answer(him, third.id, { answer: "no" })).status).toBe(200);
    mine = await herFacts(store, { id: him.userId }, id);
    expect(mine).toHaveLength(2);
    expect(mine.find((f) => f.kind === "condition")).toMatchObject({ text: "爸爸有乙肝", state: "confirmed", edited: false });
    expect(mine.find((f) => f.kind === "clinic")).toMatchObject({ text: "Blossom Family Clinic", state: "confirmed", edited: true });
    expect(JSON.stringify(mine)).not.toContain("Toa Payoh");
    home = await homeOf(her, id);
    expect(home.facts).toEqual({ waiting: 0, confirmed: 2 });
    expect(herFactsWords(home.facts, "爸爸", "zh-Hans")).toBe("爸爸确认了");
    expect(herFactsWords(home.facts, "Dad", "en")).toBe("Dad confirmed");
    expect(herFactsWords({ waiting: 0, confirmed: 0 }, "爸爸", "zh-Hans")).toBeNull();
    // she can only propose: his answer is his alone
    const late = ((await (await propose(her, id, { kind: "allergy", text: "青霉素" })).json()) as { fact: { id: string } }).fact;
    expect([403, 404]).toContain((await factPatch(req(`/api/profile/facts/${late.id}?link=${id}`, { token: t(her), method: "PATCH", body: { answer: "yes" } }), params(late.id))).status);
  });

  it("breakfast: his 「对」 puts her time into his settings, and not before", async () => {
    const him = await account("blank", "陈先生");
    const her = await account("none", "Wei Ling");
    const id = await linked(him, her);
    const made = await propose(her, id, breakfastProposal("07:30"));
    expect(made.status).toBe(201);
    const fact = ((await made.json()) as { fact: { id: string } }).fact;
    expect((await herFacts(store, { id: him.userId }, id))[0]).toMatchObject({ kind: "routine", time: "07:30", state: "waiting" });
    const before = scopeRoutine((await store.getSession(him.userId))!);
    expect(before.some((r) => r.time === "07:30")).toBe(false);
    expect((await answer(him, fact.id, { answer: "yes" })).status).toBe(200);
    expect(scopeRoutine((await store.getSession(him.userId))!)).toContainEqual({ label: "Breakfast", label_zh: "早饭", days: "daily", time: "07:30" });
    expect((await herFacts(store, { id: him.userId }, id))[0]).toMatchObject({ state: "confirmed" });
  });
});

describe("her stream", () => {
  it("his answer about her line is a content-free hint on her phone only; his own facts and the son's lines never reach her", async () => {
    const him = await account("blank", "陈先生");
    const her = await account("none", "Wei Ling");
    const son = await account("none", "Wei Jie");
    const id = await linked(him, her);
    const sonId = await linked(him, son, "Wei Jie");
    const hers = ((await (await propose(her, id, { kind: "condition", text: "爸爸有乙肝" })).json()) as { fact: { id: string } }).fact;
    const sons = ((await (await propose(son, sonId, { kind: "other", text: "他周末爱钓鱼" })).json()) as { fact: { id: string } }).fact;

    const abort = new AbortController();
    const res = await eventsGet(req(`/api/events?link=${id}`, { token: t(her), signal: abort.signal }));
    const reader = res.body!.getReader();
    await readUntil(reader, "connected");

    // the son's line is answered, his own fact is added: nothing for her
    expect((await answer(him, sons.id, { answer: "yes" })).status).toBe(200);
    await factsPost(req("/api/profile/facts", { token: t(him), body: { kind: "allergy", text: "海鲜" } }));
    // then hers
    expect((await answer(him, hers.id, { answer: "yes" })).status).toBe(200);
    const marker = publish(him.userId, "reminder.clip_added", "marker", {});
    const text = await readUntil(reader, `id: ${marker.id}`);
    abort.abort();
    const got = frames(text);
    const facts = got.filter((e) => e.type.startsWith("profile."));
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ type: "profile.fact_confirmed", say: "", data: {}, session_id: "" });
    expect(text).not.toMatch(/乙肝|钓鱼|海鲜|condition|by_link/);
    expect(text).not.toContain(hers.id);
  });

  it("the filter: only with her link and only the two answer types; everything else about his profile stays dropped", () => {
    const ev = (type: string, data: unknown): BusEvent => ({ id: 3, type: type as BusEvent["type"], session_id: "s", at: "2026-10-10T00:00:00.000Z", say: "SAY", data });
    const data = { fact: { id: "f1", kind: "condition", source: "family", confirmed: true }, answer: "yes", by_link: "link-1" };
    expect([...HER_FACT_TYPES]).toEqual(["profile.fact_confirmed", "profile.fact_changed"]);
    for (const type of HER_FACT_TYPES) {
      expect(FAMILY_DROPS.has(type)).toBe(true);
      expect(familyEvent(ev(type, data), ALL_ON_FOR_TEST, "link-1")).toEqual({ kind: "hint", event: { id: 3, type, session_id: "s", at: "2026-10-10T00:00:00.000Z", say: "", data: {} } });
      expect(familyEvent(ev(type, data), ALL_ON_FOR_TEST, "link-2").kind).toBe("dropped");
      expect(familyEvent(ev(type, data), ALL_ON_FOR_TEST).kind).toBe("dropped"); // the demo's family phone
      expect(familyEvent(ev(type, { ...data, by_link: undefined }), ALL_ON_FOR_TEST, "link-1").kind).toBe("dropped");
    }
    expect(familyEvent(ev("profile.fact_added", data), ALL_ON_FOR_TEST, "link-1").kind).toBe("dropped");
  });
});
