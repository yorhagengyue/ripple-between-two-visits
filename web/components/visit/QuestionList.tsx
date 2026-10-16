"use client";

/**
 * Ripple's "Before you go" question list (v3 .qlist, brand teal). Each question says where it came from.
 * What he asks and the answer are shown under the question as they were said; the answer is then kept as
 * "Answer saved", word for word, with who said it. Ripple asks; it never answers.
 */
import { useState } from "react";
import type { Locale } from "@/lib/i18n";
import { vt, type VisitKey } from "@/lib/visit/strings";
import { formatMs } from "@/lib/visit/text";
import type { LineView, QItemView, QListView } from "@/lib/visit/types";
import { chipText } from "./labels";
import { TranscriptLine } from "./TranscriptLine";
import s from "./styles";

function questionText(locale: Locale, q: QItemView): string {
  return q.text.own ?? (locale === "zh-Hans" ? q.text.zh ?? q.text.en : q.text.en ?? q.text.zh) ?? "";
}

function whyText(locale: Locale, q: QItemView): string {
  if (q.why === "own") return q.createdDay !== null ? vt(locale, "q.why.ownDay", { day: q.createdDay }) : vt(locale, "q.why.own");
  if (q.why === "refused_question") return vt(locale, "q.why.refused_question", { day: q.createdDay ?? "?" });
  return vt(locale, `q.why.${q.why}` as VisitKey);
}

const STATE_CLASS = { not_asked: "", now: s.qNow, done: s.qDone } as const;

export function QuestionList({ qlist, lines, locale }: { qlist: QListView; lines: LineView[]; locale: Locale }) {
  const [local, setLocal] = useState<Record<string, "now" | "skipped">>({});
  const shown = qlist.items.filter((q) => local[q.id] !== "skipped");
  return (
    <div className={`rp-qlist ${s.qlist}`} data-testid="qlist" data-anchor={qlist.anchor}>
      <div className={s.qhead}>
        <span className="rp-tag">● {vt(locale, "q.tag")}</span>
        <span className={`rp-count ${s.prog}`} data-testid="qlist-progress">
          {vt(locale, "q.prog", { k: qlist.answered, n: qlist.items.length })}
        </span>
      </div>
      <div className={s.qintro}>{vt(locale, "q.intro", { n: qlist.items.length })}</div>
      {shown.map((q, i) => {
        const state = q.state === "not_asked" && local[q.id] === "now" ? "now" : q.state;
        const under = lines.filter((l) => l.inQuestion === q.id);
        return (
          <div key={q.id} className={`${s.q} ${STATE_CLASS[state]}`} data-testid={`q-${q.id}`} data-state={state}>
            <div className={s.qtop}>
              <span className={`rp-tag ${s.qn}`}>{i + 1}</span>
              <div>
                <div className="rp-qt" data-testid={`q-${q.id}-text`}>
                  {questionText(locale, q)}
                </div>
                <div className={`rp-src ${s.qwhy}`}>{whyText(locale, q)}</div>
                <span className={`rp-tag ${s.qst}`}>{vt(locale, `q.state.${state}` as VisitKey)}</span>
              </div>
            </div>
            {under.length > 0 ? (
              <div className={s.qa}>
                {under.map((l) => (
                  <TranscriptLine
                    key={l.id}
                    locale={locale}
                    id={l.id}
                    text={l.text}
                    role={l.role}
                    display={l.display}
                    tStartMs={l.tStartMs}
                    marks={l.marks}
                    scriptedFallback={l.scriptedFallback}
                  />
                ))}
              </div>
            ) : null}
            {q.answer ? (
              <div className={s.recAns} data-testid={`q-${q.id}-saved`}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                <div>
                  <span className={`rp-tag ${s.lab}`}>{vt(locale, "q.saved")}</span>
                  <div data-testid={`q-${q.id}-answer`}>{q.answer.text}</div>
                  <div className="rp-src">
                    {chipText(locale, q.answer.role, q.answer.display)} ·{" "}
                    {q.answer.auto ? vt(locale, "q.auto", { time: formatMs(q.answer.tStartMs) }) : formatMs(q.answer.tStartMs)}
                  </div>
                </div>
              </div>
            ) : null}
            {state === "not_asked" ? (
              <div className={s.askbtn}>
                <button type="button" className="rp-btn rp-btn-accent" onClick={() => setLocal((x) => ({ ...x, [q.id]: "now" }))}>
                  {vt(locale, "q.ask")}
                </button>
                <button type="button" className="rp-btn rp-btn-ghost" onClick={() => setLocal((x) => ({ ...x, [q.id]: "skipped" }))}>
                  {vt(locale, "q.skip")}
                </button>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
