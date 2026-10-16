"use client";

/**
 * 「问这个」 on a medicine card: his question goes to POST /api/ask with this medicine selected, and the answer is
 * shown exactly as lib/safety returned it, each sentence with its source chip. Nothing is written here; the three
 * quick questions are his questions, not answers.
 */
import { useState } from "react";
import { useLiveSession } from "@/components/live/LiveSession";
import type { Locale } from "@/lib/i18n";
import { chipDetailText, chipFromSentence, chipKindText, sentenceShown } from "@/lib/meds/chips";
import { mt, type MedsKey } from "@/lib/meds/i18n";
import type { AskResult } from "@/lib/safety/types";
import { ApiError, postJson } from "@/lib/session/client";
import { cx } from "./classes";

const QUICK: MedsKey[] = ["ask.purpose", "ask.missed", "ask.together"];

export function AskThis({ medId, locale }: { medId: string; locale: Locale }) {
  const { session } = useLiveSession();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [asked, setAsked] = useState<string | null>(null);
  const [result, setResult] = useState<AskResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true);
    setError(null);
    setAsked(q);
    try {
      setResult(await postJson<AskResult>("/api/ask", session.id, { text: q, locale, role: "patient", medIds: [medId] }));
      setText("");
    } catch (e) {
      setResult(null);
      setError(mt(locale, e instanceof ApiError && e.status === 429 ? "ask.limit" : "ask.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rp-card flex flex-col gap-3" data-testid="ask-this">
      <h2 className="text-[20px] font-bold">{mt(locale, "ask.title")}</h2>
      <div className="flex flex-col gap-2">
        {QUICK.map((key, i) => (
          <button key={key} type="button" className="rp-btn rp-btn-ghost text-left" disabled={busy} data-testid={`ask-quick-${i}`} onClick={() => void send(mt(locale, key))}>
            {mt(locale, key)}
          </button>
        ))}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
      >
        <input
          className={cx.input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={mt(locale, "ask.placeholder")}
          aria-label={mt(locale, "ask.placeholder")}
          maxLength={500}
          data-testid="ask-input"
        />
        <button type="submit" className="rp-btn rp-btn-accent flex-none" disabled={busy || !text.trim()} data-testid="ask-send">
          {busy ? mt(locale, "ask.sending") : mt(locale, "ask.send")}
        </button>
      </form>
      {error ? (
        <p className="text-ink-2" role="alert" data-testid="ask-error">
          {error}
        </p>
      ) : null}
      {result ? (
        <div className="flex flex-col gap-2" data-testid="ask-result" data-route={result.route}>
          {asked ? <p className="font-semibold">“{asked}”</p> : null}
          {result.sentences.map((s, i) => {
            const chip = chipFromSentence(s);
            const detail = chipDetailText(locale, chip);
            return (
              <div key={i} className={`rp-card ${chip.kind === "doctor" ? "rp-card-doc" : ""}`} data-testid="ask-sentence" data-chip={chip.kind}>
                <div className="rp-tag">● {chipKindText(locale, chip)}</div>
                <p className={`${cx.lineText} mt-1.5`}>{sentenceShown(s, locale)}</p>
                {detail ? <div className="rp-src">{detail}</div> : null}
              </div>
            );
          })}
          {result.addedQuestionId ? (
            <div className="rp-qlist px-4 py-3" data-testid="ask-question-added">
              <span className="rp-qt">{mt(locale, "ask.added")}</span>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
