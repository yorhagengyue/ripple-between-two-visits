"use client";

/**
 * 「拍药盒，看怎么吃」 / "Scan a medicine box" (scene 3 of the owner's film, 10-15): one button under his medicines on
 * 「记录」 and on 「我的药物」. It opens the phone's camera (a file on a computer), the photo is read and matched to one of
 * his medicines (POST /api/meds/scan; lib/meds/scan.ts), and the answer opens as a sheet over the page, the way
 * Ripple's read of a held thing does (components/explain/ExplainSheet.tsx): he does not leave the page.
 *
 *   his box      the medicine's name and strength; 「怎么吃」: his pharmacy label's own words, big, the words the label
 *                printed in capitals in bold (in 华语 lib/safety's template with the label's words under it), when he
 *                takes it and that it is his label; 「这个药是做什么的」: the leaflet's sentence and its source; 「医生的
 *                原话」: what his doctor said about it at a visit, the visit's date, and 「▶ 播放」 for the recorded line.
 *                Nothing plays by itself (owner 10-15): the words are on the screen, the sound is his choice.
 *   not the same the same medicine with another strength, or other directions than the label he checked: said in one
 *                sentence, nothing of how to take it; a new label goes through the add flow (?med=)
 *   not his      a medicine that is not on his list, or one nobody can identify: said plainly (the second is lib/safety's
 *                fixed sentence); he may add it (the add flow) or put a question for the pharmacist on his list
 *   no reading   the photo could not be read (another photo), his consent to AI processing is off (the way to 「我」),
 *                or the read failed (try again later)
 * Closing: 「关」, Escape, a tap on the dimmed ground, 「好了」. Every word is lib/meds/account-copy.ts (scan.*) or the
 * server's; nothing clinical is worded here.
 *
 * Test hooks: <testId> (the button), scan-file (the hidden input), scan-sheet (data-state: reading | read | failed;
 * data-outcome; data-med), scan-close, scan-name, scan-how (data-source), scan-when, scan-from, scan-printed,
 * scan-purpose (data-source), scan-doctor (data-source, data-date), scan-play (data-src, data-playing), scan-say,
 * scan-open-card, scan-relabel, scan-add, scan-ask (data-state), scan-error (data-why), scan-again, scan-done.
 */
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Box, Button, ButtonRow, Chevron, LabelOriginal, PlayPill, PrimaryButton, Said, SecondaryButton, Tag, Timeline, TimelineItem, TlControls } from "@/components/ui";
import { mx, type MedsLocale } from "@/lib/meds/account-copy";
import type { ScanDoctorLine, ScanView } from "@/lib/meds/scan";
import { uiCopy } from "@/lib/ui/copy";
import "./scan.css";

type Why = "unreadable" | "failed" | "ai_off";
type State =
  | { phase: "closed" }
  | { phase: "reading"; photo: string }
  | { phase: "read"; photo: string; view: ScanView }
  | { phase: "failed"; photo: string | null; why: Why };

async function send<T>(path: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" }).catch(() => null);
  if (!res) return { ok: false, status: 0, error: "network" };
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) return { ok: false, status: res.status, error: data.error ?? "request_failed" };
  return { ok: true, data: data as T };
}

/** The photo -> the label bucket (the add flow's way) -> the reading and the match. */
async function scan(file: Blob, locale: MedsLocale): Promise<{ ok: true; view: ScanView } | { ok: false; why: Why }> {
  const link = await send<{ path: string; url: string; method: string; headers: Record<string, string> }>("/api/upload-url", { kind: "label", content_type: file.type || "image/jpeg" });
  if (!link.ok) return { ok: false, why: "failed" };
  const put = await fetch(link.data.url, { method: link.data.method, headers: link.data.headers, body: file }).catch(() => null);
  if (!put?.ok) return { ok: false, why: put?.status === 415 ? "unreadable" : "failed" };
  const out = await send<ScanView>("/api/meds/scan", { path: link.data.path, locale });
  if (out.ok) return { ok: true, view: out.data };
  if (out.error === "ai_off") return { ok: false, why: "ai_off" };
  return { ok: false, why: out.status === 422 || out.status === 415 ? "unreadable" : "failed" };
}

/** 「▶ 播放」 under the doctor's words: his tap plays the recorded line, a second tap stops it. Never by itself. */
function PlayLine({ clip, locale }: { clip: NonNullable<ScanDoctorLine["clip"]>; locale: MedsLocale }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => () => audio.current?.pause(), []);
  function toggle() {
    if (playing && audio.current) {
      audio.current.pause();
      audio.current.currentTime = 0;
      return;
    }
    let a = audio.current;
    if (!a) {
      a = new Audio(clip.url);
      a.addEventListener("playing", () => setPlaying(true));
      for (const ev of ["ended", "pause", "error"]) a.addEventListener(ev, () => setPlaying(false));
      audio.current = a;
    }
    void a.play().catch(() => setPlaying(false));
  }
  return (
    <TlControls>
      <PlayPill playing={playing} onClick={toggle} testId="scan-play" attrs={{ "data-src": clip.url, "data-playing": playing ? "true" : "false" }}>
        {playing ? uiCopy(locale).playing : mx(locale, "scan.play")}
      </PlayPill>
      {clip.standIn ? <Tag>{uiCopy(locale).standIn}</Tag> : null}
    </TlControls>
  );
}

/** 「问药剂师」: his question for the pharmacist goes on his list (the question list's own route). */
function AskPharmacist({ text, locale }: { text: string; locale: MedsLocale }) {
  const [state, setState] = useState<"idle" | "sending" | "added" | "failed">("idle");
  if (state === "added") return <Box variant="tint" title={mx(locale, "scan.asked")} link={{ href: "/p/questions", label: mx(locale, "card.seeList") }} testId="scan-ask" attrs={{ "data-state": "added" }} />;
  return (
    <>
      <SecondaryButton
        pending={state === "sending"}
        data-testid="scan-ask"
        data-state={state}
        onClick={async () => {
          setState("sending");
          const r = await send("/api/questions", { text, for: "pharmacist", origin: "own" });
          setState(r.ok ? "added" : "failed");
        }}
      >
        {mx(locale, "scan.ask")}
      </SecondaryButton>
      {state === "failed" ? <Box variant="red" role="alert" title={mx(locale, "error.tapFailed")} /> : null}
    </>
  );
}

function Sheet({ state, locale, addHref, onClose, onAgain }: { state: Exclude<State, { phase: "closed" }>; locale: MedsLocale; addHref: string; onClose: () => void; onAgain: () => void }) {
  const titleId = useId();
  const sheet = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    sheet.current?.focus({ preventScroll: true });
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const copy = uiCopy(locale);
  const view = state.phase === "read" ? state.view : null;
  // the strength keeps its number and unit together on a narrow line ("500 mg" never breaks between them)
  const strength = (s: string | null | undefined) => (s ? s.replace(/ /g, "\u00a0") : null);
  const fullName = view?.med
    ? [view.med.name, strength(view.med.strength)].filter(Boolean).join(" ")
    : view
      ? [view.read.name ?? view.read.printed, strength(view.read.strength)].filter(Boolean).join(" ")
      : "";

  let body: ReactNode;
  if (state.phase === "reading") {
    body = (
      <>
        {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL of his own photo */}
        <img src={state.photo} alt={mx(locale, "photo.alt")} className="rps-photo" />
        <p className="rps-wait" role="status">
          {mx(locale, "scan.reading")}
        </p>
      </>
    );
  } else if (state.phase === "failed") {
    const words = state.why === "ai_off" ? mx(locale, "scan.aiOff") : mx(locale, state.why === "unreadable" ? "scan.unreadable" : "scan.failed");
    body = (
      <>
        {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL of his own photo */}
        {state.photo ? <img src={state.photo} alt={mx(locale, "photo.alt")} className="rps-photo" /> : null}
        <Box variant={state.why === "failed" ? "red" : "grey"} role="alert" title={words} testId="scan-error" attrs={{ "data-why": state.why }} link={state.why === "ai_off" ? { href: "/p/me/ai", label: mx(locale, "add.aiOffChange") } : undefined} />
      </>
    );
  } else if (view) {
    const head = (
      <div className="rps-head">
        <div>
          <h2 className="rps-name" data-testid="scan-name" translate="no">
            {fullName}
          </h2>
          {locale === "zh-Hans" && view.med?.zhName ? (
            <p className="rps-zh" lang="zh-Hans">
              {view.med.zhName}
            </p>
          ) : null}
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL of his own photo */}
        <img src={state.photo} alt={mx(locale, "photo.alt")} className="rps-thumb" />
      </div>
    );
    if (view.outcome === "his" && view.med) {
      const how = view.how;
      body = (
        <>
          {head}
          {how || view.noDirections ? (
            <section className="rps-sec" aria-label={mx(locale, "scan.how")}>
              <p className="rps-sec-t">{mx(locale, "scan.how")}</p>
              {how ? (
                <>
                  <p className="rps-big" lang={how.lang} data-testid="scan-how" data-source={how.sourceId}>
                    {how.runs.map((r, i) => (r.strong ? <strong key={i}>{r.text}</strong> : <span key={i}>{r.text}</span>))}
                  </p>
                  {how.printed ? (
                    <div data-testid="scan-printed">
                      <p className="rps-line" data-quiet="true">
                        {mx(locale, "scan.printed")}
                      </p>
                      <LabelOriginal>{how.printed}</LabelOriginal>
                    </div>
                  ) : null}
                  <p className="rps-line" data-testid="scan-when">
                    {how.when}
                  </p>
                  <p className="rps-line" data-quiet="true" data-testid="scan-from">
                    {[mx(locale, "scan.fromLabel"), how.clinic].filter(Boolean).join(" · ")}
                  </p>
                </>
              ) : (
                <Box variant="grey" title={mx(locale, "scan.noDirections")} testId="scan-how" attrs={{ "data-source": "none" }} />
              )}
            </section>
          ) : null}
          {view.purpose ? (
            <section className="rps-sec" aria-label={mx(locale, "scan.purpose")}>
              <p className="rps-sec-t">{mx(locale, "scan.purpose")}</p>
              <Timeline>
                <TimelineItem node="lab" who={copy.sources.leaflet} meta={view.purpose.meta || undefined} testId="scan-purpose" attrs={{ "data-source": view.purpose.sourceId }}>
                  <p className="rps-say">{view.purpose.text}</p>
                </TimelineItem>
              </Timeline>
            </section>
          ) : null}
          {view.doctor.length ? (
            <section className="rps-sec" aria-label={mx(locale, "scan.doctor")}>
              <p className="rps-sec-t">{mx(locale, "scan.doctor")}</p>
              <Timeline>
                {view.doctor.map((d) => (
                  <TimelineItem
                    key={d.sourceId}
                    node={d.inferred ? "unc" : "doc"}
                    who={d.inferred ? copy.inferredDoctor : copy.sources.doctor}
                    meta={d.meta || undefined}
                    frame="card"
                    testId="scan-doctor"
                    attrs={{ "data-source": d.sourceId, "data-date": d.date ?? "" }}
                    actions={d.clip ? <PlayLine clip={d.clip} locale={locale} /> : undefined}
                  >
                    <Said lang={d.lang} source={{ kind: "doctor", ref: d.sourceId }}>
                      {d.lang === "en" ? "“" : "「"}
                      {d.text}
                      {d.lang === "en" ? "”" : "」"}
                    </Said>
                  </TimelineItem>
                ))}
              </Timeline>
            </section>
          ) : null}
          <Button variant="link" href={`/p/meds/${encodeURIComponent(view.med.id)}`} nav="forward" data-testid="scan-open-card">
            {mx(locale, "scan.openCard")}
            <Chevron />
          </Button>
        </>
      );
    } else {
      // not the same as his label, not his, or nobody can tell: one plain sentence, and the ways on
      body = (
        <>
          {head}
          <Box variant="acc" role="status" title={view.say} testId="scan-say" />
          {view.outcome === "differs" && view.med ? (
            <div className="rpu-btns">
              <SecondaryButton href={`/p/meds/add?med=${encodeURIComponent(view.med.id)}`} nav="forward" data-testid="scan-relabel">
                {mx(locale, "card.relabel")}
              </SecondaryButton>
              <Button variant="link" href={`/p/meds/${encodeURIComponent(view.med.id)}`} nav="forward" data-testid="scan-open-card">
                {mx(locale, "scan.openCard")}
                <Chevron />
              </Button>
            </div>
          ) : (
            <div className="rpu-btns">
              <SecondaryButton icon="camera" href={addHref} nav="forward" data-testid="scan-add">
                {mx(locale, "scan.add")}
              </SecondaryButton>
              {view.question ? <AskPharmacist text={view.question} locale={locale} /> : null}
            </div>
          )}
        </>
      );
    }
  }

  return (
    <div
      className="rps-root"
      data-rp-phone-fixed=""
      data-testid="scan-sheet"
      data-state={state.phase}
      data-outcome={view?.outcome}
      data-med={view?.med?.id}
      data-provider={view?.provider}
      lang={locale}
    >
      <div className="rps-ground" aria-hidden="true" onClick={onClose} />
      <div ref={sheet} className="rps-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
        <div className="rps-bar">
          <p className="rps-bar-t" id={titleId}>
            {mx(locale, "scan.bar")}
          </p>
          <button type="button" className="rps-close" data-testid="scan-close" onClick={onClose}>
            {mx(locale, "scan.close")}
          </button>
        </div>
        <div className="rps-body">{body}</div>
        {state.phase !== "reading" ? (
          <div className="rps-foot">
            <ButtonRow cols={2}>
              <SecondaryButton onClick={onAgain} data-testid="scan-again">
                {mx(locale, state.phase === "failed" ? "scan.retake" : "scan.again")}
              </SecondaryButton>
              <PrimaryButton onClick={onClose} data-testid="scan-done">
                {mx(locale, "scan.done")}
              </PrimaryButton>
            </ButtonRow>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ScanBox({ locale, addHref, testId = "meds-scan" }: { locale: MedsLocale; addHref: string; testId?: string }) {
  const [state, setState] = useState<State>({ phase: "closed" });
  const [host, setHost] = useState<Element | null>(null);
  const file = useRef<HTMLInputElement | null>(null);
  const run = useRef(0);
  const photoUrl = state.phase === "closed" ? null : state.phase === "failed" ? state.photo : state.photo;

  // his photo's local address is let go when the sheet closes or another photo replaces it
  useEffect(() => () => void (photoUrl && URL.revokeObjectURL(photoUrl)), [photoUrl]);

  const close = useCallback(() => {
    run.current++;
    setState({ phase: "closed" });
  }, []);

  async function onPhoto(f: File) {
    const mine = ++run.current;
    const photo = URL.createObjectURL(f);
    // the sheet is drawn inside his screen (its tokens and its column on a computer), as Ripple's read of a held thing is
    setHost(file.current?.closest(".rpu-screen") ?? document.body);
    setState({ phase: "reading", photo });
    const r = await scan(f, locale);
    if (mine !== run.current) return;
    setState(r.ok ? { phase: "read", photo, view: r.view } : { phase: "failed", photo, why: r.why });
  }

  return (
    <>
      <input
        ref={file}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        capture="environment"
        hidden
        data-testid="scan-file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void onPhoto(f);
        }}
      />
      <SecondaryButton icon="camera" onClick={() => file.current?.click()} data-testid={testId}>
        {mx(locale, "scan.button")}
      </SecondaryButton>
      {state.phase !== "closed" && host
        ? createPortal(
            <Sheet
              state={state}
              locale={locale}
              addHref={addHref}
              onClose={close}
              onAgain={() => {
                close();
                file.current?.click();
              }}
            />,
            host,
          )
        : null}
    </>
  );
}
