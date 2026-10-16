"use client";

/**
 * The daily diet check (journey 13; 老人端提示词 13.5; M16; design 13-3): the day's one fixed question, taken from the
 * doctor's own line about food, and three worded buttons 有 / 没有 / 不记得 in one row. His answer is recorded, never
 * judged: the screen only says what he answered and that it is noted (「已记下：没有」), and he can change it the same
 * day. All three are plain bordered buttons: none of them is the "right" answer. POST /api/diet/check; on the diet
 * screen the page's server data is then read again (router.refresh).
 *
 *   mode "today"   the body of Today's entry (components/diet/DietCheckSection; the entry and its node are the Today
 *                  page's): the head line 「饮食 · 每天一问 · 取自医生的话 · 8月31日 · 0:42」 (which line of the doctor's
 *                  the question is taken from: its date and its time point in the recording), the question as the
 *                  entry's title, the three answers. After his answer: the question, 「已记下：没有」, 「改一下」 and the
 *                  way to the diet screen, where the doctor's words themselves are
 *   mode "screen"  the diet screen's own line (/p/diet): the doctor's line word for word on the doctor's node (serif,
 *                  the checked Chinese under English words, 「听原声」), `more` (the doctor's other lines), then the
 *                  question as an entry of the same line: the node that is "now" while it waits, his own node once he
 *                  answered (his answer is his record: no tick, a tick would read as a verdict), then `after` (the
 *                  week's count)
 *
 * Test hooks: diet-check (data-item, data-today), diet-doctor (data-source), diet-answer (data-answer), diet-answered
 * (data-answer), diet-change, diet-check-error, diet-doctor-translation.
 */
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Act, Acts, Box, Timeline, TimelineItem } from "@/components/ui";
import { askCopy } from "@/components/daily/ask-copy";
import type { DietAnswer } from "@/lib/diet/check";
import type { DietCheckData } from "@/lib/diet/view";
import type { Locale } from "@/lib/i18n";
import { DIET_WORDS } from "./copy";
import { DoctorWords, SourceHead } from "./DoctorWords";
import "./diet.css";

const ORDER: readonly DietAnswer[] = ["yes", "no", "unsure"];

export function DietCheck({
  data,
  locale,
  mode = "today",
  more,
  after,
}: {
  data: DietCheckData;
  locale: Locale;
  mode?: "today" | "screen";
  /** mode "screen": entries of the same line between the doctor's line and the question (the doctor's other lines) */
  more?: ReactNode;
  /** mode "screen": entries of the same line after the question (the week's count) */
  after?: ReactNode;
}) {
  const router = useRouter();
  const w = DIET_WORDS[locale];
  const copy = askCopy(locale);
  const [busy, setBusy] = useState<DietAnswer | null>(null);
  const [failed, setFailed] = useState(false);
  const [answered, setAnswered] = useState<DietAnswer | null>(data.today);
  const [changing, setChanging] = useState(false);

  async function answer(a: DietAnswer) {
    setBusy(a);
    setFailed(false);
    const res = await fetch("/api/diet/check", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ answer: a }) }).catch(() => null);
    setBusy(null);
    if (!res || !res.ok) return setFailed(true);
    setAnswered(a);
    setChanging(false);
    // on Today the server drops the entry once he answered: keep 「已记下」 on screen until he leaves; the diet screen
    // reads its data again (the week's line)
    if (mode === "screen") router.refresh();
  }

  const d = data.doctor;
  const done = answered !== null && !changing;
  // three in one row (the draft's row); in English the long third answer takes a row of its own
  const oneRow = locale === "zh-Hans";
  const answers = (
    <Acts cols={oneRow ? 3 : 2}>
      {ORDER.map((a) => (
        <Act key={a} pending={busy === a} disabled={busy !== null && busy !== a} onClick={() => void answer(a)} data-testid="diet-answer" data-answer={a} style={!oneRow && a === "unsure" ? { gridColumn: "1 / -1" } : undefined}>
          {data.answers[a]}
        </Act>
      ))}
    </Acts>
  );
  const error = failed ? (
    <div role="alert" data-testid="diet-check-error">
      <Box variant="red" title={w.failed} />
    </div>
  ) : null;
  const change = (
    <Act disabled={busy !== null} onClick={() => setChanging(true)} data-testid="diet-change">
      {w.change}
    </Act>
  );

  if (mode === "screen") {
    return (
      <div data-testid="diet-check" data-item={data.item} data-today={answered ?? "none"}>
        <Timeline>
          <TimelineItem node="doc" testId="diet-doctor" attrs={{ "data-source": `${d.visitId}:${d.utteranceId}` }}>
            <SourceHead kind="doctor" node="doc" who={copy.doctorSaid} when={`${d.date} · ${d.at}`} />
            <DoctorWords line={d} locale={locale} translationTestId="diet-doctor-translation" />
          </TimelineItem>
          {more}
          {done ? (
            <TimelineItem node="me" who={w.daily} title={data.question} note={w.noted(data.answers[answered])} testId="diet-answered" attrs={{ "data-answer": answered }} actions={<Acts>{change}</Acts>} />
          ) : (
            <TimelineItem
              node="now"
              who={w.daily}
              title={data.question}
              actions={
                <>
                  {answers}
                  {error}
                </>
              }
            />
          )}
          {after}
        </Timeline>
      </div>
    );
  }

  return (
    <div className="fe13-col" data-testid="diet-check" data-item={data.item} data-today={answered ?? "none"}>
      {/* the entry's head line: what this is, and which line of the doctor's the question is taken from */}
      <p className="rpu-tl-head" data-testid="diet-doctor" data-source={`${d.visitId}:${d.utteranceId}`}>
        <span className="rpu-tl-who">{w.label}</span>
        <span> · {w.from(d.date, d.at)}</span>
      </p>
      {done ? (
        <div className="fe13-col" data-testid="diet-answered" data-answer={answered}>
          <p className="rpu-tl-title">{data.question}</p>
          <p className="rpu-tl-note">{w.noted(data.answers[answered])}</p>
          <Acts cols={2}>
            {change}
            <Act href="/p/diet">{w.see}</Act>
          </Acts>
        </div>
      ) : (
        <>
          <p className="rpu-tl-title">{data.question}</p>
          {answers}
          {error}
        </>
      )}
    </div>
  );
}
