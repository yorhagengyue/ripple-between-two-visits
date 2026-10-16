"use client";

/**
 * The director's story sheet on /director (ux pass 10-13; lib/crew/story-edits.ts). The crew changes small things of
 * Mr Tan's story here before a take: whether a medicine is there and whether its bag is read yet, which mornings he
 * took the tablet, a reading, a note or a question of his own. Every "Lay out to a scene" below then lays the account
 * out with these changes in (FilmingAccountControls sends the sheet along).
 *
 * The sheet is this browser's (localStorage: useStorySheet / writeStorySheet below): laying an account out again brings
 * the same changes back, which is the only way to go back to an earlier scene. "导出" saves it as a file for another laptop.
 *
 * The words on this panel are Chinese: it is the crew's own working sheet, and the crew reads Chinese. Only what
 * differs from the story is kept, so "N 处改动" is what the next layout really changes.
 */
import { useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  countStoryEdits,
  EMPTY_STORY_EDITS,
  storyEditsSchema,
  type BpEdit,
  type DoseEdit,
  type MedEdit,
  type SheetMissedReason,
  type StoryEdits,
  type StorySheetBase,
} from "@/lib/crew/story-edits";
import { dayOfDate, storyDate, weekdayIndex } from "@/lib/story/clock";

const WEEKDAY_ZH = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const ORIGIN_ZH: Record<string, string> = { prescription: "医生开的", self_bought: "自己买的", relative: "亲戚给的", supplement: "保健品" };

const FIELD = "min-h-11 rounded-lg border border-hair-2 bg-surface px-2 py-1.5 text-[17px] text-ink";
const CHANGED = "border-accent bg-accent-wash font-semibold";
const HEAD = "cursor-pointer py-2 text-[17px] font-semibold";

/** "9月22日 周二" for a day of the story. */
export function sheetDay(d0: string, day: number): string {
  const [, m, d] = storyDate(d0, day).split("-").map(Number);
  return `${m}月${d}日 ${WEEKDAY_ZH[weekdayIndex(d0, day)]}`;
}

/** The sheet as it is sent: notes and questions still empty are left out (the server refuses an empty sentence). */
export function sendableStoryEdits(edits: StoryEdits): StoryEdits {
  const notes = edits.notes ? { ...edits.notes, add: edits.notes.add?.filter((n) => n.text.trim()) } : undefined;
  const questions = edits.questions ? { ...edits.questions, add: edits.questions.add?.filter((q) => q.text.trim()) } : undefined;
  return { ...edits, ...(notes ? { notes } : {}), ...(questions ? { questions } : {}) };
}

// ---------------------------------------------------------------- where this browser keeps the sheet

const SHEET_KEY = "ripple.director.story-sheet.v1";
const SHEET_EVENT = "ripple:story-sheet";
/** the sheet as last written on this page: what a browser that keeps nothing still has until the page closes */
let lastWritten: string | null = null;

function rawSheet(): string {
  try {
    return window.localStorage.getItem(SHEET_KEY) ?? lastWritten ?? "";
  } catch {
    return lastWritten ?? "";
  }
}

function subscribeSheet(onChange: () => void): () => void {
  const storage = (e: StorageEvent) => {
    if (e.key === null || e.key === SHEET_KEY) onChange();
  };
  window.addEventListener(SHEET_EVENT, onChange);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(SHEET_EVENT, onChange);
    window.removeEventListener("storage", storage);
  };
}

/** Keep the sheet in this browser (every tab of /director follows). */
export function writeStorySheet(next: StoryEdits): void {
  lastWritten = JSON.stringify(next);
  try {
    window.localStorage.setItem(SHEET_KEY, lastWritten);
  } catch {
    // a browser that keeps nothing: the sheet lasts as long as this page
  }
  window.dispatchEvent(new Event(SHEET_EVENT));
}

/** This browser's story sheet, kept current; the story as it is on the server and when nothing usable is kept. */
export function useStorySheet(): StoryEdits {
  const raw = useSyncExternalStore(subscribeSheet, rawSheet, () => "");
  return useMemo(() => {
    if (!raw) return EMPTY_STORY_EDITS;
    try {
      const kept = JSON.parse(raw) as StoryEdits;
      // a note or a question added and not written yet stays on the sheet; what would be sent must be a sheet
      return kept && typeof kept === "object" && storyEditsSchema.safeParse(sendableStoryEdits(kept)).success ? kept : EMPTY_STORY_EDITS;
    } catch {
      return EMPTY_STORY_EDITS;
    }
  }, [raw]);
}

// ---------------------------------------------------------------- one morning's answer

type DoseChoice = "taken" | "missed" | `missed:${SheetMissedReason}` | "no_reply" | "none";

const DOSE_CHOICES: { value: DoseChoice; zh: string }[] = [
  { value: "taken", zh: "吃了" },
  { value: "missed:tai_chi_morning", zh: "没吃 · 打太极" },
  { value: "missed:forgot", zh: "没吃 · 忘了" },
  { value: "missed:away", zh: "没吃 · 出门了" },
  { value: "missed:not_with_me", zh: "没吃 · 药不在身边" },
  { value: "missed", zh: "没吃" },
  { value: "no_reply", zh: "两次提醒都没回" },
  { value: "none", zh: "不铺，留给他自己答" },
];

function doseChoice(state: string, reason: string | null | undefined): DoseChoice {
  if (state === "missed") return reason && reason !== "no_reply" ? (`missed:${reason}` as DoseChoice) : "missed";
  return state as DoseChoice;
}

function doseEdit(med: string, day: number, choice: DoseChoice): DoseEdit {
  if (choice.startsWith("missed:")) return { med, day, state: "missed", reason: choice.slice(7) as SheetMissedReason };
  return { med, day, state: choice as DoseEdit["state"] };
}

// ---------------------------------------------------------------- one reading, as the crew types it

/** "150/95" a reading, "没量" not measured, "" no record; null when it is none of these. */
export function parseReading(text: string): Pick<BpEdit, "state" | "systolic" | "diastolic"> | null {
  const s = text.trim();
  if (!s) return { state: "none" };
  if (s === "没量") return { state: "not_measured" };
  const m = /^(\d{2,3})\s*[/／ ]\s*(\d{2,3})$/.exec(s);
  if (!m) return null;
  const systolic = Number(m[1]);
  const diastolic = Number(m[2]);
  if (systolic < 60 || systolic > 260 || diastolic < 30 || diastolic > 160 || systolic <= diastolic) return null;
  return { state: "recorded", systolic, diastolic };
}

function readingText(b: { state: string; systolic?: number | null; diastolic?: number | null } | undefined): string {
  if (!b || b.state === "none") return "";
  return b.state === "recorded" ? `${b.systolic}/${b.diastolic}` : "没量";
}

// ---------------------------------------------------------------- the sheet

export function StorySheet({ base, edits, onChange }: { base: StorySheetBase; edits: StoryEdits; onChange: (next: StoryEdits) => void }) {
  const [note, setNote] = useState("");
  /** readings being typed that are not a reading yet: shown as typed, in red, and not on the sheet */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const file = useRef<HTMLInputElement>(null);
  const count = countStoryEdits(sendableStoryEdits(edits));
  const dayOptions = Array.from({ length: base.lastDay + 1 }, (_, d) => d);

  // medicines
  function setMed(id: string, patch: Pick<MedEdit, "present" | "label">) {
    const b = base.meds.find((m) => m.id === id);
    if (!b) return;
    const was = edits.meds?.find((m) => m.id === id);
    const present = patch.present ?? was?.present ?? true;
    const label = patch.label ?? was?.label ?? b.label ?? undefined;
    const entry: MedEdit = { id, ...(present ? {} : { present: false }), ...(label && label !== b.label ? { label } : {}) };
    const rest = (edits.meds ?? []).filter((m) => m.id !== id);
    onChange({ ...edits, meds: entry.present === false || entry.label ? [...rest, entry] : rest });
  }

  // doses
  function setDose(med: string, day: number, choice: DoseChoice, baseChoice: DoseChoice) {
    const rest = (edits.doses ?? []).filter((d) => !(d.med === med && d.day === day));
    onChange({ ...edits, doses: choice === baseChoice ? rest : [...rest, doseEdit(med, day, choice)] });
  }

  // readings
  function setReading(day: number, slot: "morning" | "evening", text: string, baseText: string) {
    const key = `${day}|${slot}`;
    const parsed = parseReading(text);
    if (!parsed) return setDrafts((d) => ({ ...d, [key]: text }));
    setDrafts((d) => {
      const others = { ...d };
      delete others[key];
      return others;
    });
    const rest = (edits.bp ?? []).filter((b) => !(b.day === day && b.slot === slot));
    onChange({ ...edits, bp: readingText(parsed) === baseText ? rest : [...rest, { day, slot, ...parsed }] });
  }

  // notes and questions: the story's own left out, and his own added
  function toggleHidden(kind: "notes" | "questions", id: string, keep: boolean) {
    const cur = edits[kind] ?? {};
    const hide = (cur.hide ?? []).filter((x) => x !== id);
    onChange({ ...edits, [kind]: { ...cur, hide: keep ? hide : [...hide, id] } });
  }
  function setAdded<K extends "notes" | "questions">(kind: K, add: NonNullable<NonNullable<StoryEdits[K]>["add"]>) {
    onChange({ ...edits, [kind]: { ...(edits[kind] ?? {}), add } });
  }

  function exportSheet() {
    const blob = new Blob([JSON.stringify(sendableStoryEdits(edits), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "ripple-story-sheet.json";
    a.click();
    URL.revokeObjectURL(a.href);
    setNote("已导出成文件 ripple-story-sheet.json。");
  }

  async function importSheet(f: File | undefined) {
    if (!f) return;
    try {
      const parsed = storyEditsSchema.safeParse(JSON.parse(await f.text()));
      if (!parsed.success) return setNote("这个文件不是故事表，没有导入。");
      onChange(parsed.data);
      setDrafts({});
      setNote(`已导入：${countStoryEdits(parsed.data)} 处改动。`);
    } catch {
      setNote("这个文件读不出来，没有导入。");
    }
  }

  const doseMeds = base.meds.filter((m) => m.origin === "prescription" && m.startDay !== null);
  const notesAdd = edits.notes?.add ?? [];
  const questionsAdd = edits.questions?.add ?? [];

  return (
    <section className="rp-card mt-5" data-testid="story-sheet" aria-labelledby="story-sheet-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="story-sheet-title" className="text-[16px] font-semibold uppercase tracking-wide text-ink-2">
          故事表 · Story sheet
        </h2>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="rp-btn rp-btn-ghost min-h-11 text-[17px]" onClick={exportSheet} data-testid="sheet-export">
            导出
          </button>
          <button type="button" className="rp-btn rp-btn-ghost min-h-11 text-[17px]" onClick={() => file.current?.click()} data-testid="sheet-import">
            导入
          </button>
          <input ref={file} type="file" accept="application/json,.json" hidden onChange={(e) => void importSheet(e.target.files?.[0])} />
          <button
            type="button"
            className="rp-btn rp-btn-ghost min-h-11 text-[17px]"
            disabled={count === 0 && Object.keys(drafts).length === 0}
            onClick={() => {
              onChange(EMPTY_STORY_EDITS);
              setDrafts({});
              setNote("已还原成陈先生原来的故事。");
            }}
            data-testid="sheet-reset"
          >
            全部还原
          </button>
        </div>
      </div>
      <p className="mt-1 text-[17px] text-ink-2">
        这里改的是陈先生故事里的细节。改完以后，下面每一次「Lay out to a scene」都会带着这些改动去铺；回到前面的场要重新铺，改动照样在。故事表只存在这台电脑的这个浏览器里，换电脑先「导出」。
      </p>
      <p className="mt-2 text-[18px] font-semibold" role="status" data-testid="sheet-count" data-count={count}>
        {count === 0 ? "现在没有改动：铺出来的是陈先生原来的故事。" : `现在有 ${count} 处改动，下一次铺的时候生效。`}
      </p>
      {note ? (
        <p className="mt-1 text-[17px] text-ink-2" role="status" data-testid="sheet-note">
          {note}
        </p>
      ) : null}

      <details className="mt-3 border-t border-hair-2" data-testid="sheet-meds">
        <summary className={HEAD}>药：在不在故事里，药袋读了没有</summary>
        <ul className="grid gap-2 pb-3">
          {base.meds.map((m) => {
            const e = edits.meds?.find((x) => x.id === m.id);
            const present = e?.present !== false;
            const label = e?.label ?? m.label;
            return (
              <li key={m.id} className={`flex flex-wrap items-center gap-3 rounded-xl border p-3 ${e ? CHANGED : "border-hair-2"}`} data-testid={`sheet-med-${m.id}`}>
                <span className="min-w-40 text-[17px]">
                  <span className="font-semibold">{m.name || "认不出的那盒药"}</span>
                  <span className="text-ink-2">
                    {" "}
                    · {ORIGIN_ZH[m.origin] ?? m.origin}
                    {m.startDay !== null ? ` · ${sheetDay(base.d0, m.startDay)}起` : ""}
                  </span>
                </span>
                <label className="flex min-h-11 items-center gap-2 text-[17px]">
                  <input type="checkbox" className="h-5 w-5" checked={present} onChange={(ev) => setMed(m.id, { present: ev.target.checked })} />
                  在故事里
                </label>
                {m.canAwait ? (
                  <label className="flex items-center gap-2 text-[17px]">
                    药袋
                    <select className={FIELD} value={label ?? "awaiting"} disabled={!present} onChange={(ev) => setMed(m.id, { label: ev.target.value as "confirmed" | "awaiting" })}>
                      <option value="confirmed" disabled={!m.canConfirm}>
                        已经读好了
                      </option>
                      <option value="awaiting">等他自己拍</option>
                    </select>
                  </label>
                ) : null}
              </li>
            );
          })}
        </ul>
        <p className="pb-3 text-[16px] text-ink-2">
          要拍「拍药袋」那一场，把那种药改成「等他自己拍」再铺。药袋上的字不在这里改：道具药袋印的是什么，他拍出来就是什么。
        </p>
      </details>

      <details className="border-t border-hair-2" data-testid="sheet-doses">
        <summary className={HEAD}>每天早上的药：吃了没有</summary>
        {doseMeds.map((m) => (
          <div key={m.id} className="pb-3">
            <p className="text-[17px] font-semibold">{m.name}</p>
            <ol className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-2">
              {dayOptions
                .filter((d) => d >= (m.startDay ?? 0))
                .map((d) => {
                  const b = base.doses.find((x) => x.med === m.id && x.day === d);
                  const baseChoice: DoseChoice = b ? doseChoice(b.state, b.reason) : "none";
                  const e = edits.doses?.find((x) => x.med === m.id && x.day === d);
                  const choice: DoseChoice = e ? doseChoice(e.state, e.reason) : baseChoice;
                  return (
                    <li key={d}>
                      <label className="flex flex-col text-[16px] text-ink-2">
                        {sheetDay(base.d0, d)}
                        <select
                          className={`${FIELD} mt-1 ${e ? CHANGED : ""}`}
                          value={choice}
                          onChange={(ev) => setDose(m.id, d, ev.target.value as DoseChoice, baseChoice)}
                          data-testid={`sheet-dose-${m.id}-${d}`}
                        >
                          {DOSE_CHOICES.map((c) => (
                            <option key={c.value} value={c.value}>
                              {c.zh}
                            </option>
                          ))}
                        </select>
                      </label>
                    </li>
                  );
                })}
            </ol>
          </div>
        ))}
        <p className="pb-3 text-[16px] text-ink-2">某一天要到那天的提醒时间过了（早上 9:45）才会出现在他的手机上。问题单里「打太极的早上常忘记吃」那一条，会跟着这里漏掉的日子重新算。</p>
      </details>

      <details className="border-t border-hair-2" data-testid="sheet-bp">
        <summary className={HEAD}>血压读数</summary>
        <p className="text-[16px] text-ink-2">写成 150/95；写「没量」是那一次没量；留空是没有这一条。</p>
        <ol className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(19rem,1fr))] gap-x-4 gap-y-1 pb-3">
          {dayOptions.map((d) => (
            <li key={d} className="flex items-center gap-2">
              <span className="w-28 shrink-0 text-[16px] text-ink-2">{sheetDay(base.d0, d)}</span>
              {(["morning", "evening"] as const).map((slot) => {
                const key = `${d}|${slot}`;
                const baseText = readingText(base.bp.find((x) => x.day === d && x.slot === slot));
                const e = edits.bp?.find((x) => x.day === d && x.slot === slot);
                const draft = drafts[key];
                return (
                  <input
                    key={slot}
                    className={`${FIELD} w-24 ${draft !== undefined ? "border-[#b3261e]" : e ? CHANGED : ""}`}
                    aria-label={`${sheetDay(base.d0, d)} ${slot === "morning" ? "早上" : "晚上"}`}
                    aria-invalid={draft !== undefined}
                    placeholder={slot === "morning" ? "早上" : "晚上"}
                    value={draft ?? (e ? readingText(e) : baseText)}
                    onChange={(ev) => setReading(d, slot, ev.target.value, baseText)}
                    data-testid={`sheet-bp-${d}-${slot}`}
                  />
                );
              })}
            </li>
          ))}
        </ol>
        <p className="pb-3 text-[16px] text-ink-2">红框的是还没写成一条读数的（要像 150/95，前一个数比后一个大），不会算进改动。</p>
      </details>

      <details className="border-t border-hair-2" data-testid="sheet-notes">
        <summary className={HEAD}>他自己记的笔记</summary>
        <ul className="grid gap-2 pb-3">
          {base.notes.map((n) => {
            const hidden = edits.notes?.hide?.includes(n.id) ?? false;
            return (
              <li key={n.id} className={`flex flex-wrap items-center gap-3 rounded-xl border p-3 ${hidden ? CHANGED : "border-hair-2"}`}>
                <label className="flex min-h-11 items-center gap-2 text-[17px]">
                  <input type="checkbox" className="h-5 w-5" checked={!hidden} onChange={(ev) => toggleHidden("notes", n.id, ev.target.checked)} data-testid={`sheet-note-keep-${n.id}`} />
                  留着
                </label>
                <span className="text-[16px] text-ink-2">{sheetDay(base.d0, n.day)}</span>
                <span className={`text-[17px] ${hidden ? "line-through text-ink-2" : ""}`}>{n.text}</span>
              </li>
            );
          })}
          {notesAdd.map((n, i) => (
            <li key={i} className={`flex flex-wrap items-center gap-2 rounded-xl border p-3 ${CHANGED}`}>
              <input
                type="date"
                className={FIELD}
                aria-label="哪一天"
                min={storyDate(base.d0, 0)}
                max={storyDate(base.d0, base.lastDay)}
                value={storyDate(base.d0, n.day)}
                onChange={(ev) => {
                  const d = dayOfDate(base.d0, ev.target.value);
                  if (Number.isInteger(d) && d >= 0 && d <= base.lastDay) setAdded("notes", notesAdd.map((x, j) => (j === i ? { ...x, day: d } : x)));
                }}
              />
              <input
                className={`${FIELD} min-w-64 flex-1`}
                aria-label="他写的话"
                placeholder="他自己写的话"
                maxLength={200}
                value={n.text}
                onChange={(ev) => setAdded("notes", notesAdd.map((x, j) => (j === i ? { ...x, text: ev.target.value } : x)))}
                data-testid={`sheet-note-text-${i}`}
              />
              <button type="button" className="rp-btn rp-btn-ghost min-h-11 text-[17px]" onClick={() => setAdded("notes", notesAdd.filter((_, j) => j !== i))}>
                删掉
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="rp-btn rp-btn-ghost mb-3 min-h-11 text-[17px]" onClick={() => setAdded("notes", [...notesAdd, { day: 20, text: "" }])} data-testid="sheet-note-add">
          加一条笔记
        </button>
        <p className="pb-3 text-[16px] text-ink-2">笔记是他自己的话。哪一天的笔记，那天傍晚 6 点以后才在。</p>
      </details>

      <details className="border-t border-hair-2" data-testid="sheet-questions">
        <summary className={HEAD}>问题单</summary>
        <ul className="grid gap-2 pb-3">
          {base.questions.map((q) => {
            const hidden = edits.questions?.hide?.includes(q.id) ?? false;
            return (
              <li key={q.id} className={`flex flex-wrap items-center gap-3 rounded-xl border p-3 ${hidden ? CHANGED : "border-hair-2"}`}>
                <label className="flex min-h-11 items-center gap-2 text-[17px]">
                  <input type="checkbox" className="h-5 w-5" checked={!hidden} onChange={(ev) => toggleHidden("questions", q.id, ev.target.checked)} data-testid={`sheet-question-keep-${q.id}`} />
                  留着
                </label>
                <span className="text-[16px] text-ink-2">
                  {q.day !== null ? sheetDay(base.d0, q.day) : ""} · {q.for === "pharmacist" ? "问药剂师" : "问医生"}
                  {q.answered ? " · 后来有人答了" : ""}
                </span>
                <span className={`text-[17px] ${hidden ? "line-through text-ink-2" : ""}`}>{q.text}</span>
              </li>
            );
          })}
          {questionsAdd.map((q, i) => (
            <li key={i} className={`flex flex-wrap items-center gap-2 rounded-xl border p-3 ${CHANGED}`}>
              <input
                type="date"
                className={FIELD}
                aria-label="哪一天"
                min={storyDate(base.d0, 0)}
                max={storyDate(base.d0, base.lastDay)}
                value={storyDate(base.d0, q.day)}
                onChange={(ev) => {
                  const d = dayOfDate(base.d0, ev.target.value);
                  if (Number.isInteger(d) && d >= 0 && d <= base.lastDay) setAdded("questions", questionsAdd.map((x, j) => (j === i ? { ...x, day: d } : x)));
                }}
              />
              <select
                className={FIELD}
                aria-label="问谁"
                value={q.for ?? "doctor"}
                onChange={(ev) => setAdded("questions", questionsAdd.map((x, j) => (j === i ? { ...x, for: ev.target.value as "doctor" | "pharmacist" } : x)))}
              >
                <option value="doctor">问医生</option>
                <option value="pharmacist">问药剂师</option>
              </select>
              <input
                className={`${FIELD} min-w-64 flex-1`}
                aria-label="他要问的话"
                placeholder="他要问的话"
                maxLength={200}
                value={q.text}
                onChange={(ev) => setAdded("questions", questionsAdd.map((x, j) => (j === i ? { ...x, text: ev.target.value } : x)))}
                data-testid={`sheet-question-text-${i}`}
              />
              <button type="button" className="rp-btn rp-btn-ghost min-h-11 text-[17px]" onClick={() => setAdded("questions", questionsAdd.filter((_, j) => j !== i))}>
                删掉
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="rp-btn rp-btn-ghost mb-3 min-h-11 text-[17px]" onClick={() => setAdded("questions", [...questionsAdd, { day: 30, text: "" }])} data-testid="sheet-question-add">
          加一个他自己的问题
        </button>
        <p className="pb-3 text-[16px] text-ink-2">加的问题是他自己问的、还没人答的。医生的回答只在录好的看诊里，这里加不了。哪一天的问题，那天晚上 8:15 以后才在。</p>
      </details>
    </section>
  );
}
