"use client";

/**
 * 「给医生看」 (C2 track B, journey 14; real-app 2.18), in the timeline design (14-3 English, 14-4 华语, 14-5 his words not
 * translated): the screen he hands to the doctor. Full screen (no tab bar, no 「我」: the phone is in the doctor's hands),
 * English first with one tap to 华语 and back on the segmented control under the header (this screen only: his own
 * language setting is left alone), the phone kept awake while it is shown (Screen Wake Lock, where the browser has it),
 * and 「看完了」 back to his brief (the header's way back goes to the same place).
 * The blocks are components/brief/AccountBrief.tsx BriefBody: his words stay his (Chinese, with the checked English under
 * them, or marked "not translated"); the doctor's words are quoted as said.
 *
 * Opening it records that this page was shown (components/brief/BriefShown.tsx: which day, which version, when). With
 * `kept` it is a page shown earlier, drawn again from what was kept then (/p/brief?shown=<id>): it says so in the grey
 * box on top, and records nothing.
 */
import { useEffect, useState } from "react";
import { Box, DarkButton, Screen, UiLink } from "@/components/ui";
import { Icon } from "@/components/ui/icons";
import type { Locale } from "@/lib/i18n";
import type { AccountBriefView } from "@/lib/summary/account-brief";
import { bt } from "@/lib/summary/i18n";
import { uiCopy } from "@/lib/ui/copy";
import { BriefBody, BriefWindow } from "./AccountBrief";
import { BriefShown } from "./BriefShown";
import "./brief.css";

type WakeLockLike = { release(): Promise<void> };

/** The two languages of this page, in the order of the control; each one's name is written in its own language. */
const LANGS: readonly Locale[] = ["en", "zh-Hans"];
const langName = (l: Locale) => bt(l === "en" ? "zh-Hans" : "en", "brief.langSwitch");

export function DoctorBrief({
  views,
  homeLocale,
  kept,
  doneHref = "/p/brief",
}: {
  views: Record<Locale, AccountBriefView>;
  homeLocale: Locale;
  /** a page shown earlier (when, in his words): drawn from what was kept, never recorded again */
  kept?: { when: string };
  /** where 「看完了」 goes: his brief, or back into the visit it was opened from (C2 track V, real-app 2.12) */
  doneHref?: string;
}) {
  const [locale, setLocale] = useState<Locale>("en");
  const view = views[locale];
  const [awake, setAwake] = useState(false);

  useEffect(() => {
    let lock: WakeLockLike | null = null;
    let gone = false;
    const nav = navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<WakeLockLike> } };
    const take = () => {
      if (!nav.wakeLock || document.visibilityState !== "visible") return;
      nav.wakeLock
        .request("screen")
        .then((l) => {
          if (gone) void l.release();
          else {
            lock = l;
            setAwake(true);
          }
        })
        .catch(() => setAwake(false));
    };
    take();
    const again = () => take();
    document.addEventListener("visibilitychange", again);
    return () => {
      gone = true;
      document.removeEventListener("visibilitychange", again);
      if (lock) void lock.release();
    };
  }, []);

  return (
    <Screen locale={locale}>
      <div data-testid="brief-doctor" data-lang={locale} data-awake={awake ? "true" : "false"} data-kept={kept ? "true" : "false"}>
        {kept ? null : <BriefShown />}
        {/* the timeline design's header, drawn here because this page has no 「我」 and no line under the header */}
        <div className="rpu rpu-meta" data-rp="meta">
          <UiLink href={doneHref} nav="back" className="rpu-back" data-rp="back">
            <Icon name="back" stroke={2.8} />
            {uiCopy(locale).back}
          </UiLink>
          <div className="rpu-meta-row">
            <div className="rpu-meta-text">
              <h1 className="rpu-meta-title" data-rp="page-title">
                {bt(locale, "brief.for")}
              </h1>
              <span className="rpu-meta-story" data-rp="meta-story">
                <BriefWindow view={view} locale={locale} />
              </span>
            </div>
          </div>
        </div>
        <div className="rpu-stack">
          {kept ? (
            <Box variant="grey" testId="brief-kept-note">
              <span lang={homeLocale}>{bt(homeLocale, "brief.shown.kept", { when: kept.when })}</span>
            </Box>
          ) : null}
          <div className="rpu rpu-seg rp14b-seg" data-rp="segmented" role="group" aria-label={LANGS.map(langName).join(" / ")}>
            {LANGS.map((l) => (
              <button
                key={l}
                type="button"
                className="rpu-seg-item"
                data-seg={l}
                lang={l}
                aria-pressed={locale === l}
                onClick={() => setLocale(l)}
                // one tap to the other language: the hook sits on the one that is not shown now
                data-testid={locale === l ? undefined : "brief-doctor-lang"}
              >
                {langName(l)}
              </button>
            ))}
          </div>
          <BriefBody view={view} locale={locale} />
        </div>
        <div className="rpu rpu-dock" data-rp="dock">
          <DarkButton href={doneHref} nav="back" data-testid="brief-doctor-done">
            <span lang={homeLocale}>{bt(homeLocale, "brief.doneLooking")}</span>
          </DarkButton>
        </div>
      </div>
    </Screen>
  );
}
