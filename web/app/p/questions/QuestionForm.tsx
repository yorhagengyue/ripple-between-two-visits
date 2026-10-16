"use client";

/**
 * 「加一个问题」 and 「改一下字」 (track C), in the timeline design: his words in one tall field under its name; who to
 * ask (doctor or pharmacist, adding only) as a segmented control; a problem in red under them; one filled button in
 * the lower half. The way out without saving is the header's back (the page's; 「不加了」 and 「不改了」 under the button
 * did the same and are gone: owner's tidy of 10-13). Adding goes to POST /api/questions, changing to PATCH
 * /api/questions/[id]; then back to the list, which says what happened (加上了 / 已经在单子上了 / 医生回答过了). Nothing is
 * asked of a model here.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ActionDock } from "@/components/ui/Screen";
import { PrimaryButton } from "@/components/ui/Buttons";
import { sendJson } from "@/lib/profile/client";
import { questionsCopy, type CLocale } from "@/lib/profile/copy";
import "./questions.css";

const MAX = 300;

export function QuestionForm({
  mode,
  locale,
  id,
  initial,
  who: initialWho = "doctor",
}: {
  mode: "add" | "edit";
  locale: CLocale;
  id?: string;
  initial?: string;
  /** adding: the side of the list he came from (问医生 unless he was on 问药剂师) */
  who?: "doctor" | "pharmacist";
}) {
  const c = questionsCopy(locale);
  const router = useRouter();
  const [text, setText] = useState(initial ?? "");
  const [who, setWho] = useState<"doctor" | "pharmacist">(initialWho);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const tooLong = [...text].length > MAX;

  async function submit() {
    if (busy) return;
    const words = text.trim();
    if (!words) return setProblem(c.empty);
    if (tooLong) return setProblem(c.tooLong);
    setBusy(true);
    setProblem(null);
    if (mode === "add") {
      const r = await sendJson<{ question: { id: string }; outcome: string }>("POST", "/api/questions", { text: words, for: who });
      if (!r.ok) {
        setBusy(false);
        return setProblem(r.data.error === "text_too_long" ? c.tooLong : c.failed);
      }
      const q = encodeURIComponent(r.data.question.id);
      router.push(r.data.outcome === "answered" ? `/p/questions/answered?q=${q}` : `/p/questions?added=${r.data.outcome}&q=${q}`);
      router.refresh();
      return;
    }
    const r = await sendJson("PATCH", `/api/questions/${encodeURIComponent(id!)}`, { text: words });
    if (!r.ok) {
      setBusy(false);
      return setProblem(r.data.error === "text_too_long" ? c.tooLong : c.failed);
    }
    router.push(`/p/questions?added=edited&q=${encodeURIComponent(id!)}`);
    router.refresh();
  }

  return (
    <form
      className="rpu rp14q-form"
      data-rp="question-form"
      data-mode={mode}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="rpu-stack">
        <div className="rpu rpu-f" data-rp="field">
          <label className="rpu-f-label" htmlFor="rpc-question-text">
            {c.yourQuestion}
          </label>
          <textarea
            id="rpc-question-text"
            className="rpu-field-input rp14q-textarea"
            data-testid="question-text-input"
            value={text}
            rows={3}
            placeholder={c.placeholder}
            onChange={(e) => {
              setText(e.target.value);
              // what was wrong is said once; it goes when he writes again
              setProblem(null);
            }}
            aria-invalid={tooLong || undefined}
          />
        </div>
        {mode === "add" && (
          <div className="rpu rpu-f" role="group" aria-labelledby="rpc-question-who">
            <span className="rpu-f-label" id="rpc-question-who">
              {c.whoToAsk}
            </span>
            <div className="rpu rpu-seg" data-rp="segmented" style={{ ["--rpu-cols" as string]: 2 }}>
              {(["doctor", "pharmacist"] as const).map((w) => (
                <button key={w} type="button" className="rpu-seg-item" data-who={w} aria-pressed={who === w} onClick={() => setWho(w)}>
                  {w === "doctor" ? c.doctor : c.pharmacist}
                </button>
              ))}
            </div>
          </div>
        )}
        {problem && (
          <p role="alert" className="rpu-f-error" data-rp="form-problem">
            {problem}
          </p>
        )}
      </div>
      <ActionDock>
        <PrimaryButton type="submit" pending={busy} data-testid="question-submit">
          {mode === "add" ? c.addIt : c.save}
        </PrimaryButton>
      </ActionDock>
    </form>
  );
}
