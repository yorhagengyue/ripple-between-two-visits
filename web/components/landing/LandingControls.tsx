"use client";

/**
 * The judges' controls on /demo (task M8 item 2; C2 track E), next to the phone and the live backstage of the same copy:
 *   - the hero button 「问：今天 150/95，我能不能多吃一粒？」 (in English when the phone is in English): it types the
 *     question into Mr Tan's Today box on the phone and sends it, so the real /api/ask flow answers on the phone while the
 *     backstage shows every step; the time from the click to the whole answer on the phone is shown;
 *   - 「自己问一句」: the judge's own sentence through the same box;
 *   - the check drill (lib/crew/drill.ts): an ordinary question with one made-up sentence added to its answer on
 *     purpose, so the judge sees a check stop it (the phone shows the referral line, the backstage the stop and why);
 *   - the phone's language (it follows the browser's the first time: POST /api/demo/view);
 *   - the film crew only (crew: the rp_crew cookie, lib/crew/gate.ts): the story clock. 「从第一天开始看」 moves this copy's
 *     clock to Day 0 and the phone shows that scene, then scene by scene; back to Day 29; reset this copy.
 * A button that cannot be pressed says why next to it (real-status: the grey hero button looked stuck). A server
 * warm-up loads the question pipeline once, quietly (GET /api/demo/warm: 204, nothing asked or written, no error in
 * the browser's console).
 * Fix round of 10-11: the sentence is on the phone's screen the moment it is sent (the phone's box draws it with a waiting
 * line; "hero-timing" carries data-shown-ms, the time from the click to that moment, next to data-ms for the whole
 * answer); an ask the phone could not send ends the wait at once; and switching the phone's language holds the ask
 * buttons until the reloaded page is on the phone (a sentence typed into the page that was about to go away was lost
 * with it).
 */
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useLiveSession } from "@/components/live/LiveSession";
import { DRILL_QUESTION, DRILL_SENTENCE } from "@/lib/crew/drill-words";
import { plainBeat } from "@/lib/crew/story";
import { LOCALE_COOKIE, type Locale } from "@/lib/i18n";
import { BEATS, currentBeat } from "@/lib/session/beats";
import { ApiError, postJson, withSession } from "@/lib/session/client";
import { storyDayLabel } from "@/lib/story/clock";
import { askOnPhone, PHONE_ANSWER_TIMEOUT_MS, phoneFrame, phoneLive, phoneLocale, ruleOnlyAnswer, showOnPhone } from "./phone-driver";
import { pageForBeat } from "./tour";

declare global {
  interface Window {
    /** shownAt: when the sentence was on the phone's screen (before its answer); answeredAt: when the whole answer was */
    __rpHero?: { text: string; clickedAt: number; shownAt: number | null; answeredAt: number | null; ms: number | null; error?: string };
  }
}

const HERO: Record<Locale, { text: string; label: string; gloss: string | null }> = {
  "zh-Hans": { text: "今天 150/95，我能不能多吃一粒？", label: "问：今天 150/95，我能不能多吃一粒？", gloss: "Ask: “Today 150/95, can I take one more tablet?”" },
  en: { text: "Today 150/95, can I take one more tablet?", label: "Ask: “Today 150/95, can I take one more tablet?”", gloss: null },
};

const OWN: Record<Locale, { label: string; placeholder: string; send: string }> = {
  "zh-Hans": { label: "自己问一句 · Ask your own question", placeholder: "例如：这个药是做什么的？", send: "在手机上问 · Ask on the phone" },
  en: { label: "Ask your own question", placeholder: "For example: What is this medicine for?", send: "Ask on the phone" },
};

type Asked = "hero" | "own" | "drill";
type HeroState =
  | { kind: "idle" }
  | { kind: "running"; what: Asked }
  /**
   * ruleOnly: the fixed rules alone answered (an emergency they caught): no model was asked, no time is shown.
   * drillAt: the layer that stopped the check drill's own sentence (null: it was not added to this answer).
   * shownMs: from the click to the sentence on the phone's screen (null: the phone never showed it before its answer).
   */
  | { kind: "done"; ms: number; shownMs: number | null; what: Asked; ruleOnly: boolean; drillAt: number | null }
  | { kind: "failed" };

/** What the drill's own line says once its answer is on the phone. */
export function drillWords(layer: number | null): string {
  if (layer === null) return "The drill did not run this time: the phone gave a fixed answer (an emergency line or a note), and no sentence is added to those. Try it again in a moment.";
  return `Stopped at layer ${layer}: the made-up sentence never reached the phone, which shows the referral line instead. The highlighted row in the backstage below says why.`;
}

/** What the status line says once the answer is on the phone (real-app 12: a rules-only emergency never reads "0.0 s"). */
export function doneWords(state: { ms: number; ruleOnly: boolean }): string {
  if (state.ruleOnly) return "Decided on the spot by the fixed rules (规则当场判断): no model was asked, and the emergency line was on the phone at once.";
  return `The whole answer was on the phone ${(state.ms / 1000).toFixed(1)} s after the click.`;
}

/** The phone's language for this browser (rp_lang, as the phone's own switch writes it). */
function writePhoneLanguage(next: Locale): void {
  document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
}

/**
 * Reload the phone's page (its language was just written). Returns the page that is going away and when, for the ask
 * buttons to wait out; null when there was nothing to reload (the frame then takes the language on its next navigation).
 */
function reloadPhone(): { doc: Document | null; since: number } | null {
  try {
    const frame = phoneFrame();
    if (!frame?.contentWindow) return null;
    const leaving = { doc: frame.contentDocument, since: Date.now() };
    frame.contentWindow.location.reload();
    return leaving;
  } catch {
    return null;
  }
}

/** What the crew reads when a story-clock call is refused. */
function clockProblem(err: unknown): string {
  if (!(err instanceof ApiError)) return "That did not work. Check the connection and try again.";
  if (err.code === "end_of_story") return "This is the last scene of the story.";
  if (err.code === "start_of_story") return "This is the first scene of the story.";
  if (err.code === "not_found") return "Only the film crew can move the story clock. Sign in on the Crew page first.";
  return "That did not work. Try again.";
}

export function LandingControls({ locale, crew, keptUntil }: { locale: Locale; crew: boolean; keptUntil: string | null }) {
  const router = useRouter();
  const { session, d0 } = useLiveSession();
  const [live, setLive] = useState(false);
  const [state, setState] = useState<HeroState>({ kind: "idle" });
  const [own, setOwn] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [drillOpen, setDrillOpen] = useState(false);
  const warmed = useRef(false);
  // the page that was on the phone when its language was switched: until the reloaded one is there, it is not a phone to
  // ask on (given up after 20 s, so a reload that never happened cannot hold the buttons for good)
  const leaving = useRef<{ doc: Document | null; since: number } | null>(null);
  const beat = currentBeat(session.story_day, session.story_time);
  const hero = HERO[locale];

  // server warm-up: the question pipeline is loaded once before the first click, by a request that succeeds (GET
  // /api/demo/warm: 204, nothing asked, read or written). It used to be an empty POST to /api/ask that answered 400
  // (real-status: a red 400 on every visit).
  useEffect(() => {
    if (warmed.current) return;
    warmed.current = true;
    void fetch(withSession("/api/demo/warm", session.id), { cache: "no-store", credentials: "same-origin" }).catch(() => undefined);
  }, [session.id]);

  // the phone is ready once one of his pages is on it, hydrated and connected (a question opens Today first); after a
  // language switch, once the reloaded page is: the page that is about to go away still looks live, and a sentence typed
  // into it goes away with it
  useEffect(() => {
    const t = setInterval(() => {
      if (leaving.current) {
        let onPhone: Document | null = null;
        try {
          onPhone = phoneFrame()?.contentDocument ?? null;
        } catch {
          onPhone = null;
        }
        if (onPhone !== leaving.current.doc || Date.now() - leaving.current.since > 20_000) leaving.current = null;
      }
      setLive(!leaving.current && phoneLive());
    }, 200);
    return () => clearInterval(t);
  }, []);

  async function run(what: Asked, text: string) {
    if (state.kind === "running") return;
    const clickedAt = performance.now();
    const shown: { at: number | null } = { at: null };
    window.__rpHero = { text, clickedAt, shownAt: null, answeredAt: null, ms: null };
    setState({ kind: "running", what });
    try {
      // the sentence in the phone's language: the hero question follows the phone, his own words are his own
      const sent = what === "hero" ? HERO[phoneLocale() ?? locale].text : what === "drill" ? DRILL_QUESTION[phoneLocale() ?? locale] : text;
      window.__rpHero.text = sent;
      const answer = await askOnPhone(sent, PHONE_ANSWER_TIMEOUT_MS, {
        drill: what === "drill",
        // the sentence is on the phone's screen now, its answer still to come
        onShown: (at) => {
          shown.at = at;
          if (window.__rpHero) window.__rpHero.shownAt = at;
        },
      });
      const answeredAt = performance.now();
      const ms = Math.round(answeredAt - clickedAt);
      window.__rpHero = { ...window.__rpHero, answeredAt, ms };
      setState({ kind: "done", ms, shownMs: shown.at === null ? null : Math.round(shown.at - clickedAt), what, ruleOnly: ruleOnlyAnswer(answer), drillAt: answer.drillStoppedAt });
      if (what === "own") setOwn("");
    } catch (e) {
      window.__rpHero = { ...window.__rpHero!, error: (e as Error).message };
      setState({ kind: "failed" });
    }
  }

  async function clock(body: unknown, then: (beatId: string | null) => string) {
    setBusy(true);
    setNote(null);
    try {
      const out = await postJson<{ beat: { id: string } | null }>("/api/clock", session.id, body);
      await showOnPhone(then(out.beat?.id ?? null));
    } catch (err) {
      setNote(clockProblem(err));
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true);
    setNote(null);
    try {
      // the reset puts the clock back on the evening of Day 29, 8:15pm by itself (app/api/session/reset)
      await postJson("/api/session/reset", session.id, {});
      await showOnPhone("/p/today");
      setState({ kind: "idle" });
    } catch (err) {
      setNote(clockProblem(err));
    } finally {
      setBusy(false);
    }
  }

  function setPhoneLanguage(next: Locale) {
    if (next === locale) return;
    writePhoneLanguage(next);
    // the page on the phone now is about to go away: the ask buttons wait for the reloaded one
    leaving.current = reloadPhone();
    if (leaving.current) setLive(false);
    router.refresh();
  }

  const running = state.kind === "running";
  const heroDisabled = !live || running;
  const reason = !live ? "Waiting for Mr Tan's phone to open on the left…" : running ? "Asking on the phone… watch the backstage below." : null;
  const lastBeat = BEATS[BEATS.length - 1];
  const scene = beat ? plainBeat(beat.id) : null;

  return (
    <div className="flex flex-col gap-4" data-testid="landing-controls">
      <section className="rp-card flex flex-col gap-3">
        <button
          type="button"
          disabled={heroDisabled}
          onClick={() => void run("hero", hero.text)}
          className="rounded-3xl border-2 border-ink bg-surface px-5 py-5 text-left shadow-sm transition-opacity disabled:cursor-progress disabled:opacity-60"
          data-testid="hero-button"
          data-ready={live ? "true" : "false"}
          data-state={state.kind}
          aria-describedby="hero-status"
        >
          <span className="block text-[24px] font-bold leading-snug" lang={locale === "zh-Hans" ? "zh-Hans" : "en"}>
            {hero.label}
          </span>
          {hero.gloss ? (
            <span className="mt-1 block text-[18px] text-ink-2" lang="en">
              {hero.gloss}
            </span>
          ) : null}
        </button>
        <p className="text-[18px] text-ink-2" role="status" id="hero-status" data-testid="hero-status">
          {reason ??
            (state.kind === "done"
              ? doneWords(state)
              : state.kind === "failed"
                ? "The phone did not answer. Reload the page and try again."
                : "Runs the real flow: the phone asks, three checks run on every sentence, and the backstage below shows each step.")}
        </p>
        {state.kind === "done" ? (
          <span className="sr-only" data-testid="hero-timing" data-ms={state.ms} data-shown-ms={state.shownMs ?? ""} data-what={state.what} data-rule-only={state.ruleOnly ? "true" : "false"} />
        ) : null}
      </section>

      <form
        className="rp-card flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (own.trim()) void run("own", own.trim());
        }}
        data-testid="own-question"
      >
        {/* the check drill's switch stands on the label's own row, so the backstage below keeps its place on the first screen */}
        <div className="flex flex-wrap items-center justify-between gap-x-4">
          <label className="text-[18px] font-semibold" htmlFor="own-question-input">
            {OWN[locale].label}
          </label>
          <button
            type="button"
            className="min-h-11 text-left text-[18px] font-semibold text-ink underline underline-offset-4"
            aria-expanded={drillOpen}
            aria-controls="landing-drill"
            onClick={() => setDrillOpen((open) => !open)}
            data-testid="drill-summary"
          >
            Check drill: watch the checks stop a sentence
          </button>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id="own-question-input"
            className="min-h-12 w-full min-w-0 rounded-xl border border-hair-2 bg-surface px-3 text-[18px] text-ink"
            value={own}
            maxLength={300}
            onChange={(e) => setOwn(e.target.value)}
            placeholder={OWN[locale].placeholder}
            data-testid="own-question-input"
          />
          <button
            type="submit"
            className="rp-btn rp-btn-accent min-h-12 shrink-0 px-4 text-[18px]"
            disabled={heroDisabled || !own.trim()}
            data-testid="own-question-send"
            aria-describedby="own-question-why"
          >
            {OWN[locale].send}
          </button>
        </div>
        <p className="text-[18px] text-ink-2" id="own-question-why" data-testid="own-question-why">
          {reason ?? (own.trim() ? "It goes through the same checks as the button above." : "Type a sentence first, as Mr Tan would.")}
        </p>
        {/* the check drill (lib/crew/drill.ts), folded so the backstage stays on the first screen */}
        {drillOpen ? (
          <div className="flex flex-col gap-2 pb-1 text-[18px]" id="landing-drill" data-testid="landing-drill">
            <p className="text-ink-2">
              The model only picks among Mr Tan&apos;s sources, so the checks rarely have anything to stop. The drill asks an ordinary question on the phone and, on purpose, adds one made-up sentence to the answer:{" "}
              <span lang="en">“{DRILL_SENTENCE}”</span> No source says it.
            </p>
            <button
              type="button"
              className="rp-btn rp-btn-ghost min-h-12 self-start px-4 text-[18px]"
              disabled={heroDisabled}
              onClick={() => void run("drill", DRILL_QUESTION[locale])}
              data-testid="drill-button"
              aria-describedby="drill-status"
            >
              Run the check drill on the phone
            </button>
            <p className="text-ink-2" role="status" id="drill-status" data-testid="drill-status" data-stopped={state.kind === "done" && state.what === "drill" ? (state.drillAt ?? "") : ""}>
              {reason ?? (state.kind === "done" && state.what === "drill" ? drillWords(state.drillAt) : "The three checks run on it as on every answer; the backstage shows which one stops it, and why.")}
            </p>
          </div>
        ) : null}
      </form>

      <section className="rp-card flex flex-col gap-2" data-testid="landing-language" aria-label="Mr Tan's phone language">
        <p className="text-[18px] font-semibold">Mr Tan&apos;s phone language</p>
        <div className="flex flex-wrap gap-2" role="group">
          {(["zh-Hans", "en"] as const).map((l) => (
            <button
              key={l}
              type="button"
              className={`rp-btn min-h-12 px-4 text-[18px] ${l === locale ? "rp-btn-accent" : "rp-btn-ghost"}`}
              aria-pressed={l === locale}
              // not while a sentence is being answered: reloading the phone's page would take its answer with it
              disabled={running}
              aria-describedby="hero-status"
              onClick={() => setPhoneLanguage(l)}
              data-testid={l === "en" ? "landing-phone-lang-en" : "landing-phone-lang-zh"}
            >
              {l === "en" ? "English" : <span lang="zh-Hans">华语</span>}
            </button>
          ))}
        </div>
        <p className="text-[18px] text-ink-2" data-testid="landing-sandbox">
          This copy of Mr Tan&apos;s story is yours alone: what you tap stays in it{keptUntil ? `, until ${keptUntil} (Singapore time)` : ""}.
          {crew && session.join_code ? ` Join code for the crew's phones: ${session.join_code}.` : ""}
        </p>
      </section>

      {crew ? (
        <section className="rp-card flex flex-col gap-3" data-testid="landing-story">
          <p className="text-[18px]">
            <span className="font-semibold">Story clock (film crew):</span>{" "}
            <span data-testid="landing-day">{storyDayLabel({ d0, day: session.story_day, time: session.story_time, locale: "en" })}</span>
            {scene ? <span className="text-ink-2"> · {scene}</span> : null}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rp-btn rp-btn-ghost min-h-12 text-[18px]"
              disabled={busy}
              onClick={() => void clock({ beat: "d0-visit" }, () => pageForBeat("d0-visit"))}
              data-testid="landing-from-day-one"
            >
              {locale === "zh-Hans" ? "从第一天开始看 · Watch from day one" : "Watch from day one"}
            </button>
            <button
              type="button"
              className="rp-btn rp-btn-ghost min-h-12 text-[18px]"
              disabled={busy || beat?.id === lastBeat.id}
              onClick={() => void clock({ beat: "next" }, (id) => pageForBeat(id))}
              data-testid="landing-next-beat"
              title={beat?.id === lastBeat.id ? "This is the last scene of the story." : undefined}
            >
              Next scene →
            </button>
            <button
              type="button"
              className="rp-btn rp-btn-ghost min-h-12 text-[18px]"
              disabled={busy}
              onClick={() => void clock({ beat: "d29-hero" }, () => "/p/today")}
              data-testid="landing-hero-beat"
            >
              Back to Day 29, 8:15pm
            </button>
            <button type="button" className="rp-btn rp-btn-ghost min-h-12 text-[18px]" disabled={busy} onClick={() => void reset()} data-testid="landing-reset">
              Reset this copy
            </button>
          </div>
          {beat?.id === lastBeat.id ? <p className="text-[18px] text-ink-2">This is the last scene of the story.</p> : null}
          {busy ? (
            <p className="text-[18px] text-ink-2" role="status">
              Moving the phone…
            </p>
          ) : null}
        </section>
      ) : null}

      {note ? (
        <p className="text-[18px] text-ink-2" role="alert" data-testid="landing-note">
          {note}
        </p>
      ) : null}
    </div>
  );
}
