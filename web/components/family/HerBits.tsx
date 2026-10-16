"use client";

/**
 * Small interactive pieces of her screens (C2 track D; relaid to the v3 draft by the fe-d track): a line's own sound
 * (「听原声」), her saved number for Dad, her notifications (the row on 「我的」 and the screen behind it, G2), leaving
 * his Ripple (G4), logging out.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Chip, ChevronRight, FactRow, FamilyButton, FamilyDock, FamilyHero, FamilyNote, LinkRow, StepList } from "@/components/family-ui";
import { savedPhone, savePhone } from "@/lib/care/device";
import { hc, type HerKey } from "@/lib/care/her-copy";
import type { Locale } from "@/lib/i18n";
import { forgetThisPhone } from "@/lib/offline/forget"; // C2 track O: what this phone forgets at logout
import { PhoneStep } from "./FamilyApp";
import { disablePush, enablePush, readPushStatus } from "@/lib/push/client";
// C2 track I (only add): logging out takes this phone's push subscription away from her first
import { forgetPushOnSignOut } from "@/lib/push/client";
import { pushWords, type PushState } from "./PushStep";

/** An iPhone or iPad: the draft's steps name its Settings. Read after mount (the server does not know the phone). */
export function useIsIos(): boolean {
  const [ios, setIos] = useState(false);
  useEffect(() => {
    const ua = navigator.userAgent;
    setIos(/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1));
  }, []);
  return ios;
}

/** 「听原声」: the line's own sound, through her link, from its time point; 「停」 while it plays; 「代录音」 when it is a stand-in voice. */
export function ClipButton({ url, locale, standIn }: { url: string; locale: Locale; standIn: boolean }) {
  const el = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 8, flex: "none" }}>
      {standIn && <Chip>{hc(locale, "standIn")}</Chip>}
      <FamilyButton
        size="small"
        variant="secondary"
        tone="teal"
        glyph={playing ? undefined : "play"}
        data-testid="clip-play"
        onClick={() => {
          const a = el.current;
          if (!a) return;
          if (!a.paused) {
            a.pause();
            return;
          }
          a.currentTime = 0;
          void a.play().catch(() => setPlaying(false));
        }}
      >
        {playing ? hc(locale, "stop") : hc(locale, "listen")}
      </FamilyButton>
      <audio ref={el} src={url} preload="none" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
    </span>
  );
}

/** Dad's number on her page 「我的」: shown, and the row opens the screen that changes it (G3). */
export function PhoneRow({ linkId, locale, dad, href }: { linkId: string; locale: Locale; dad: string; href: string }) {
  const [phone, setPhone] = useState<string | null>(null);
  useEffect(() => setPhone(savedPhone(linkId)), [linkId]);
  return <FactRow label={hc(locale, "phoneLabel", { dad })} value={phone ?? hc(locale, "phoneNone")} href={href} data-testid="me-phone" />;
}

/** /f/phone (G3): 「爸爸的电话。」, change it, 「存好」, then back. */
export function PhonePage({ linkId, locale, dad, back }: { linkId: string; locale: Locale; dad: string; back: string }) {
  const [initial, setInitial] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setInitial(savedPhone(linkId));
    setReady(true);
  }, [linkId]);
  if (!ready) return null;
  return (
    <PhoneStep
      locale={locale}
      dad={dad}
      initial={initial}
      edit
      onSaved={(p) => {
        savePhone(linkId, p);
        window.location.assign(back);
      }}
    />
  );
}

const NOTIF_WORDS: Record<string, HerKey> = { on: "notifOn", denied: "notifBlocked", unsupported: "notifUnsupported", needs_home_screen: "notifNeedsHome" };

/** This phone's notifications, read once (track I's readPushStatus: "on" only when the server knows this phone). */
function usePushState(): [PushState | null, (s: PushState) => void, () => Promise<PushState>] {
  const [state, setState] = useState<PushState | null>(null);
  const read = useCallback(async (): Promise<PushState> => {
    const s = await readPushStatus()
      .then((r) => (r.state === "default" ? ("off" as PushState) : r.state))
      .catch(() => "off" as PushState);
    setState(s);
    return s;
  }, []);
  useEffect(() => {
    void read();
  }, [read]);
  return [state, setState, read];
}

/**
 * 「通知」 on 「我的」 (G1): where this phone stands, in a word (开着, 关着, 被关掉了, 要先加到主屏…); the row opens the
 * screen behind it (G2), where notifications are turned on, turned off, or explained.
 */
export function NotificationsRow({ locale, href }: { locale: Locale; /** the screen behind the row (G2) */ href?: string }) {
  const [state] = usePushState();
  const words = hc(locale, (state && NOTIF_WORDS[state]) || "notifOff");
  return (
    <div className="contents" data-testid="me-notifications" data-state={state ?? undefined}>
      <FactRow label={hc(locale, "notifRow")} value={state ? words : ""} href={href} data-testid="me-notifications-open" />
    </div>
  );
}

/**
 * 「我的」→「通知」 (/f/me/notifications; the v3 draft's G2, and the states it does not draw). Refused in the phone's
 * settings: 「通知关着。」, the three steps on an iPhone, the note about the Home Screen, 「怎么加到主屏」, and 「打开了，
 * 再看一次」, which reads the phone again (and asks the browser when that is possible again). Never asked: the same
 * sentence with 「打开通知」 (enablePush, straight from her tap). On: 「通知开着。」 and 「关掉通知」 in plain words.
 * 「怎么加到主屏」 is a row of every state, 「通知开着。」 too (owner's tidy of 10-13).
 */
export function NotificationsPage({ locale, dad, installHref }: { locale: Locale; dad: string; installHref: string }) {
  const [state, setState, read] = usePushState();
  const [pending, setPending] = useState(false);
  const ios = useIsIos();
  if (state === null) return <div data-testid="me-notifications" data-state="reading" />;
  const turnOn = async () => {
    setPending(true);
    const r = await enablePush({ welcome: true });
    setPending(false);
    setState(r.state === "default" ? "off" : r.state);
  };
  const recheck = async () => {
    setPending(true);
    const s = await read();
    // the phone lets the browser ask again: this tap is the one that asks
    if (s === "off" || s === "default") {
      const r = await enablePush({ welcome: true });
      setState(r.state === "default" ? "off" : r.state);
    }
    setPending(false);
  };
  // 「怎么加到主屏」 in every state, not only where the phone asks for the Home Screen: 「我的」 no longer has a row to
  // those steps, so this is the way to them (owner's tidy of 10-13)
  const howHome = (
    <LinkRow href={installHref} style={{ marginTop: state === "needs_home_screen" || (state === "denied" && ios) ? 10 : 16 }} data-testid="notifications-install">
      {hc(locale, "notifHowHome")}
    </LinkRow>
  );
  if (state === "on") {
    return (
      <div className="rpf-col" data-testid="me-notifications" data-state="on">
        <FamilyHero tone="quiet" title={hc(locale, "notifOnTitle")} detail={hc(locale, "notifOnBody", { dad })} />
        {howHome}
        <FamilyDock foot="b">
          <FamilyNote>{hc(locale, "notifOnce")}</FamilyNote>
          <FamilyButton
            variant="quiet"
            pending={pending}
            onClick={async () => {
              setPending(true);
              const r = await disablePush();
              setPending(false);
              setState(r === "failed" ? "on" : "off");
            }}
            data-testid="me-push-off"
          >
            {hc(locale, "pushOff")}
          </FamilyButton>
        </FamilyDock>
      </div>
    );
  }
  const askable = state === "off" || state === "default" || state === "failed";
  return (
    <div className="rpf-col" data-testid="me-notifications" data-state={state}>
      <FamilyHero tone="quiet" title={hc(locale, "notifOffTitle")} detail={hc(locale, "notifOffBody", { dad })} />
      {state === "denied" && ios && <StepList steps={[hc(locale, "notifStep1"), hc(locale, "notifStep2"), hc(locale, "notifStep3")]} style={{ marginTop: 26 }} data-testid="notifications-steps" />}
      {state === "denied" && !ios && <p className="rpf rpf-note" style={{ marginTop: 16 }}>{pushWords("denied", locale)}</p>}
      {state === "failed" && (
        <p className="rpf rpf-error" role="alert">
          {pushWords("failed", locale)}
        </p>
      )}
      {(state === "needs_home_screen" || state === "unsupported") && <p className="rpf rpf-note" style={{ marginTop: 16 }}>{pushWords(state, locale)}</p>}
      {state === "denied" && ios && <p className="rpf rpf-note" style={{ marginTop: 16 }}>{hc(locale, "notifHomeNote")}</p>}
      {howHome}
      <FamilyDock foot="d">
        {askable ? (
          <FamilyButton pending={pending} onClick={() => void turnOn()} data-testid="me-push-on">
            {hc(locale, "pushOn")}
          </FamilyButton>
        ) : state === "unsupported" ? null : (
          <FamilyButton pending={pending} onClick={() => void recheck()} data-testid="notifications-recheck">
            {hc(locale, "notifRecheck")}
          </FamilyButton>
        )}
        <FamilyNote>{hc(locale, "notifOnce")}</FamilyNote>
      </FamilyDock>
    </div>
  );
}

/** 「不再看爸爸的 Ripple」 (G4): the outlined button on the screen that says what follows; then her page says she left (H2). */
export function LeaveButton({ linkId, locale, dad }: { linkId: string; locale: Locale; dad: string }) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <>
      {failed && (
        <p className="rpf rpf-error" role="alert" style={{ margin: "0 0 4px" }}>
          {hc(locale, "leaveFailed")}
        </p>
      )}
      <FamilyButton
        variant="secondary"
        pending={pending}
        data-testid="me-leave"
        onClick={async () => {
          setPending(true);
          const res = await fetch(`/api/family/links/${encodeURIComponent(linkId)}/leave`, { method: "POST", credentials: "same-origin" }).catch(() => null);
          if (res?.ok) {
            window.location.assign(`/f?link=${encodeURIComponent(linkId)}`);
            return;
          }
          setPending(false);
          setFailed(true);
        }}
      >
        {hc(locale, "meLeave", { dad })}
      </FamilyButton>
    </>
  );
}

/** Log out of this phone (track A's route), then the login page. `row`: drawn as a row of 「我的」 (G1), else as plain words. */
export function LogoutButton({ locale, row = false }: { locale: Locale; row?: boolean }) {
  const [pending, setPending] = useState(false);
  const run = async () => {
    setPending(true);
    await forgetPushOnSignOut(); // C2 track I: while her sign-in still counts; never throws
    await fetch("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ everywhere: false }), credentials: "same-origin" }).catch(() => null);
    await forgetThisPhone(); // C2 track O: what her phone kept (Dad's number per link, the welcome marks) goes with her sign-in
    window.location.assign("/login?as=family");
  };
  if (row) {
    return (
      <button type="button" className="rpf rpf-fact" disabled={pending} aria-busy={pending ? true : undefined} onClick={() => void run()} data-testid="me-logout">
        <span>{hc(locale, "logout")}</span>
        <span className="rpf-fact-value">
          <ChevronRight />
        </span>
      </button>
    );
  }
  return (
    <FamilyButton variant="quiet" pending={pending} data-testid="me-logout" onClick={() => void run()}>
      {hc(locale, "logout")}
    </FamilyButton>
  );
}
