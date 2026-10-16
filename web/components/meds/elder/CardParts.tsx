"use client";

/**
 * The interactive parts of his medicine card on an account (C2 track F), drawn as the timeline draft draws them
 * (06-7 to 06-9, 08-2, 08-3): play a quoted line's recording (the play pill and the 「代录音」 tag under the words), the
 * explain card's 「读给我听」 pill, the understanding checklist as a line of four entries (知道 / 不确定, kept: POST
 * /api/understanding), and the two choices for a medicine nobody identified as chips (没在吃 / 带去给医生看: PATCH
 * /api/meds/[id]; the second also puts his question for the doctor on the list). Nothing clinical is worded here.
 *
 * 「读给我听」 (ReadCardAloud; real-app 2.17, 6.10): the page draws it only when a real voice can speak (lib/tts
 * readAloudOffered("account")): never with the mock's placeholder tones. The voice reads the card's own sentences: POST
 * /api/tts names the card and the medicine, never any words (the server builds the text from the card it renders,
 * lib/explain/read-aloud.ts).
 *
 * A tap that did not reach the server says so in a red box (what failed, what is still there, what to do); nothing here
 * apologises or shows a code.
 */
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { voiceFromTap } from "@/components/explain/tap-voice";
import { Act, Acts, Box, Button, Chevron, PlayPill, Tag, Timeline, TimelineItem, UiLink } from "@/components/ui";
import { UNDERSTANDING_ITEMS, type UnderstandingAnswer, type UnderstandingItem, type UnderstandingView } from "@/lib/explain/types";
import { mx, type MedsLocale } from "@/lib/meds/account-copy";
import { uiCopy } from "@/lib/ui/copy";
import type { PatientMedStatus } from "@/lib/meds/types";
import type { NodeKind, SourceKind } from "@/lib/ui/tokens";
import "./meds.css";

/**
 * 「▶ 听原声」 under a quoted line: plays the line's clip (one sound at a time on his pages), 「正在播」 with the two bars
 * while it plays, and the 「代录音」 tag next to it for a stand-in voice. `kind` and `time` are kept for callers: who said
 * it and when are on the entry's head line.
 */
export function ListenLine({ url, standIn, locale, label }: { url: string; kind: SourceKind; time?: string; standIn: boolean; locale: MedsLocale; label?: string }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => () => audio.current?.pause(), []);
  function toggle() {
    // tapped while it plays: stop, and back to the start of the clip (its "pause" event puts the pill back)
    if (playing && audio.current) {
      audio.current.pause();
      audio.current.currentTime = 0;
      return;
    }
    let a = audio.current;
    if (!a) {
      a = new Audio(url);
      a.addEventListener("playing", () => setPlaying(true));
      for (const ev of ["ended", "pause", "error"]) a.addEventListener(ev, () => setPlaying(false));
      audio.current = a;
    }
    void a.play().catch(() => setPlaying(false));
  }
  return (
    <div className="rpu-tl-ctl" data-testid="card-listen" data-clip-url={url} data-playing={playing ? "true" : "false"}>
      <PlayPill playing={playing} onClick={toggle}>
        {playing ? uiCopy(locale).playing : (label ?? mx(locale, "card.listen"))}
      </PlayPill>
      {standIn ? <Tag>{uiCopy(locale).standIn}</Tag> : null}
    </div>
  );
}

/**
 * 「读给我听」: the explain card read by a real voice (the draft's outlined pill above the card). One sound at a time
 * (OneAudio on the page pauses whatever was playing); tapping again stops; leaving the card stops.
 */
export function ReadCardAloud({ medId, locale }: { medId: string; locale: MedsLocale }) {
  const [state, setState] = useState<"idle" | "loading" | "playing" | "failed">("idle");
  const audio = useRef<HTMLAudioElement | null>(null);
  const url = useRef<string | null>(null);
  const run = useRef(0);

  function stop() {
    run.current++;
    audio.current?.pause();
    audio.current = null;
    if (url.current) URL.revokeObjectURL(url.current);
    url.current = null;
  }
  useEffect(() => stop, []);

  /**
   * The tap itself. An iPhone lets a sound start only from the tap, and the voice arrives seconds later (it is made on
   * the server first): so the element is made and loaded right here, before anything is awaited, and the voice is
   * given to this same element when it comes. The order is voiceFromTap's (components/explain/tap-voice.ts; held by
   * tests/unit/explain/tap-voice.test.ts). Nothing may be awaited in this function before that call.
   */
  function play() {
    // the voice of an earlier tap, if any: its element and its address are let go
    stop();
    const mine = ++run.current;
    const current = () => mine === run.current;
    setState("loading");
    const { done } = voiceFromTap({
      makeElement: () => {
        const el = new Audio();
        el.preload = "auto";
        el.addEventListener("playing", () => current() && setState("playing"));
        // ended, or paused by another sound on the page (one sound at a time)
        for (const ev of ["ended", "pause"]) el.addEventListener(ev, () => current() && setState("idle"));
        // an error before the voice was given to it is not the voice failing: the element has nothing to play yet
        el.addEventListener("error", () => current() && url.current !== null && setState("failed"));
        audio.current = el;
        return el;
      },
      fetchVoice: async () => {
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          cache: "no-store",
          body: JSON.stringify({ card: "explain", med_id: medId, locale }),
        });
        if (!res.ok) throw new Error("refused");
        return res.blob();
      },
      toUrl: (blob) => (url.current = URL.createObjectURL(blob)),
      current,
    });
    // not fetched, or the phone would not play it: said on the screen (the card's words are all still there)
    done.catch(() => current() && setState("failed"));
  }

  const playing = state === "playing";
  return (
    <div className="rpu rpu-stack" data-testid="card-read-aloud" data-state={state}>
      <Button
        variant="outline"
        aria-pressed={playing}
        pending={state === "loading"}
        data-testid="card-read-aloud-button"
        onClick={() => {
          if (playing) {
            stop();
            setState("idle");
          } else play();
        }}
      >
        {mx(locale, playing ? "card.readStop" : "card.read")}
      </Button>
      {state === "failed" ? (
        <div role="status">
          <Box variant="red" title={mx(locale, "card.readFailed")} testId="card-read-aloud-failed">
            {mx(locale, "error.readBody")}
          </Box>
        </div>
      ) : null}
    </div>
  );
}

// owner 10-14: the same professional names as lib/explain/i18n.ts check.item.*
const ITEM_WORDS: Record<UnderstandingItem, [string, string]> = {
  purpose: ["药物用途", "What this medicine is for"],
  feel_fine: ["没有不适时是否服用", "Whether to take it when I feel fine"],
  when: ["服药时间", "When to take it"],
  missed: ["漏服时如何处理", "What to do if I miss one"],
};

/** The node of a checklist entry: the tick once he said 知道, his own mark once he said 不确定, the grey ring before. */
const nodeOf = (a: UnderstandingAnswer | null): NodeKind => (a === "know" ? "ok" : a === "unsure" ? "me" : "next");

/**
 * The understanding checklist (the draft's 06-9): one entry per item, 知道 / 不确定 under it, the chosen one filled.
 * 不确定 puts his question on the list for the next visit; the entry then says so, with the way to the list. Nobody
 * scores him and nothing counts how many he knows.
 */
export function Checklist({ medId, locale, initial }: { medId: string; locale: MedsLocale; initial: UnderstandingView }) {
  const [answers, setAnswers] = useState<Record<string, UnderstandingAnswer | null>>(() =>
    Object.fromEntries(UNDERSTANDING_ITEMS.map((id) => [id, initial.items.find((i) => i.id === id)?.answer ?? null])),
  );
  const [onList, setOnList] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(UNDERSTANDING_ITEMS.map((id) => [id, !!initial.items.find((i) => i.id === id)?.questionId])),
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  async function answer(item: UnderstandingItem, value: UnderstandingAnswer) {
    if (busy) return;
    setBusy(item);
    setFailed(false);
    try {
      const res = await fetch("/api/understanding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ med_id: medId, item, answer: value, locale }),
      });
      if (res.ok) {
        const out = (await res.json()) as { question: { id: string } | null };
        setAnswers((a) => ({ ...a, [item]: value }));
        if (out.question) setOnList((l) => ({ ...l, [item]: true }));
      } else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rpu rpu-stack" data-testid="card-checklist" data-med={medId}>
      <Timeline>
        {UNDERSTANDING_ITEMS.map((id) => {
          const a = answers[id];
          return (
            <TimelineItem
              key={id}
              node={nodeOf(a)}
              title={ITEM_WORDS[id][locale === "en" ? 1 : 0]}
              testId={`check-${id}`}
              attrs={{ "data-answer": a ?? "none" }}
              actions={
                <>
                  {/* a line of its own that is the way to the list (meds.css: it may wrap; the English words take two lines) */}
                  {onList[id] ? (
                    <UiLink href="/p/questions" className="rpu-meds-onlist" data-rp="inline-link">
                      <span>{mx(locale, "card.onList")}</span>
                      <Chevron />
                    </UiLink>
                  ) : null}
                  <Acts cols={2}>
                    <Act variant={a === "know" ? "on" : "secondary"} aria-pressed={a === "know"} disabled={busy !== null} onClick={() => void answer(id, "know")} data-testid={`check-${id}-know`}>
                      {mx(locale, "card.know")}
                    </Act>
                    <Act variant={a === "unsure" ? "on" : "secondary"} aria-pressed={a === "unsure"} disabled={busy !== null} onClick={() => void answer(id, "unsure")} data-testid={`check-${id}-unsure`}>
                      {mx(locale, "card.unsure")}
                    </Act>
                  </Acts>
                </>
              }
            />
          );
        })}
      </Timeline>
      {failed ? (
        <div role="alert">
          <Box variant="red" title={mx(locale, "error.tapFailed")} testId="check-failed">
            {mx(locale, "error.tapBody")}
          </Box>
        </div>
      ) : null}
    </section>
  );
}

/**
 * A medicine nobody identified: what he does with it, his own choice (the draft's 08-2 chips). One of the two at a
 * time, as the record keeps it. 「带去给医生看」 also puts his question for the doctor on the list; the entry under the
 * chips says so, with the way to the list.
 */
export function UnknownChoices({
  medId,
  locale,
  initial,
  onListInitially,
  listLink = true,
  hooks = "card",
  look = "chips",
}: {
  medId: string;
  locale: MedsLocale;
  initial: PatientMedStatus | null;
  onListInitially: boolean;
  /** 「看问题单」 under 「已在下次看诊的问题单里」; false where the screen already has that button right above */
  listLink?: boolean;
  /**
   * which screen the choices are on, for the test hooks: the medicine's card (card-unknown-choices, unknown-not-taking,
   * unknown-bring, unknown-on-list: the hooks the card has always had) or the screen right after the photo
   * (add-unknown-choices, add-unknown-not-taking, add-unknown-bring, add-unknown-doctor-list), so a test that waits
   * for the card never finds these while the card is still opening
   */
  hooks?: "card" | "add";
  /** how the two choices are drawn: the small chips, or two large buttons side by side (the medicine's card) */
  look?: "chips" | "buttons";
}) {
  const router = useRouter();
  const [status, setStatus] = useState<PatientMedStatus | null>(initial);
  const [onList, setOnList] = useState(onListInitially);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function choose(next: PatientMedStatus) {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/meds/${encodeURIComponent(medId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action: "patient_status", status: next, locale }),
      });
      if (res.ok) {
        const out = (await res.json()) as { question: { id: string } | null };
        setStatus(next);
        if (out.question) setOnList(true);
        router.refresh();
      } else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  // on the screen after the photo 「已加进问题单：问药剂师」 is add-unknown-on-list already: his question for the doctor is add-unknown-doctor-list
  const id = (name: string) => (hooks === "add" ? `add-unknown-${name === "on-list" ? "doctor-list" : name}` : name === "choices" ? "card-unknown-choices" : `unknown-${name}`);
  const chip = (s: PatientMedStatus, testId: string) => (
    <button
      type="button"
      className={look === "buttons" ? "rpu rpu-btn" : "rpu-chip"}
      data-rp={look === "buttons" ? "button" : "chip"}
      data-variant={look === "buttons" ? "secondary" : undefined}
      aria-pressed={status === s}
      aria-busy={busy ? true : undefined}
      onClick={() => void choose(s)}
      data-testid={testId}
    >
      {mx(locale, `patient.${s}`)}
    </button>
  );

  return (
    <section className="rpu rpu-stack" data-testid={id("choices")} data-status={status ?? "none"}>
      <div>
        <p className="rpu rpu-text" data-rp="text" data-variant="strong" style={{ marginTop: 0 }}>
          {mx(locale, "card.unknownChoice")}
        </p>
        <p className="rpu rpu-text" data-rp="text" data-variant="lede">
          {mx(locale, "card.unknownChoiceSub")}
        </p>
      </div>
      <div className={look === "buttons" ? "rpu rp06-choice-btns" : "rpu rpu-chips"} data-rp="chips" role="group" aria-label={mx(locale, "card.unknownChoice")}>
        {chip("not_taking", id("not-taking"))}
        {chip("bring_to_doctor", id("bring"))}
      </div>
      {failed ? (
        <div role="alert">
          <Box variant="red" title={mx(locale, "error.tapFailed")} testId={id("failed")}>
            {mx(locale, "error.tapBody")}
          </Box>
        </div>
      ) : null}
      {onList ? (
        <Timeline>
          <TimelineItem
            node="ok"
            title={mx(locale, "card.onList")}
            testId={id("on-list")}
            actions={
              listLink ? (
                <Acts>
                  <Act variant="outline" href="/p/questions">
                    {mx(locale, "card.seeList")}
                  </Act>
                </Acts>
              ) : undefined
            }
          />
        </Timeline>
      ) : null}
    </section>
  );
}
