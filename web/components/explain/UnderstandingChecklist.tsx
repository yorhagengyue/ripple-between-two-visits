"use client";

/**
 * The understanding checklist (task M5 item 4): four items, each answered by him with 知道 / 不确定. 不确定 puts the
 * item on his question list for the next visit (POST /api/understanding; one question per item, never twice).
 * Nobody scores him: no right / wrong wording, no model. Every answer is kept (C2), so after a reload the checklist
 * shows what he said, 知道 too.
 */
import Link from "next/link";
import { useState } from "react";
import { useLiveSession } from "@/components/live/LiveSession";
import { et, itemLabel } from "@/lib/explain/i18n";
import { UNDERSTANDING_ITEMS, type UnderstandingAnswer, type UnderstandingItem, type UnderstandingView } from "@/lib/explain/types";
import type { Locale } from "@/lib/i18n";
import { postJson } from "@/lib/session/client";

interface ItemState {
  answer: UnderstandingAnswer | null;
  questionId: string | null;
}

type State = Record<UnderstandingItem, ItemState>;

function fromView(view: UnderstandingView): State {
  const out = {} as State;
  for (const id of UNDERSTANDING_ITEMS) {
    const v = view.items.find((i) => i.id === id);
    out[id] = { answer: v?.answer ?? (v?.questionId ? "unsure" : null), questionId: v?.questionId ?? null };
  }
  return out;
}

export function UnderstandingChecklist({ medId, locale, initial }: { medId: string; locale: Locale; initial: UnderstandingView }) {
  const { session } = useLiveSession();
  const [state, setState] = useState<State>(() => fromView(initial));
  const [busy, setBusy] = useState<UnderstandingItem | null>(null);
  const [failed, setFailed] = useState(false);

  async function answer(item: UnderstandingItem, value: UnderstandingAnswer) {
    if (busy) return;
    setBusy(item);
    setFailed(false);
    try {
      const out = await postJson<{ question: { id: string } | null }>("/api/understanding", session.id, { med_id: medId, item, answer: value, locale });
      setState((prev) => ({ ...prev, [item]: { answer: value, questionId: out.question?.id ?? prev[item].questionId } }));
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rp-card flex flex-col gap-3" data-testid="understanding-checklist" data-med={medId} aria-labelledby="understanding-title">
      <h2 id="understanding-title" className="text-[22px] font-bold">
        {et(locale, "check.title")}
      </h2>
      <p className="text-ink-2">{et(locale, "check.intro")}</p>
      <ol className="flex flex-col gap-3">
        {UNDERSTANDING_ITEMS.map((id) => {
          const s = state[id];
          return (
            <li key={id} className="flex flex-col gap-2 border-t border-hair pt-3 first:border-t-0 first:pt-0" data-testid={`check-${id}`} data-answer={s.answer ?? "none"}>
              <p className="font-semibold" data-testid={`check-${id}-label`}>
                {itemLabel(locale, id)}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rp-btn rp-btn-ghost min-h-12 flex-1 aria-pressed:bg-accent aria-pressed:text-on-accent"
                  aria-pressed={s.answer === "know"}
                  disabled={busy !== null}
                  onClick={() => void answer(id, "know")}
                  data-testid={`check-${id}-know`}
                >
                  {et(locale, "check.know")}
                </button>
                <button
                  type="button"
                  className="rp-btn rp-btn-ghost min-h-12 flex-1 aria-pressed:bg-accent aria-pressed:text-on-accent"
                  aria-pressed={s.answer === "unsure"}
                  disabled={busy !== null}
                  onClick={() => void answer(id, "unsure")}
                  data-testid={`check-${id}-unsure`}
                >
                  {et(locale, "check.unsure")}
                </button>
              </div>
              {s.questionId ? (
                <Link href="/p/questions" className="text-ink-2 underline underline-offset-2" data-testid={`check-${id}-on-list`} data-question={s.questionId}>
                  {et(locale, "check.onList")} →
                </Link>
              ) : s.answer === "know" ? (
                <p className="text-ink-2" data-testid={`check-${id}-noted`}>
                  {et(locale, "check.noted")}
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>
      {failed ? (
        <p className="text-ink-2" role="alert" data-testid="check-failed">
          {et(locale, "check.failed")}
        </p>
      ) : null}
    </section>
  );
}
