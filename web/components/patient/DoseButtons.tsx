"use client";

/**
 * The three answers to "did you take it?" — 吃了 / 没吃 / 等下 (spec: taken / missed / later).
 * "Later" is recorded as unconfirmed with reason "later"; a later "taken" replaces it.
 * The question itself is a check-in, which never-cross allows; no advice is attached.
 */
import { t, type Locale } from "@/lib/i18n";
import type { DoseState } from "@/lib/store/types";

export type DoseAnswer = "taken" | "missed" | "later";

export function answerToState(answer: DoseAnswer): { state: DoseState; reason: string | null } {
  return answer === "later" ? { state: "unconfirmed", reason: "later" } : { state: answer, reason: null };
}

export function stateLabel(locale: Locale, state: DoseState | null): string {
  if (state === null) return t(locale, "dose.notYet");
  return t(locale, state === "taken" ? "dose.taken" : state === "missed" ? "dose.missed" : "dose.unconfirmed");
}

const ANSWERS: { answer: DoseAnswer; key: "dose.taken" | "dose.missed" | "dose.later"; cls: string }[] = [
  { answer: "taken", key: "dose.taken", cls: "rp-btn-accent" },
  { answer: "missed", key: "dose.missed", cls: "rp-btn-ghost" },
  { answer: "later", key: "dose.later", cls: "rp-btn-ghost" },
];

export function DoseButtons({
  locale,
  current,
  testIdPrefix,
  disabled = false,
  onAnswer,
}: {
  locale: Locale;
  current: DoseState | null;
  testIdPrefix: string;
  disabled?: boolean;
  onAnswer(answer: DoseAnswer): void;
}) {
  return (
    <div className="mt-3 grid grid-cols-3 gap-2">
      {ANSWERS.map(({ answer, key, cls }) => {
        const pressed = current !== null && answerToState(answer).state === current;
        return (
          <button
            key={answer}
            type="button"
            className={`rp-btn ${cls} min-h-14 ${pressed ? "ring-2 ring-ink/40" : ""}`}
            aria-pressed={pressed}
            disabled={disabled}
            data-testid={`${testIdPrefix}-${answer}`}
            onClick={() => onAnswer(answer)}
          >
            {t(locale, key)}
          </button>
        );
      })}
    </div>
  );
}
