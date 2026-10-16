"use client";

/**
 * What a family member wrote, waiting for him (M11; track C), one at a time, as the timeline draft's 01-6: 「第 1 项，共 3 项」,
 * the fact on a line of its own under her node (「Wei Ling 写了：」, the words large, the tag 「等你确认」), 「对吗？」, and the
 * three answers side by side in the dock. 对 confirms it; 改一下 opens his own words in a field (改好了 confirms those,
 * 不改了 puts the three answers back); 不对 hides it (kept for the record, never used).
 * PATCH /api/profile/facts/[id]; then the next one, and after the last one the page shows his profile.
 */
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Box, ButtonRow, Field, LoadingState, PrimaryButton, SecondaryButton, StatusHeadline, Tag, Timeline, TimelineItem, TlControls } from "@/components/ui";
import { sendJson } from "@/lib/profile/client";
import { onboardCopy, profileCopy, type CLocale } from "@/lib/profile/copy";
import { setupCopy } from "@/lib/profile/setup-copy";
import "@/app/onboard/[step]/onboard.css";

export interface WaitingFact {
  id: string;
  text: string;
  /** who wrote it, as his screens name her (「Wei Ling」, 「家人」) */
  who: string;
}

/**
 * One fact and its answers. `onAnswered` is called once his answer is saved (the list then moves on); without it the
 * page's data is read again.
 */
export function ConfirmFact({ id, text, who, locale, onAnswered }: WaitingFact & { locale: CLocale; onAnswered?: () => void }) {
  const c = profileCopy(locale);
  const o = onboardCopy(locale);
  const router = useRouter();
  const formId = useId();
  const [editing, setEditing] = useState(false);
  const [words, setWords] = useState(text);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function answer(body: Record<string, unknown>) {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    const r = await sendJson("PATCH", `/api/profile/facts/${encodeURIComponent(id)}`, body);
    if (!r.ok) {
      setBusy(false);
      setFailed(true);
      return;
    }
    if (onAnswered) onAnswered();
    else router.refresh();
  }

  return (
    <div className="rpo-confirm" data-rp="confirm-fact" data-fact={id}>
      <Timeline>
        <TimelineItem
          node="dau"
          who={c.wrote(who)}
          title={text}
          titleSize="big"
          actions={
            <TlControls>
              <Tag>{o.donePending}</Tag>
            </TlControls>
          }
        />
      </Timeline>
      {editing ? (
        <form
          id={formId}
          onSubmit={(e) => {
            e.preventDefault();
            if (words.trim()) void answer({ answer: "edit", text: words.trim() });
          }}
        >
          <Field id={`${formId}-words`} label={c.change} value={words} onChange={(e) => setWords(e.target.value)} autoComplete="off" data-testid="confirm-fact-words" />
        </form>
      ) : (
        <p className="rpu rpu-ask" data-rp="confirm-ask">
          {c.isRight}
        </p>
      )}
      <div className="rpu rpo-dock" data-rp="dock">
        {failed && (
          <div role="alert" data-rp="form-problem">
            <Box variant="red" title={c.failed} />
          </div>
        )}
        {editing ? (
          <ButtonRow cols={2}>
            <SecondaryButton
              disabled={busy}
              onClick={() => {
                setEditing(false);
                setWords(text);
                setFailed(false);
              }}
              data-testid="confirm-fact-keep"
            >
              {o.cancel}
            </SecondaryButton>
            <PrimaryButton type="submit" form={formId} pending={busy} disabled={!words.trim()} data-testid="confirm-fact-save">
              {c.saveChange}
            </PrimaryButton>
          </ButtonRow>
        ) : (
          <ButtonRow cols={3}>
            <PrimaryButton pending={busy} onClick={() => void answer({ answer: "yes" })} data-testid="confirm-fact-yes">
              {c.yes}
            </PrimaryButton>
            <SecondaryButton disabled={busy} onClick={() => setEditing(true)} data-testid="confirm-fact-change">
              {c.change}
            </SecondaryButton>
            <SecondaryButton disabled={busy} onClick={() => void answer({ answer: "no" })} data-testid="confirm-fact-no">
              {c.no}
            </SecondaryButton>
          </ButtonRow>
        )}
      </div>
    </div>
  );
}

/**
 * Everything that waits for him, one at a time. The sentence on top and the count keep the number he started with
 * while he goes through them: what he already answered here still counts in 「共 N 项」.
 */
export function ConfirmFacts({ facts, locale }: { facts: WaitingFact[]; locale: CLocale }) {
  const c = profileCopy(locale);
  const s = setupCopy(locale);
  const router = useRouter();
  const [answered, setAnswered] = useState<string[]>([]);
  const left = facts.filter((f) => !answered.includes(f.id));
  const total = answered.length + left.length;
  const current = left[0];
  return (
    <>
      <StatusHeadline lines={c.pendingTitle(total)} />
      {current ? (
        <>
          <p className="rpu rpo-count" data-rp="confirm-count" data-index={answered.length + 1} data-total={total}>
            {s.nOf(answered.length + 1, total)}
          </p>
          <ConfirmFact
            key={current.id}
            {...current}
            locale={locale}
            onAnswered={() => {
              setAnswered((ids) => [...ids, current.id]);
              // his profile (or what is left) from the server; the count above does not wait for it
              router.refresh();
            }}
          />
        </>
      ) : (
        // the last answer is saved: his profile is on its way
        <LoadingState locale={locale} lines={2} />
      )}
    </>
  );
}
