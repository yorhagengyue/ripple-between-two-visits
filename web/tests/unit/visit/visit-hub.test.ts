/**
 * The visit tab's first screen on his account (owner's decision of 10-14: the visit page and the question list are one
 * tab; components/visit/elder/VisitHub.tsx, its data lib/visit/hub.ts, handed over by components/visit/elder/pages.tsx):
 *   - the timeline: his earlier visits (the example account's three), the oldest first, then today's follow-up with its
 *     place and the brief for the doctor; an earlier visit opened in place holds the doctor's lines the record holds as
 *     confirmed, word for word with their clip, grouped as the record classifies them (the target under 医生交代的事,
 *     the warning line under 要注意的), and the way to its whole record; a line he said is not right is not there;
 *   - what to tell the doctor: the notes Ripple kept (lib/daily/signals.ts, stubbed here), newest first, five at most,
 *     with the date and the time in his zone; none: the section is left out;
 *   - the question list as one list: the doctor's and the pharmacist's together (a small tag on the pharmacist's), five
 *     at most, 「看全部（N）」, 「加一个问题」, 「提问」 to /p/ask;
 *   - one 「开始就诊」 and no 诊所就诊 / 药房 pair, no 就诊地点, no say bar;
 *   - /p/questions: one list (no 问医生 / 问药剂师 sides), the pharmacist's question tagged, the bar on 就诊.
 *
 * Mr Tan's example account laid out on Wed 14 Oct 2026 (d0 2 Sep: v1 2 Sep, v2 10 Sep, p1 14 Sep, v3 planned today), and
 * blank accounts for the list; the developer test clock, frozen.
 */
import { randomUUID } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/** what the stand-in for lib/daily/signals.ts answers (each test sets it) */
const stub = vi.hoisted(() => ({ signals: [] as { id: string; at: string; day: string; text: string; lang: string | null }[] }));

// a server render has no app router and no live connection: the screens get ones that do nothing
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, forward() {}, prefetch() {} }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/p/visit",
}));
vi.mock("@/components/live/LiveSession", async (original) => ({
  ...(await original<typeof import("@/components/live/LiveSession")>()),
  useLiveEvent: () => undefined,
}));
vi.mock("@/lib/daily/signals", async (original) => ({
  ...(await original<typeof import("@/lib/daily/signals")>()),
  listDoctorSignals: vi.fn(async () => stub.signals),
}));

import { AccountQuestions } from "@/app/p/questions/AccountQuestions";
import { AccountVisitFlow } from "@/components/visit/elder/AccountVisitFlow";
import { AccountVisitPage } from "@/components/visit/elder/pages";
import { TOLD_SHOWN, VisitRecord } from "@/components/visit/elder/VisitHub";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace } from "@/lib/auth/dev-accounts";
import { addQuestionFor, questionList } from "@/lib/profile/questions";
import { getMemoryStore } from "@/lib/store/memory";
import { scopeD0 } from "@/lib/store/scope";
import type { SessionRow } from "@/lib/store/types";
import type { PageSubject } from "@/lib/subject";
import { setTestClock } from "@/lib/time/now";
import { HUB_QUESTIONS_MAX, HUB_SIGNALS_MAX, hubSignals, visitRecord } from "@/lib/visit/hub";
import { setItemVerdict } from "@/lib/visit/pipeline";

type FlowProps = Parameters<typeof AccountVisitFlow>[0];

const store = getMemoryStore();
const NOW = "2026-10-14T09:30:00+08:00";
const R1 = "At home, we want it below 135 over 85.";
const R2_START = "If your reading at home is above 180 on top";
const R3_START = "This tablet works quietly.";
const R4_START = "Please don't change the dose yourself.";

beforeAll(() => {
  delete process.env.SPEECH_PROVIDER;
});
beforeEach(() => {
  setTestClock({ at: NOW, frozen: true });
  stub.signals = [];
});
afterEach(() => {
  setTestClock(null);
});

async function account(space: "blank" | "example"): Promise<SessionRow> {
  const a = await createAccountWithSpace(store, getAuthProvider(), { login: `vh${randomUUID().slice(0, 10)}`, password: "a long test password", space });
  return (await store.getSession(a.scope!.id))!;
}

/** The props the page's server half hands the flow (his own page: the scope's store, its session, its first day). */
async function pageProps(scopeId: string, locale: "zh-Hans" | "en" = "zh-Hans"): Promise<FlowProps> {
  const session = (await store.getSession(scopeId))!;
  const ctx = { store, session, d0: scopeD0(session) } as unknown as PageSubject;
  const el = await AccountVisitPage({ ctx, locale, visitParam: null, speed: 1 });
  return el.props as FlowProps;
}

/** The screen as text and markup (the flow's first screen: the hub). */
const draw = (props: FlowProps) => renderToStaticMarkup(createElement(AccountVisitFlow, props));
const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("the timeline", () => {
  it("the example's earlier visits open to the doctor's lines the record holds, grouped; the next visit follows them", async () => {
    const scope = await account("example");
    const props = await pageProps(scope.id);
    // the flow keeps its rows (newest first); the hub turns them over
    expect(props.past.map((p) => [p.id, p.date])).toEqual([
      ["p1", "9月14日"],
      ["v2", "9月10日"],
      ["v1", "9月2日"],
    ]);
    // owner 10-15 (the demo video): the planned visit's time and doctor under its place (lib/daily/visit-details.ts)
    expect(props.planned).toEqual([expect.objectContaining({ id: "v3", today: true, canBook: false, place: "Blossom Family Clinic (fictional)\n早上 10:30 · 林伟明医生（虚构）" })]);

    const v1 = props.hub.records.v1;
    expect(v1.told.map((l) => l.text)).toEqual([R1]);
    expect(v1.told[0]).toMatchObject({ id: "v1-u08", speaker: "doctor", title: "目标", lang: "en" });
    expect(v1.told[0].clip?.url).toMatch(/\/api\/visits\/v1\/clip\?u=v1-u08/);
    // the warning line (995 / A&E) is what to watch for
    expect(v1.watch.map((l) => l.text.slice(0, R2_START.length))).toEqual([R2_START]);
    expect(v1.watch[0].title).toBe("警示线");
    const v2 = props.hub.records.v2;
    expect(v2.told.map((l) => l.text.slice(0, 26))).toEqual([R3_START.slice(0, 26), R4_START.slice(0, 26)]);
    expect(v2.watch).toEqual([]);
    // the pharmacy visit has no line of the record's: it opens to the way to its whole record
    expect(props.hub.records.p1).toEqual({ told: [], watch: [] });

    const html = draw(props);
    expect(html).toContain('data-testid="visit-timeline"');
    // the oldest first, then today's follow-up, then the brief for the doctor: down into the future
    const order = ["data-visit=\"v1\"", "data-visit=\"v2\"", "data-visit=\"p1\"", 'data-testid="visit-planned-row"', 'data-testid="visit-brief"'].map((s) => html.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(count(html, 'data-testid="visit-past-row"')).toBe(3);
    // closed until tapped: the rows are buttons that say so
    expect(count(html, 'aria-expanded="false"')).toBe(3);
    expect(html).not.toContain('data-testid="visit-past-record"');
    expect(html).toContain('href="/p/brief?from=visit"');
    expect(html).toContain("就诊简报");
    // today's follow-up is the example's sample visit: its row plays it, and says it is a replay
    expect(html).toContain('data-testid="visit-sample-start"');
    expect(html).toContain("示例回放");
  });

  it("an earlier visit opened in place: 医生交代的事, 要注意的, the clip, and the way to its whole record", async () => {
    const scope = await account("example");
    const props = await pageProps(scope.id);
    const html = renderToStaticMarkup(createElement(VisitRecord, { visitId: "v1", record: props.hub.records.v1, locale: "zh-Hans" }));
    expect(html).toContain("医生交代的事");
    expect(html).toContain("要注意的");
    expect(html.indexOf("医生交代的事")).toBeLessThan(html.indexOf("要注意的"));
    expect(html).toContain(R1);
    expect(html).toContain(R2_START);
    // the doctor's words in the serif with their source, who said them, the clip
    expect(html).toContain('data-source-ref="v1-u08"');
    expect(html).toContain("医生说");
    expect(html).toContain("/api/visits/v1/clip?u=v1-u08");
    expect(html).toContain('href="/p/visit/v1/review"');
    expect(html).toContain("看这次的全部记录");
    // a visit with none of the record's lines says so (and still leads to its whole record)
    const none = renderToStaticMarkup(createElement(VisitRecord, { visitId: "p1", record: props.hub.records.p1, locale: "zh-Hans" }));
    expect(none).toContain('data-testid="visit-record-none"');
    expect(none).toContain('href="/p/visit/p1/review"');
    // a record that could not be read: only the way to it, nothing said about what is in it
    const unread = renderToStaticMarkup(createElement(VisitRecord, { visitId: "p1", record: undefined, locale: "zh-Hans" }));
    expect(unread).not.toContain("visit-record-none");
    expect(unread).toContain('href="/p/visit/p1/review"');
  });

  it("only what he confirmed: a line he said is not right leaves the record; three of what the doctor told him, the rest in the whole record", async () => {
    const scope = await account("example");
    const r1 = (await store.listVisitItems(scope.id, { visit_id: "v1" })).find((it) => it.required_line === "R1")!;
    await setItemVerdict(store, scope, "v1", { items: [r1.id], verdict: "wrong" });
    const props = await pageProps(scope.id);
    expect(props.hub.records.v1.told).toEqual([]);
    expect(props.hub.records.v1.watch.length).toBe(1);

    // four lines of the doctor's: three shown, 「还有 1 件」
    const line = (n: number) => ({ id: `l${n}`, text: `Line ${n}.`, lang: "en", speaker: "doctor" as const, tStartMs: n * 1000, title: null, clip: null, translation: null, hold: `v:${n}` });
    const many = renderToStaticMarkup(createElement(VisitRecord, { visitId: "v9", record: { told: [1, 2, 3, 4].map(line), watch: [line(5)] }, locale: "zh-Hans" }));
    expect(count(many, 'data-testid="visit-record-line"')).toBe(TOLD_SHOWN + 1);
    expect(many).toContain("还有 1 件，在这次的全部记录里。");
    expect(many).toContain("Line 5.");
  });

  it("a blank account: the timeline says there is nothing yet, the next visit is not set, the brief is there", async () => {
    const scope = await account("blank");
    const props = await pageProps(scope.id);
    const html = draw(props);
    expect(html).toContain('data-testid="visit-past-none"');
    expect(html).toContain("暂无就诊记录");
    expect(html).toContain('data-testid="visit-next-none"');
    expect(html).toContain("下次就诊还没有定");
    expect(html).toContain('data-testid="visit-brief"');
    expect(count(html, 'data-testid="visit-start"')).toBe(1);
  });
});

describe("what goes with a line of the record (pure)", () => {
  it("a clinician's line he confirmed, grouped by the item's kind; a patient's line or an unanswered guess is not a record line", () => {
    const u = (id: string, text: string, role: "doctor" | "patient", state: "confirmed" | "inferred", t: number) =>
      ({ id, session_id: "s", visit_id: "v", t_start_ms: t, t_end_ms: t + 900, speaker_cluster: null, role, role_state: state, text, lang: "en", clip_path: null, scripted_fallback: false, created_at: NOW }) as const;
    const item = (id: string, type: string, ids: string[], verdict: string | null, slots: Record<string, unknown> = {}) =>
      ({ id, session_id: "s", visit_id: "v", type, text: "x", utterance_ids: ids, slots: verdict ? { ...slots, verdict } : slots, confirmed_by: verdict === "right" ? "patient" : null, required_line: null, speaker: null, created_at: NOW }) as never;
    const out = visitRecord({
      scope: { id: "s", kind: "account" },
      visit: { id: "v", status: "confirmed" },
      transcript: [
        u("a", "Take one every morning.", "doctor", "confirmed", 1000),
        u("b", "If you forget one, take it when you remember.", "doctor", "confirmed", 2000),
        u("c", "Can I take it at night?", "patient", "confirmed", 3000),
        u("d", "Come back in six weeks.", "doctor", "inferred", 4000),
      ],
      items: [item("i1", "instruction", ["a"], "right"), item("i2", "instruction", ["b"], "right", { variant: "missed_dose" }), item("i3", "instruction", ["c"], "right"), item("i4", "follow_up", ["d"], null)],
      translations: new Map(),
      locale: "zh-Hans",
    });
    expect(out.told.map((l) => l.id)).toEqual(["a"]);
    expect(out.watch.map((l) => l.id)).toEqual(["b"]);
    expect(out.watch[0].title).toBe("漏服时");
  });
});

describe("what to tell the doctor", () => {
  const SIGNALS = [
    { id: "s1", at: "2026-10-13T12:10:00.000Z", day: "2026-10-13", text: "头有点晕", lang: "zh-Hans" },
    { id: "s2", at: "2026-10-14T00:40:00.000Z", day: "2026-10-14", text: "胸口有点闷", lang: "zh-Hans" },
    { id: "s3", at: "2026-10-10T01:00:00.000Z", day: "2026-10-10", text: "血压 185/112", lang: "zh-Hans" },
    { id: "s4", at: "2026-10-09T01:00:00.000Z", day: "2026-10-09", text: "one", lang: "en" },
    { id: "s5", at: "2026-10-08T01:00:00.000Z", day: "2026-10-08", text: "two", lang: "en" },
    { id: "s6", at: "2026-10-07T01:00:00.000Z", day: "2026-10-07", text: "three", lang: "en" },
    { id: "s7", at: "2026-10-06T01:00:00.000Z", day: "2026-10-06", text: "four", lang: "en" },
  ];

  it("five at most, the newest first, with the date and the time in his zone", async () => {
    stub.signals = SIGNALS;
    const scope = await account("blank");
    const props = await pageProps(scope.id);
    expect(props.hub.signals.length).toBe(HUB_SIGNALS_MAX);
    expect(props.hub.signals.map((s) => s.id)).toEqual(["s2", "s1", "s3", "s4", "s5"]);
    expect(props.hub.signals[0]).toMatchObject({ date: "10月14日", time: "上午 8:40", text: "胸口有点闷" });
    expect(props.hub.signals[1]).toMatchObject({ date: "10月13日", time: "晚上 8:10" });
    const html = draw(props);
    expect(html).toContain('data-testid="visit-signals"');
    expect(html).toContain("要告诉医生的情况");
    expect(count(html, 'data-testid="visit-signal"')).toBe(HUB_SIGNALS_MAX);
    expect(html.indexOf("胸口有点闷")).toBeLessThan(html.indexOf("头有点晕"));
    // in English, the same notes with English dates and times
    expect(hubSignals(SIGNALS.slice(0, 1), { d0: "2026-09-02", tz: "Asia/Singapore", locale: "en" })[0]).toMatchObject({ date: "13 Oct", time: "8:10 pm" });
  });

  it("nothing noted: the section is left out", async () => {
    const scope = await account("blank");
    const html = draw(await pageProps(scope.id));
    expect(html).not.toContain('data-testid="visit-signals"');
    expect(html).not.toContain("要告诉医生的情况");
  });
});

describe("the question list, one list", () => {
  it("the doctor's and the pharmacist's questions together, the pharmacist's tagged; 加一个问题 (提问 is the round button of every page since 10-15)", async () => {
    const scope = await account("blank");
    await addQuestionFor(store, scope, { text: "降压药要服用多久？" });
    await addQuestionFor(store, scope, { text: "这个药饭前还是饭后服用？", for: "pharmacist" });
    await addQuestionFor(store, scope, { text: "可以继续打太极吗？" });
    const props = await pageProps(scope.id);
    expect(props.hub.questions?.total).toBe(3);
    expect(props.hub.questions?.shown.map((q) => [q.text, q.pharmacist])).toEqual([
      ["降压药要服用多久？", false],
      ["可以继续打太极吗？", false],
      ["这个药饭前还是饭后服用？", true],
    ]);
    const html = draw(props);
    expect(count(html, 'data-testid="visit-question"')).toBe(3);
    expect(count(html, 'data-for="pharmacist"')).toBe(1);
    expect(html).toContain(">药剂师<");
    expect(html).not.toMatch(/问医生|问药剂师/);
    expect(html).toContain("看全部（3）");
    expect(html).toContain('href="/p/questions"');
    expect(html).toContain('href="/p/questions/add"');
    expect(html).toContain("加一个问题");
    // asking Ripple moved here from the say bar
    // owner 10-15: no button to a page of its own; asking is components/ask/AskFab.tsx, mounted in his layout
    expect(html).not.toContain('href="/p/ask"');
  });

  it("five at most, then 「看全部（N）」", async () => {
    const scope = await account("blank");
    for (let i = 1; i <= 6; i++) await addQuestionFor(store, scope, { text: `第 ${i} 个问题：这个要注意什么？` });
    await addQuestionFor(store, scope, { text: "药袋上的字看不清，怎么办？", for: "pharmacist" });
    const props = await pageProps(scope.id);
    expect(props.hub.questions?.total).toBe(7);
    expect(props.hub.questions?.shown.length).toBe(HUB_QUESTIONS_MAX);
    const html = draw(props);
    expect(count(html, 'data-testid="visit-question"')).toBe(HUB_QUESTIONS_MAX);
    expect(html).toContain("看全部（7）");
  });

  it("/p/questions: one list, no sides; the pharmacist's question tagged; the bar on 就诊; back to the visit tab", async () => {
    const scope = await account("blank");
    await addQuestionFor(store, scope, { text: "降压药要服用多久？" });
    await addQuestionFor(store, scope, { text: "这个药饭前还是饭后服用？", for: "pharmacist" });
    const list = await questionList(store, scope, "zh-Hans");
    const html = renderToStaticMarkup(createElement(AccountQuestions, { scope, list, locale: "zh-Hans", notice: null }));
    expect(html).not.toContain('data-rp="segmented"');
    expect(html).not.toMatch(/问医生|问药剂师/);
    expect(count(html, 'data-for="doctor"')).toBe(1);
    expect(count(html, 'data-for="pharmacist"')).toBe(1);
    expect(html).toContain(">药剂师<");
    expect(html).toMatch(/data-tab="visit"[^>]*aria-current="page"|aria-current="page"[^>]*data-tab="visit"/);
    expect(html).toContain('href="/p/visit"');
    expect(html).toContain('href="/p/questions/add"');
    expect(html).not.toContain("for=pharmacist");
  });
});

describe("one button", () => {
  it("「开始就诊」 once; no 诊所就诊 / 药房 pair, no 就诊地点, no say bar", async () => {
    for (const space of ["example", "blank"] as const) {
      const scope = await account(space);
      const html = draw(await pageProps(scope.id));
      expect(count(html, 'data-testid="visit-start"'), space).toBe(1);
      expect(count(html, "开始就诊"), space).toBe(1);
      expect(html, space).not.toMatch(/data-testid="visit-(clinic|pharmacy|where-ask|before|empty)"/);
      expect(html, space).not.toMatch(/诊所就诊|就诊地点|直接开始|按一下说/);
      expect(html, space).not.toContain('data-rp="say-bar"');
    }
    // in English too
    const scope = await account("blank");
    const en = draw(await pageProps(scope.id, "en"));
    expect(count(en, "Start the visit")).toBe(1);
    expect(en).not.toMatch(/At the clinic|At the pharmacy/);
  });
});
