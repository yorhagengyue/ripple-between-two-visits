"use client";

/**
 * Her notifications (the v3 draft's A4b; also read by 「我的」 and by her home's line): asked only from her own tap.
 * Turning them on is the only way his no-reply alert reaches her phone; a refusal says where to change it, with no
 * nagging.
 *
 * The tap calls track I's enablePush (lib/push/client.ts) directly: the browser's question, /sw.js, the subscription
 * with the server's VAPID key, POST /api/push/subscribe (requireUser: she has no space), and 「通知已经开好了」 to this
 * phone. lib/jobs' family_no_reply notice then reaches it through I's sender, which asks lib/care/recipients.ts
 * mayNotifyFamily at send time.
 *
 * The step shows what the notification will look like (「通知会是这样」), drawn: the words are the real notice's own
 * (lib/daily/i18n.ts notice.family.*, the ones lib/daily/dose-run.ts sends), with his reminder times when his medicine
 * is shared. After the tap the screen says how it went and the button becomes 「知道了」 (kept from before the draft,
 * which moves on by itself: she sees that it worked, or why it did not). 「以后再说」 is in the top bar.
 */
import { useState } from "react";
import { BannerPreview, FamilyButton, FamilyDock, FamilyHero, NoticeRow } from "@/components/family-ui";
import { hm } from "@/lib/care/copy";
import { hc } from "@/lib/care/her-copy";
import type { SlotView } from "@/lib/care/home-types";
import { dt, type DailyKey } from "@/lib/daily/i18n";
import type { Locale } from "@/lib/i18n";
import { enablePush, type PushState } from "@/lib/push/client";

export type { PushState } from "@/lib/push/client";

export function pushWords(state: PushState, locale: Locale): string | null {
  if (state === "on") return hc(locale, "pushDone");
  if (state === "denied") return hc(locale, "pushDenied");
  if (state === "needs_home_screen") return hc(locale, "pushHomeScreen");
  if (state === "unsupported") return hc(locale, "pushUnsupported");
  if (state === "failed") return hc(locale, "pushFailed");
  return null;
}

/**
 * The notice she would get, in its own words (as lib/daily/dose-run.ts writes it): 「爸爸还没回早上的药」 and, with his
 * reminder times, 「8:45 和 9:15 两次提醒都没有回。」. `who`: the name on his link, as the notice uses it (else 「家人」).
 */
export function noticePreview(locale: Locale, who: string | null | undefined, slot: SlotView | null | undefined): { title: string; body: string } {
  const key = `slotMed.${slot?.slot ?? "morning"}` as DailyKey;
  return {
    title: dt(locale, "notice.family.title", { who: who?.trim() || dt(locale, "notice.family.who"), slotMed: dt(locale, key).toLowerCase() }),
    body: slot ? dt(locale, "notice.family.body", { first: hm(slot.first), second: hm(slot.second) }) : hc(locale, "noReplyDetail"),
  };
}

export function PushStep({ locale, dad, who, onDone, slot }: { locale: Locale; dad: string; /** the name on his link, as the notice says it */ who?: string | null; onDone: () => void; /** his slot today, for the preview's times; null: not shared */ slot?: SlotView | null }) {
  const [state, setState] = useState<PushState | null>(null);
  const [pending, setPending] = useState(false);
  const said = state ? pushWords(state, locale) : null;
  const preview = noticePreview(locale, who, slot);
  return (
    <>
      <FamilyHero tone="quiet" title={hc(locale, "pushTitle")} detail={hc(locale, "pushBody", { dad })} />
      <p className="rpf rpf-section" style={{ marginTop: 32, marginBottom: 0 }}>
        {hc(locale, "pushPreview")}
      </p>
      <BannerPreview title={preview.title} time={hc(locale, "pushPreviewNow")} body={preview.body} />
      {said && (
        <NoticeRow icon={state === "on" ? "check" : "dash"} data-testid="push-state" data-state={state ?? undefined} style={{ marginTop: 16, borderTop: "1px solid var(--rpf-hair)" }}>
          {said}
        </NoticeRow>
      )}
      <FamilyDock foot="c">
        {state === "on" ? (
          <FamilyButton onClick={onDone} data-testid="push-next">
            {hc(locale, "gotIt")}
          </FamilyButton>
        ) : (
          <FamilyButton
            pending={pending}
            data-testid="push-on"
            onClick={async () => {
              setPending(true);
              const r = await enablePush({ welcome: true });
              setPending(false);
              setState(r.state);
            }}
          >
            {hc(locale, "pushOn")}
          </FamilyButton>
        )}
      </FamilyDock>
    </>
  );
}
