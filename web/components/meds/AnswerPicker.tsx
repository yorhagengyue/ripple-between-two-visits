"use client";

/**
 * Lines from a later visit recording that may answer this medicine's question (the pharmacist at D12). Each line
 * is shown word for word with its recording date and time point; he picks the one that answered it, then names
 * who said it (web-app.md section 8: a medication sentence only becomes "the pharmacist said" when he confirms it,
 * never by inference). A line whose clinician role he already confirmed in the post-visit review is saved at once.
 * "Not sure" saves the line with nobody named: its chip reads "recording", and an instruction stays hidden by
 * lib/safety. POST /api/meds/[id]/answer.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useLiveSession } from "@/components/live/LiveSession";
import type { Locale } from "@/lib/i18n";
import { chipDetailText, chipKindText } from "@/lib/meds/chips";
import { mt } from "@/lib/meds/i18n";
import type { AnswerChoice, AnswerSpeaker, CardChip } from "@/lib/meds/types";
import { postJson } from "@/lib/session/client";
import { cx } from "./classes";

const keyOf = (c: AnswerChoice) => `${c.visitId}:${c.utteranceId}`;

export function AnswerPicker({ medId, choices, locale }: { medId: string; choices: AnswerChoice[]; locale: Locale }) {
  const { session } = useLiveSession();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  async function save(c: AnswerChoice, speaker: AnswerSpeaker | null) {
    setBusy(keyOf(c));
    setFailed(false);
    try {
      await postJson(`/api/meds/${encodeURIComponent(medId)}/answer`, session.id, { visit_id: c.visitId, utterance_id: c.utteranceId, speaker });
      setPicked(null);
      router.refresh();
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  }

  function pick(c: AnswerChoice) {
    if (c.speaker) void save(c, c.speaker); // he confirmed who said it in the post-visit review
    else setPicked(keyOf(c));
  }

  return (
    <div className="flex flex-col gap-2" data-testid="answer-picker">
      <p className="font-semibold">{mt(locale, "card.pickAnswer")}</p>
      {choices.map((c) => {
        const key = keyOf(c);
        const chip: CardChip = { kind: c.speaker ?? "recording", date: c.visitDate, tStartMs: c.tStartMs };
        const naming = picked === key;
        return (
          <div key={key} className="rp-card" data-testid="answer-choice" data-utterance={c.utteranceId} data-chip={chip.kind}>
            <div className="rp-tag">● {chipKindText(locale, chip)}</div>
            <p className={`${cx.lineText} mt-1.5`}>{c.text}</p>
            <div className="rp-src">{chipDetailText(locale, chip)}</div>
            {naming ? (
              <div className="mt-2 flex flex-col gap-2" data-testid="answer-speaker" data-utterance={c.utteranceId}>
                <p className="font-semibold">{mt(locale, "card.whoSaid")}</p>
                {c.speakerOptions.map((role) => (
                  <button
                    key={role}
                    type="button"
                    className="rp-btn rp-btn-ghost"
                    disabled={busy !== null}
                    data-testid={`answer-speaker-${role}`}
                    onClick={() => void save(c, role)}
                  >
                    {mt(locale, `speaker.${role}`)}
                  </button>
                ))}
                <button type="button" className="rp-btn rp-btn-ghost" disabled={busy !== null} data-testid="answer-speaker-unsure" onClick={() => void save(c, null)}>
                  {mt(locale, "speaker.unsure")}
                </button>
                {busy === key ? <p className="text-ink-2">{mt(locale, "card.linking")}</p> : null}
              </div>
            ) : (
              <button
                type="button"
                className="rp-btn rp-btn-ghost mt-2"
                disabled={busy !== null}
                data-testid={`answer-pick-${c.utteranceId}`}
                onClick={() => pick(c)}
              >
                {busy === key ? mt(locale, "card.linking") : mt(locale, "card.thisIsAnswer")}
              </button>
            )}
          </div>
        );
      })}
      {failed ? <p className="text-ink-2">{mt(locale, "add.failed")}</p> : null}
    </div>
  );
}
