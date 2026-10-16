/**
 * Track K, journey 11 (M10; e2e-chains 9): the official tables' lines for his age and recorded conditions (our words,
 * each with its table, version and page), cardiovascular screening switching to 「由你的医生跟进」 after a diagnosis,
 * the doctor's own words about tests first, 「加进问题单」 (origin preventive) and 「我做过了」, never 你需要 / you are due.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import screening from "@/kb/screening.json";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace } from "@/lib/auth/dev-accounts";
import { addFact } from "@/lib/profile/facts";
import { knownAboutHim } from "@/lib/prevent/conditions";
import { CARDIO, CARDIO_FOLLOWED, CAVEAT, PREVENT_ITEMS } from "@/lib/prevent/items";
import { preventAction, preventView } from "@/lib/prevent/view";
import { getMemoryStore } from "@/lib/store/memory";
import { scopedStore } from "@/lib/subject";

const store = getMemoryStore();
const FORBIDDEN = /你需要|你应该|你应当|你该|你符合|你有资格|建议你|一定要|\byou need\b|\byou are due\b|\byou're due\b|\byou are eligible\b|\byou should\b|\byou must\b/i;

async function account(space: "example" | "blank") {
  const a = await createAccountWithSpace(store, getAuthProvider(), { login: `kp${randomUUID().slice(0, 10)}`, password: "a long test password", space });
  const own = scopedStore(store, a.scope!, "self", { userId: a.userId, maskSessionId: true });
  const scope = async () => (await own.getSession(a.scope!.id))!;
  return { own, scope };
}

describe("the prevention lines themselves", () => {
  it("no line, title, question, source or screen word says 你需要 / 你应该 / 你符合 / you need / you are due / you are eligible", () => {
    const strings: string[] = [];
    for (const it of [...PREVENT_ITEMS, CARDIO]) {
      for (const l of ["zh-Hans", "en"] as const) strings.push(it.title[l], it.table[l], it.question[l], it.source.name[l], it.source.version[l]);
    }
    for (const l of ["zh-Hans", "en"] as const) strings.push(CARDIO_FOLLOWED.status[l], CARDIO_FOLLOWED.table[l], CAVEAT.text[l]);
    for (const s of strings) expect(s, s).not.toMatch(FORBIDDEN);
    // the screen's own words too: the screen, and the copy module its words live in since the timeline design
    for (const file of ["PreventScreen.tsx", "copy.ts"]) {
      const source = readFileSync(path.join(process.cwd(), "components", "prevent", file), "utf8");
      expect(source, file).not.toMatch(FORBIDDEN);
    }
  });

  it("every line cites a page the kb lists for its row (NAIS lines: the schedule's PDF)", () => {
    const rows = new Map((screening as { screening: { id: string; official_page: string }[] }).screening.map((r) => [r.id, r.official_page]));
    const nais = rows.get("C2-01")!;
    for (const it of PREVENT_ITEMS) {
      const page = it.source.url === CAVEAT.source.url ? nais : rows.get(it.id)!;
      expect(page, it.id).toBeTruthy();
      expect(page, it.id).toContain(it.source.url);
    }
    expect(rows.get("C1-03")).toContain(CARDIO_FOLLOWED.source.url);
    expect(nais).toContain(CAVEAT.source.url);
  });

  it("our words, never the table's English copied: no line repeats a kb 'who' sentence", () => {
    const whos = (screening as { screening: { who: string }[] }).screening.map((r) => r.who.replace(/\*\*/g, "").toLowerCase());
    for (const it of PREVENT_ITEMS) for (const w of whos) if (w.length > 30) expect(it.table.en.toLowerCase(), it.id).not.toContain(w);
  });
});

describe("the prevention screen on an account", () => {
  it("the example account (67, Dr Lim said 'Your blood pressure is high'): vaccines and screenings for his age; cardiovascular is followed by his doctor", async () => {
    const { own, scope } = await account("example");
    const s = await scope();
    const known = await knownAboutHim(own, s);
    expect(known.age).toBe(67);
    expect(known.conditions).toEqual([expect.objectContaining({ id: "hypertension", from: "visit", text: "Yes, these confirm it. Your blood pressure is high. We'll start a tablet." })]);

    const v = await preventView(own, s, "zh-Hans");
    expect(v.noAge).toBe(false);
    expect(v.table.map((r) => r.id)).toEqual(["C2-03", "C2-04", "C2-06", "C1-06", "C1-03", "C1-08"]);
    const cardio = v.table.find((r) => r.id === "C1-03")!;
    expect(cardio).toMatchObject({ title: "心血管风险筛查", canAsk: false, followed: { status: "由你的医生跟进" } });
    expect(cardio.doctor).toMatchObject({ utteranceId: "v2-u04", text: "Yes, these confirm it. Your blood pressure is high. We'll start a tablet." });
    const flu = v.table.find((r) => r.id === "C2-03")!;
    expect(flu.table).toContain("国家成人免疫计划表上写着");
    expect(flu.source).toMatchObject({ name: "国家成人免疫计划表", version: "2026年4月1日版" });
    // the doctor's own words about follow-ups at his last clinic visit (v2), first
    expect(v.doctor.map((r) => r.doctor?.utteranceId)).toEqual(["v2-u09"]);
    // the next visit (today's planned follow-up) and the questions waiting for it
    expect(v.next).toMatchObject({ days: 0 });
    expect(v.next!.questions).toBeGreaterThan(0);
    expect(v.caveat.text).toBe("国家成人免疫计划表上写着：每个人适合什么、能不能拿补贴，要看医生。");
    for (const r of [...v.doctor, ...v.table]) expect(JSON.stringify(r)).not.toMatch(FORBIDDEN);
  });

  it("before and after the diagnosis is recorded: cardiovascular screening listed, then 「由你的医生跟进」", async () => {
    const { own, scope } = await account("blank");
    await addFact(own, await scope(), { kind: "age", text: "58", data: { years: 58 } }, { kind: "patient" }, { publish: () => undefined });
    const before = await preventView(own, await scope(), "en");
    expect(before.table.map((r) => r.id)).toEqual(["C1-06", "C1-02"]);
    expect(before.table[1]).toMatchObject({ title: "Cardiovascular risk screening", canAsk: true, followed: null });
    await addFact(own, await scope(), { kind: "condition", text: "高血压" }, { kind: "patient" }, { publish: () => undefined });
    const after = await preventView(own, await scope(), "en");
    expect(after.table.map((r) => r.id)).toEqual(["C1-06", "C1-03"]);
    expect(after.table[1].followed).toMatchObject({ status: "Followed by your doctor", fact: "高血压" });
    expect(after.table[1].doctor).toBeNull();
  });

  it("no age in his profile: the age lines wait, nothing is guessed", async () => {
    const { own, scope } = await account("blank");
    const v = await preventView(own, await scope(), "zh-Hans");
    expect(v).toMatchObject({ noAge: true, table: [], doctor: [], done: [], next: null });
  });

  it("「我做过了」 moves a line to done with today's date, undo puts it back; a yearly line comes back after a year", async () => {
    const { own, scope } = await account("example");
    const s = await scope();
    const done = await preventAction(own, s, "C1-06", "done", "zh-Hans");
    expect(done).toMatchObject({ ok: true, action: "done" });
    let v = await preventView(own, s, "zh-Hans");
    expect(v.table.map((r) => r.id)).not.toContain("C1-06");
    expect(v.done.find((r) => r.id === "C1-06")!.done!.date).toBe(new Date(Date.parse(`${s.d0}T00:00:00Z`) + s.story_day * 86_400_000).toISOString().slice(0, 10));
    expect(await preventAction(own, s, "C1-06", "undo", "zh-Hans")).toMatchObject({ ok: true });
    v = await preventView(own, s, "zh-Hans");
    expect(v.table.map((r) => r.id)).toContain("C1-06");
    expect(v.done).toEqual([]);

    await own.addPreventDone(s.id, { item_id: "C2-03", day: s.story_day - 400, source: "patient" });
    await own.addPreventDone(s.id, { item_id: "C2-04", day: s.story_day - 400, source: "patient" });
    v = await preventView(own, s, "zh-Hans");
    expect(v.table.find((r) => r.id === "C2-03")!.lastDone).toBeTruthy(); // yearly: back on the list
    expect(v.done.map((r) => r.id)).toEqual(["C2-04"]); // once: stays done
    expect(await preventAction(own, s, "C1-03", "done", "zh-Hans")).toMatchObject({ ok: false, error: "not_listed" });
    expect(await preventAction(own, s, "C9-99", "done", "zh-Hans")).toMatchObject({ ok: false, error: "item_not_found" });
  });

  it("「加进问题单」: one question for the doctor, origin preventive, his words; tapping again adds nothing", async () => {
    const { own, scope } = await account("example");
    const s = await scope();
    const before = (await own.listQuestions(s.id)).length;
    const r = await preventAction(own, s, "C2-03", "ask", "zh-Hans");
    expect(r).toMatchObject({ ok: true, outcome: "created" });
    const q = (await own.listQuestions(s.id)).find((x) => x.origin === "preventive")!;
    expect(q).toMatchObject({ for: "doctor", origin: "preventive", text: "今年的流感疫苗适合我打吗？", status: "open" });
    expect(await preventAction(own, s, "C2-03", "ask", "zh-Hans")).toMatchObject({ ok: true, outcome: "merged" });
    expect((await own.listQuestions(s.id)).length).toBe(before + 1);
    expect((await preventView(own, s, "zh-Hans")).table.find((x) => x.id === "C2-03")!.questionId).toBe(q.id);
  });
});
