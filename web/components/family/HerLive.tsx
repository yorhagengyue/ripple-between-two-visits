"use client";

/**
 * Her other screens follow him too (C2 track D, the one-second fix round; real-app 2.22 「他关一项：她那边 1 秒内跟着变」,
 * 「她开着的页面 1 秒内显示『爸爸已经停止分享』」). Her home and the no-reply screen were live; the week, 「爸爸让你看到的」, one
 * visit's record and her recording screen were plain server pages, so his notes stayed on her screen after he switched
 * them off, until she left the page. A server page wraps what it renders in <HerLive>:
 *
 *   his switch goes off    every <WhileShared grant="..."> for that switch is taken out of the page at once (the copy
 *                          of his words leaves the DOM), then the server renders the page again from his switches as
 *                          they are (router.refresh: the week goes back to her home, a visit says it is not shared)
 *   her link ends          the whole screen is replaced by 「爸爸停止了分享。」 at once, without asking the server
 *                          (which would take a few round trips to say the same); 「打电话给爸爸」 stays (his number
 *                          from this phone, or asked for once), and 「我的」 at the top right (her own account)
 * The stream's first frame is his switches as they are now, so a change between the server render and the connection
 * is caught too. `version` is the change of his switches the page was rendered at: frames that are not newer are
 * ignored (no refresh on every connect).
 */
import { useRouter } from "next/navigation";
import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import type { BusEvent } from "@/lib/bus";
import { EmptyBlock, FamilyButton, FamilyDock, FamilyScreen, FamilyTop } from "@/components/family-ui";
import { savedPhone } from "@/lib/care/device";
import { hc } from "@/lib/care/her-copy";
import { herPaths } from "@/lib/care/her-view";
import type { Locale } from "@/lib/i18n";
import type { FamilyGrantItems } from "@/lib/store/types";
// fe-d (the v3 draft's H1, H2): the ended screen as her home draws it; 「打电话给爸爸」 asks for his number when none is saved
import { CallDad } from "./CallDad";
// line bind (round two, only add): 「绑定另一位长辈」 on the screen that says her link is over
import { BindAgainButton } from "./BindAgain";
import { switchesOf, useFamilyStream, type EndedBy } from "./useFamilyStream";

type Grant = keyof FamilyGrantItems;

const OffNow = createContext<ReadonlySet<Grant>>(new Set());

export function HerLive({
  linkId,
  since,
  version,
  locale,
  dad,
  langHref,
  listen,
  children,
}: {
  /** scene 1 (10-15): every event her stream brings, for a page that follows more than his switches (his visit, live) */
  listen?: (e: BusEvent) => void;
  linkId: string;
  since: number;
  /** which change of his switches the server rendered this page at (the link's grant version) */
  version: number;
  locale: Locale;
  dad: string;
  langHref: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [ended, setEnded] = useState<EndedBy | null>(null);
  const [endedAt, setEndedAt] = useState<number | null>(null);
  const [off, setOff] = useState<ReadonlySet<Grant>>(new Set());
  const [phone, setPhone] = useState<string | null>(null);
  const seen = useRef(version);

  const live = useFamilyStream(ended ? null : linkId, since, {
    onEvent: (e) => {
      listen?.(e);
      const switches = switchesOf(e);
      if (!switches) return;
      if (switches.version !== null && switches.version <= seen.current) return;
      if (switches.version !== null) seen.current = switches.version;
      // first what she may no longer see, then the page again from the server
      setOff(new Set((Object.keys(switches.items) as Grant[]).filter((k) => !switches.items[k])));
      router.refresh();
    },
    onEnd: (by) => {
      setEnded(by);
      setEndedAt(Date.now());
      setPhone(savedPhone(linkId)); // Dad's number, kept on this phone: the one button the ended screen keeps
    },
  });

  return (
    <div className="contents" data-testid="her-live" data-live={ended ? "closed" : live} data-state={ended ? (ended === "gone" ? "gone" : "ended") : "shown"} data-ended={ended ?? undefined} data-ended-at={endedAt ?? undefined} data-off={[...off].sort().join(" ") || undefined}>
      {ended ? (
        <FamilyScreen locale={locale}>
          {/* 「我的」 stays for H1 and H2 (her own account's rows need no link in force); a link that is gone has none */}
          <FamilyTop brand locale={locale} langHref={langHref} meHref={ended === "gone" ? undefined : herPaths(linkId).me} />
          <EmptyBlock
            title={ended === "family" ? hc(locale, "leftTitle", { dad }) : ended === "gone" ? hc(locale, "goneTitle") : hc(locale, "endedTitle", { dad })}
            detail={ended === "family" ? hc(locale, "leftBody", { dad }) : ended === "gone" ? hc(locale, "goneBody") : hc(locale, "endedBody", { dad })}
          />
          {/* line bind (round two): on each of the three, the quiet way back to the form 「填长辈的账号」 */}
          <FamilyDock foot="h">
            {ended !== "gone" && <CallDad linkId={linkId} locale={locale} dad={dad} phone={phone} variant={ended === "family" ? "secondary" : "primary"} onSaved={setPhone} />}
            <BindAgainButton locale={locale} />
            {ended === "family" && (
              <FamilyButton href={herPaths(linkId).remove} variant="quiet" data-testid="ended-delete">
                {hc(locale, "deleteAccount")}
              </FamilyButton>
            )}
          </FamilyDock>
        </FamilyScreen>
      ) : (
        <OffNow value={off}>{children}</OffNow>
      )}
    </div>
  );
}

/**
 * A part of her screen that shows one of his sections (his notes, a visit's lines, the week): rendered only while her
 * stream has not said its switch is off. `all`: the part needs every one of these switches.
 */
export function WhileShared({ grant, children }: { grant: Grant | readonly Grant[]; children: ReactNode }) {
  const off = useContext(OffNow);
  const needs = typeof grant === "string" ? [grant] : grant;
  return needs.some((k) => off.has(k)) ? null : <>{children}</>;
}
