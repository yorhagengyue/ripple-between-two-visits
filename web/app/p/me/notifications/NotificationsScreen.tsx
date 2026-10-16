"use client";

/**
 * 「我 › 提醒和通知」 on his phone (C2 track I; laid out with the timeline draft's pieces by line fe-me: the draft does
 * not draw this screen, its 通用-5a to 5d are the prompts on Today): the state of this phone's reminders and the one
 * thing to do about it. What the phone can do is known only here (the browser's permission, its subscription, an iPhone
 * outside the Home Screen), so the screen starts with a short skeleton while it looks (lib/push/client.ts
 * readPushStatus).
 *
 *   the header     「‹ 我」 「提醒和通知」
 *   the state      one sentence (data-rp="headline") in the piece that fits it: a box with the accent border when
 *                  something waits for him (never asked, off on this phone, the iPhone's three steps), a ticked node
 *                  when reminders are on, a plain box when he refused or the browser cannot
 *   what comes     a card: each part of the day's medicine and its two times, what the lock screen says
 *   recent ones    a line of nodes: ticked when he opened the reminder, the dashed ring when he did not
 *   the buttons    at the foot: the one filled button (「开提醒」), or the bordered ones once reminders are on
 * Only taps, no dialogs; the result of a tap is said in words right under the state and carries the button's name.
 */
import { useEffect, useState, type ReactNode } from "react";
import { P, Said } from "@/components/me/parts";
import { InstallButton } from "@/components/push/InstallButton";
import { ActionDock, Box, ButtonNote, ListCard, ListItem, LoadingState, PageHeader, PrimaryButton, Screen, SecondaryButton, SectionLabel, Timeline, TimelineItem } from "@/components/ui";
import { disablePush, enablePush, readPushStatus, sendTestPush, type PushState } from "@/lib/push/client";
import { pushPageCopy, type PushPageLocale } from "@/lib/push/copy";
import { HomeScreenLine } from "./HomeScreenLine";

export interface SlotLine {
  slot: string;
  /** 「早上的药」 */
  name: string;
  /** 「8:45，没回 9:15 再问一次」 */
  when: string;
}

export interface RecentLine {
  /** 「早上的药 · 第一次」 */
  what: string;
  /** 「今天 8:45」 */
  when: string;
  /** 「8:46 点开了」 / 「没点开」 */
  opened: string;
  wasOpened: boolean;
}

/** A row of a card keeps the hook the first build's rows had (data-rp="row"): journeys find a row by it. */
const ROW = { "data-rp": "row" } as const;

type View = "checking" | PushState;
type Busy = null | "on" | "test" | "off" | "retry";

const LATIN = /[A-Za-z0-9]/;
const MARK = /[\s，。：；、！？「」（）]/;

/**
 * A title given as lines (the first build broke it by hand) is one sentence here: the box wraps it. English lines are
 * joined by a space; Chinese ones run on, with a space only where a character meets a Latin word (「要先把 Ripple」).
 */
function sentence(lines: readonly string[], locale: PushPageLocale): string {
  return lines.reduce((all, line) => {
    if (!all || !line) return all + line;
    if (locale === "en") return `${all} ${line}`;
    const a = all[all.length - 1];
    const b = line[0];
    return LATIN.test(a) !== LATIN.test(b) && !MARK.test(a) && !MARK.test(b) ? `${all} ${line}` : all + line;
  }, "");
}

export function NotificationsScreen({
  locale,
  slots,
  recent,
}: {
  locale: PushPageLocale;
  /** not drawn any more (the language is under 「我 › 语言」); accepted so the page need not change */
  langHref?: string;
  slots: SlotLine[];
  recent: RecentLine[];
}) {
  const c = pushPageCopy(locale);
  const [view, setView] = useState<View>("checking");
  const [busy, setBusy] = useState<Busy>(null);
  const [said, setSaid] = useState<{ text: string; tone: "done" | "problem" } | null>(null);

  useEffect(() => {
    let live = true;
    void readPushStatus()
      .then((s) => live && setView(s.state))
      .catch(() => live && setView("default"));
    return () => {
      live = false;
    };
  }, []);

  // straight from the tap: the browser asks for permission only inside one
  async function turnOn() {
    setBusy("on");
    setSaid(null);
    const r = await enablePush();
    setBusy(null);
    if (r.state === "failed") return setSaid({ text: c.failed, tone: "problem" });
    setView(r.state);
    if (r.state === "on") setSaid({ text: r.sent > 0 ? c.turnedOnSent : c.turnedOn, tone: "done" });
  }

  async function retry() {
    setBusy("retry");
    setSaid(null);
    const s = await readPushStatus().catch(() => null);
    if (s && s.permission === "granted") {
      const r = await enablePush();
      setBusy(null);
      setView(r.state === "failed" ? "off" : r.state);
      setSaid(r.state === "on" ? { text: r.sent > 0 ? c.turnedOnSent : c.turnedOn, tone: "done" } : { text: c.failed, tone: "problem" });
      return;
    }
    setBusy(null);
    if (s) setView(s.state);
    setSaid({ text: c.retryStill, tone: "problem" });
  }

  async function test() {
    setBusy("test");
    setSaid(null);
    const sent = await sendTestPush();
    setBusy(null);
    setSaid(sent > 0 ? { text: c.testSent, tone: "done" } : { text: c.testNone, tone: "problem" });
  }

  async function turnOff() {
    setBusy("off");
    setSaid(null);
    const state = await disablePush();
    setBusy(null);
    if (state === "failed") return setSaid({ text: c.failed, tone: "problem" });
    setView("off");
    setSaid({ text: c.turnedOff, tone: "done" });
  }

  const result = said ? (
    <Said tone={said.tone} testId="push-result">
      {said.text}
    </Said>
  ) : null;

  /** the screen's one sentence: where this phone's reminders stand */
  const state = (words: string) => (
    <span data-rp="headline" data-variant="status">
      {words}
    </span>
  );

  const whatComes = (
    <>
      <ListCard heading={c.whatLabel}>
        {slots.length ? slots.map((s) => <ListItem key={s.slot} title={s.name} sub={s.when} attrs={ROW} />) : <ListItem title={c.noMeds} attrs={ROW} />}
        <ListItem title={c.lockLabel} sub={c.lockValue} attrs={ROW} />
      </ListCard>
      {recent.length > 0 && (
        <div className="rpu-stack" data-testid="push-recent" data-opened={recent.filter((r) => r.wasOpened).length}>
          <SectionLabel>{c.recentLabel}</SectionLabel>
          <Timeline>
            {recent.map((r, i) => (
              <TimelineItem key={i} node={r.wasOpened ? "ok" : "miss"} time={r.when} title={r.what} note={r.opened} />
            ))}
          </Timeline>
        </div>
      )}
    </>
  );

  // Android's offer, caught once for the whole app (lib/push/install.ts): the button is there whichever page was open
  // when the browser made it
  const installButton = <InstallButton locale={locale} disabled={busy !== null} onDone={(o) => o === "accepted" && setSaid({ text: c.installed, tone: "done" })} />;

  let body: ReactNode;
  switch (view) {
    case "checking":
      body = <LoadingState locale={locale} lines={3} button />;
      break;
    case "needs_home_screen":
      body = (
        <div className="rpu-stack">
          <Box variant="acc" title={state(sentence(c.iosTitle, locale))}>
            {c.iosLede}
          </Box>
          <HomeScreenLine locale={locale} />
        </div>
      );
      break;
    case "unsupported":
      body = (
        <>
          <div className="rpu-stack">
            <Box variant="line" title={state(sentence(c.unsupportedTitle, locale))}>
              {c.unsupportedLede}
            </Box>
            {result}
          </div>
          <ActionDock>{installButton}</ActionDock>
        </>
      );
      break;
    case "denied":
      body = (
        <>
          <div className="rpu-stack">
            <Box variant="line" title={state(sentence(c.deniedTitle, locale))}>
              {c.deniedLede}
            </Box>
            <P>{c.deniedAndroid}</P>
            <P>{c.deniedIos}</P>
            {result}
          </div>
          <ActionDock>
            <SecondaryButton pending={busy === "retry"} onClick={() => void retry()} data-testid="push-retry">
              {c.retry}
            </SecondaryButton>
            {installButton}
          </ActionDock>
        </>
      );
      break;
    case "on":
      body = (
        <>
          <div className="rpu-stack">
            <Timeline>
              <TimelineItem node="ok" title={state(sentence(c.onTitle, locale))} note={c.onLede} />
            </Timeline>
            {result}
            {whatComes}
          </div>
          <ActionDock>
            <SecondaryButton pending={busy === "test"} disabled={busy !== null && busy !== "test"} onClick={() => void test()} data-testid="push-test">
              {busy === "test" ? c.testing : c.test}
            </SecondaryButton>
            {installButton}
            <SecondaryButton pending={busy === "off"} disabled={busy !== null && busy !== "off"} onClick={() => void turnOff()} data-testid="push-off">
              {busy === "off" ? c.turningOff : c.turnOff}
            </SecondaryButton>
          </ActionDock>
        </>
      );
      break;
    default:
      // "default" (never asked), "off" (allowed, this phone not subscribed), "failed" (the last try did not get through)
      body = (
        <>
          <div className="rpu-stack">
            <Box variant="acc" title={state(sentence(view === "off" ? c.offTitle : c.defaultTitle, locale))}>
              {view === "off" ? c.offLede : c.defaultLede}
            </Box>
            {result}
            {whatComes}
          </div>
          <ActionDock>
            <div>
              <PrimaryButton pending={busy === "on"} onClick={() => void turnOn()} data-testid="push-on">
                {busy === "on" ? c.turningOn : c.turnOn}
              </PrimaryButton>
              {view !== "off" && <ButtonNote>{c.askHint}</ButtonNote>}
            </div>
            {installButton}
          </ActionDock>
        </>
      );
  }

  return (
    <Screen locale={locale} fill="viewport">
      <div data-testid="page-me-notifications" data-state={view} style={{ display: "flex", flexDirection: "column", flex: 1 }}>
        <PageHeader locale={locale} back={{ href: "/p/me", label: c.back }} title={c.pageTitle} />
        {body}
      </div>
    </Screen>
  );
}
