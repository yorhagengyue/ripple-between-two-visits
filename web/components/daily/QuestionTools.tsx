"use client";

/**
 * His question list on the demo can be changed by him (C2 follow-up, track E; real-app 12 「问题单不能加、删、标『问过了』；
 * 同一个问题两条」): 「加一个问题」 above the list, and on each waiting question in his own words 「改一下」 and 「不问了」; a
 * question he set aside has 「放回去」. Through the same routes as an account's list (track C: POST /api/questions,
 * PATCH /api/questions/[id]); the same words asked twice are one row (the route merges them and this says so). The page
 * reads the list again when the change arrives (question.created / question.updated). Every word of a question is his
 * own; a doctor's answer stays with the words it answered (the route refuses to change those).
 */
import { useState } from "react";
import { useLiveSession } from "@/components/live/LiveSession";
import { demoText, type DemoKey } from "@/lib/crew/demo-copy";
import type { Locale } from "@/lib/i18n";
import { withSession } from "@/lib/session/client";

async function call(url: string, method: "POST" | "PATCH", body: unknown): Promise<{ ok: boolean; status: number; data: { outcome?: string; error?: string } }> {
  try {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body) });
    return { ok: res.ok, status: res.status, data: (await res.json().catch(() => ({}))) as { outcome?: string; error?: string } };
  } catch {
    return { ok: false, status: 0, data: {} };
  }
}

const OUTCOME: Record<string, DemoKey> = { created: "q.add.created", merged: "q.add.merged", reopened: "q.add.reopened", answered: "q.add.answered" };

/** 「加一个问题」: one sentence in his own words, for the doctor or the pharmacist. */
export function AddQuestion({ locale }: { locale: Locale }) {
  const { session } = useLiveSession();
  const [text, setText] = useState("");
  const [who, setWho] = useState<"doctor" | "pharmacist">("doctor");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<DemoKey | null>(null);

  async function add() {
    const words = text.trim();
    if (!words || busy) return;
    setBusy(true);
    setNote(null);
    const r = await call(withSession("/api/questions", session.id), "POST", { text: words, for: who });
    setBusy(false);
    if (!r.ok) return setNote("q.failed");
    setText("");
    setNote(OUTCOME[r.data.outcome ?? "created"] ?? "q.add.created");
  }

  return (
    <form
      className="rp-card flex flex-col gap-2"
      data-testid="question-add"
      onSubmit={(e) => {
        e.preventDefault();
        void add();
      }}
    >
      <label className="text-[20px] font-bold" htmlFor="question-add-input">
        {demoText(locale, "q.add.title")}
      </label>
      <input
        id="question-add-input"
        className="min-h-14 w-full rounded-xl border border-hair-2 bg-surface px-3 text-body"
        value={text}
        maxLength={300}
        onChange={(e) => setText(e.target.value)}
        placeholder={demoText(locale, "q.add.placeholder")}
        data-testid="question-add-input"
      />
      <div className="flex flex-wrap gap-2" role="group" aria-label={demoText(locale, "q.add.who")}>
        {(["doctor", "pharmacist"] as const).map((w) => (
          <button key={w} type="button" className={`rp-btn min-h-12 px-4 ${who === w ? "rp-btn-accent" : "rp-btn-ghost"}`} aria-pressed={who === w} onClick={() => setWho(w)} data-testid={`question-add-for-${w}`}>
            {demoText(locale, w === "doctor" ? "q.add.doctor" : "q.add.pharmacist")}
          </button>
        ))}
        <button type="submit" className="rp-btn rp-btn-accent min-h-12 px-4" disabled={busy || !text.trim()} data-testid="question-add-save">
          {demoText(locale, "q.add.save")}
        </button>
      </div>
      {note ? (
        <p className="text-body text-ink-2" role="status" data-testid="question-add-note" data-note={note}>
          {demoText(locale, note)}
        </p>
      ) : null}
    </form>
  );
}

/**
 * Under one question: 「改一下」 and 「不问了」 while it waits (his own words only: a pattern question's wording is
 * Ripple's and a recorded summary is not his to rewrite), 「放回去」 once he set it aside.
 */
export function QuestionActions({ id, text, status, ownWords, locale }: { id: string; text: string; status: "open" | "answered" | "skipped"; ownWords: boolean; locale: Locale }) {
  const { session } = useLiveSession();
  const [editing, setEditing] = useState(false);
  const [words, setWords] = useState(text);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  if (status === "answered") return null;

  async function patch(body: unknown): Promise<boolean> {
    setBusy(true);
    setFailed(false);
    const r = await call(withSession(`/api/questions/${encodeURIComponent(id)}`, session.id), "PATCH", body);
    setBusy(false);
    if (!r.ok) setFailed(true);
    return r.ok;
  }

  return (
    <div className="mt-2 flex flex-col gap-2" data-testid="question-actions" data-question={id}>
      {editing ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void (async () => {
              if (words.trim() && (await patch({ text: words.trim() }))) setEditing(false);
            })();
          }}
        >
          <input className="min-h-14 w-full rounded-xl border border-hair-2 bg-surface px-3 text-body" value={words} maxLength={300} onChange={(e) => setWords(e.target.value)} aria-label={demoText(locale, "q.edit")} data-testid="question-edit-input" />
          <div className="flex gap-2">
            <button type="submit" className="rp-btn rp-btn-accent min-h-12 px-4" disabled={busy || !words.trim()} data-testid="question-edit-save">
              {demoText(locale, "q.edit.save")}
            </button>
            <button type="button" className="rp-btn rp-btn-ghost min-h-12 px-4" disabled={busy} onClick={() => setEditing(false)} data-testid="question-edit-cancel">
              {demoText(locale, "bp.cancel")}
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          {status === "open" && ownWords ? (
            <button
              type="button"
              className="rp-btn rp-btn-ghost min-h-12 px-4"
              disabled={busy}
              onClick={() => {
                setWords(text);
                setEditing(true);
              }}
              data-testid="question-edit"
            >
              {demoText(locale, "q.edit")}
            </button>
          ) : null}
          {status === "open" ? (
            <button type="button" className="rp-btn rp-btn-ghost min-h-12 px-4" disabled={busy} onClick={() => void patch({ status: "skipped" })} data-testid="question-skip">
              {demoText(locale, "q.skip")}
            </button>
          ) : (
            <button type="button" className="rp-btn rp-btn-ghost min-h-12 px-4" disabled={busy} onClick={() => void patch({ status: "open" })} data-testid="question-reopen">
              {demoText(locale, "q.reopen")}
            </button>
          )}
        </div>
      )}
      {failed ? (
        <p className="text-body text-ink-2" role="alert" data-testid="question-actions-failed">
          {demoText(locale, "q.failed")}
        </p>
      ) : null}
    </div>
  );
}
