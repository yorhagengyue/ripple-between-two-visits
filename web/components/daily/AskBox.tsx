"use client";

/**
 * Today's box: he types one sentence ("今天 150/95，我能不能多吃一粒？", "我今天好累") and it goes to POST /api/ask;
 * the answer is drawn by AnswerView, word for word as lib/safety returned it. Timing marks for e2e (tap -> full
 * answer on screen): window.__rpAsk = { sentAt, answeredAt } in performance.now() ms. window.__rpAskRoute carries the
 * answer's route and which rule or model decided it, for the judges' page (components/landing: 「规则当场判断」).
 *
 * Today's questions and answers stay (C2 follow-up; real-app 12 「刷新以后，之前的问答全没了」): POST /api/ask keeps each ask
 * as it was shown (lib/safety/turns.ts), and this box reads today's back from GET /api/ask/history when the page opens,
 * when the story day changes and after a reset. They are listed under the box, newest first and open, the older ones
 * folded: the same words and source chips, under their own test ids ("earlier-…"), so the answer just given stays the
 * only "ask-answer" on the page. A new ask moves the answer before it into that list.
 *
 * His sentence is on the screen the moment it is sent (C2 track E, fix round of 10-11): "ask-asked" with the waiting
 * line under it ("ask-pending", the same words as the account's field), and the answer takes the waiting line's place
 * when it arrives. It used to be drawn only together with its answer, so while a real model and its checker worked the
 * phone showed nothing new, and the judges' page (/demo) had no sentence to show on the phone. An ask that did not go
 * through keeps the sentence, with the error line under it; his words stay in the field for the next try. The block
 * ("ask-turn") leaves room for the phone's sticky header when it is brought onto the screen
 * (components/landing/phone-driver.ts): the sentence used to end up behind that header.
 */
import { useEffect, useRef, useState } from "react";
import { useLiveEvent, useLiveSession } from "@/components/live/LiveSession";
import { cx } from "@/components/meds/classes";
import { demoText } from "@/lib/crew/demo-copy";
import { DRILL_PARAM, DRILL_SENTENCE } from "@/lib/crew/drill-words";
import type { Locale } from "@/lib/i18n";
import { dt } from "@/lib/daily/i18n";
import type { AskTurn } from "@/lib/safety/turns";
import type { AskResult } from "@/lib/safety/types";
import { ApiError, getJson, postJson } from "@/lib/session/client";
import { AnswerView, type ShownAnswer } from "./AnswerView";
import { askCopy } from "./ask-copy";

declare global {
  interface Window {
    __rpAsk?: { text: string; sentAt: number; answeredAt: number | null };
    /**
     * the last answer's route and which rule or model decided it, and the layers that stopped a sentence of it (the
     * judges' page reads it: components/landing)
     */
    /** drillStoppedAt: the layer that stopped the check drill's own sentence (null: no drill, or its sentence was not added) */
    __rpAskRoute?: { text: string; route: string; routeReason: string; stoppedAt: number[]; drillStoppedAt: number | null };
    /** set by the judges' page before it sends the check drill's question (lib/crew/drill.ts); read once */
    __rpAskDrill?: boolean;
    /**
     * the ask in hand did not go through (the error line is on screen): the judges' page stops waiting for its answer.
     * null from the moment a sentence is sent until it fails.
     */
    __rpAskFailed?: { text: string; at: number } | null;
  }
}

/** One of today's earlier asks as the list shows it. */
interface Earlier {
  id: string;
  text: string;
  answer: ShownAnswer | null;
}

export function AskBox({ locale }: { locale: Locale }) {
  const { session } = useLiveSession();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [asked, setAsked] = useState<string | null>(null);
  const [result, setResult] = useState<AskResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [earlier, setEarlier] = useState<Earlier[]>([]);
  const [reload, setReload] = useState(0);
  const day = session.story_day;
  // what is on screen now and how many asks were answered here: read by the history fetch when it comes back
  const shown = useRef<{ asked: string | null; answered: number }>({ asked: null, answered: 0 });

  // another story day, or a reset: yesterday's answer is not today's
  const stamp = `${session.id}|${day}|${reload}`;
  const [seenStamp, setSeenStamp] = useState(stamp);
  if (seenStamp !== stamp) {
    setSeenStamp(stamp);
    setAsked(null);
    setResult(null);
    setError(null);
    setEarlier([]);
  }

  // today's asks, as they were kept; a failed read leaves the list as it is (the box itself still works)
  useEffect(() => {
    let live = true;
    const read = (tries: number) => {
      const before = shown.current.answered;
      void getJson<{ turns: AskTurn[] }>("/api/ask/history", session.id)
        .then((out) => {
          if (!live) return;
          // an answer arrived here while this was on its way: the list may miss it, so read once more
          if (shown.current.answered !== before && tries > 0) return read(tries - 1);
          const turns = (out.turns ?? []).map((t) => ({ id: t.id, text: t.text, answer: t.answer }));
          // the answer on screen is the newest kept turn: it is not listed twice
          if (shown.current.asked !== null && turns.at(-1)?.text === shown.current.asked) turns.pop();
          setEarlier(turns);
        })
        .catch(() => undefined);
    };
    shown.current = { asked: null, answered: shown.current.answered };
    read(2);
    return () => {
      live = false;
    };
  }, [session.id, day, reload]);

  // a reset empties the copy: read again
  useLiveEvent(() => setReload((n) => n + 1), ["session.reset"]);

  async function send() {
    const q = text.trim();
    if (!q || busy) return;
    setBusy(true);
    setError(null);
    // his sentence is on the screen now, before any answer; the answer that was on screen joins today's list (it is a
    // kept turn already, so a history read that comes back meanwhile lists it too)
    if (result && asked) setEarlier((list) => [...list, { id: `here-${list.length}`, text: asked, answer: result }]);
    shown.current = { asked: null, answered: shown.current.answered };
    setAsked(q);
    setResult(null);
    window.__rpAsk = { text: q, sentAt: performance.now(), answeredAt: null };
    window.__rpAskFailed = null;
    // the demo's check drill (the judges' page asks for it; the server honours it in a demo scope only)
    const drill = window.__rpAskDrill === true;
    window.__rpAskDrill = false;
    try {
      const res = await postJson<AskResult>(drill ? `/api/ask?${DRILL_PARAM}=1` : "/api/ask", session.id, { text: q, locale, role: "patient" });
      // the answer takes the waiting line's place
      shown.current = { asked: q, answered: shown.current.answered + 1 };
      setAsked(q);
      setResult(res);
      setText("");
      const stops = res.blocked ?? [];
      // (the drill's own sentence is told apart from a sentence of the model's that a check stopped in the same answer)
      window.__rpAskRoute = {
        text: q,
        route: res.route,
        routeReason: res.routeReason,
        stoppedAt: stops.map((b) => b.layer),
        drillStoppedAt: stops.find((b) => b.sentence.en === DRILL_SENTENCE)?.layer ?? null,
      };
      requestAnimationFrame(() => {
        if (window.__rpAsk) window.__rpAsk.answeredAt = performance.now();
      });
    } catch (e) {
      // it did not go through: his sentence stays, with the error line under it, and his words are still in the field
      setResult(null);
      setError(dt(locale, e instanceof ApiError && e.status === 429 ? "ask.limit" : "ask.error"));
      window.__rpAskFailed = { text: q, at: performance.now() };
    } finally {
      setBusy(false);
    }
  }

  const newestFirst = [...earlier].reverse();

  return (
    <section className="rp-card flex flex-col gap-3" data-testid="ask-box">
      <h2 className="text-[20px] font-bold">{dt(locale, "ask.title")}</h2>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          className={cx.input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={dt(locale, "ask.placeholder")}
          aria-label={dt(locale, "ask.placeholder")}
          maxLength={500}
          data-testid="ask-input"
        />
        <button type="submit" className="rp-btn rp-btn-accent min-h-[52px] flex-none px-4" disabled={busy || !text.trim()} data-testid="ask-send">
          {busy ? dt(locale, "ask.sending") : dt(locale, "ask.send")}
        </button>
      </form>
      {/* the ask in hand: his sentence at once and the waiting line, then the answer in the waiting line's place (or the
          error line under the sentence); scroll-mt is the room the phone's sticky header takes (63 px) and a little air
          (less than the gap to the field above, so the field stays behind the header): the judges' page reads it when it
          brings the block onto the phone's screen */}
      {asked || error || result ? (
        <div className="flex scroll-mt-[72px] flex-col gap-2" data-testid="ask-turn" aria-busy={busy}>
          {asked && !result ? (
            <p className="font-semibold" data-testid="ask-asked">
              “{asked}”
            </p>
          ) : null}
          {asked && !result && busy ? (
            <p className="text-ink-2" role="status" data-testid="ask-pending">
              {askCopy(locale).sending}
            </p>
          ) : null}
          {error ? (
            <p className="text-ink-2" role="alert" data-testid="ask-error">
              {error}
            </p>
          ) : null}
          {result ? <AnswerView result={result} asked={asked} locale={locale} /> : null}
        </div>
      ) : null}
      {newestFirst.length > 0 ? (
        <div className="flex flex-col gap-2 border-t border-hair pt-3" data-testid="ask-earlier" data-count={newestFirst.length}>
          <p className="text-body font-semibold text-ink-2">{demoText(locale, newestFirst.length === 1 ? "ask.earlier.one" : "ask.earlier", { n: newestFirst.length })}</p>
          {newestFirst.map((t, i) => (
            // the newest one is open when nothing newer is on screen (after a refresh, his last answer is still there);
            // folded while a sentence is in hand, so an older answer is not read as the answer to the new one
            <details key={t.id} open={i === 0 && !result && !asked} className="rounded-xl border border-hair px-3 py-2" data-testid="ask-earlier-turn">
              <summary className="min-h-12 cursor-pointer py-2 text-body font-semibold" data-testid="ask-earlier-summary">
                “{t.text}”
              </summary>
              {t.answer ? (
                <AnswerView result={t.answer} asked={null} locale={locale} place="earlier" />
              ) : (
                <p className="text-body text-ink-2">{demoText(locale, "ask.earlier.noAnswer")}</p>
              )}
            </details>
          ))}
        </div>
      ) : null}
    </section>
  );
}
