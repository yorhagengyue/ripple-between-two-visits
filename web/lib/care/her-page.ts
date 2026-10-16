/**
 * Her sub-pages' start (C2 track D): the page subject through her active link, her language and the pieces every
 * screen of hers needs. Anything else (signed out, no link, a link that is waiting or ended) goes back to /f, which
 * says what is going on. The four screens about her own account start at herOwnPage instead: they stay open once her
 * link has ended. Server-only.
 */
import { redirect } from "next/navigation";
import { NO_GRANTS } from "@/lib/family/types";
import { otherLocale, type Locale } from "@/lib/i18n";
import { getPatientLocale } from "@/lib/session/server";
import { scopeD0, scopeNow, scopeTz } from "@/lib/store/scope";
import type { CareLinkRow, FamilyGrantItems, SessionRow, Store } from "@/lib/store/types";
import { storyDate } from "@/lib/story/clock";
import { zonedTimeToUtcMs } from "@/lib/time/clock";
import { getPageSubject, type PageSubject } from "@/lib/subject";
import { getPageUser } from "@/lib/subject/care";
import { nowMs } from "@/lib/time/now";
import { dadWord } from "./copy";
import { herPaths } from "./her-view";
import { familyLinks } from "./links";
import { isHeld } from "./reconsent";

export interface HerPage {
  ctx: PageSubject;
  link: CareLinkRow;
  userId: string;
  locale: Locale;
  dad: string;
  tz: string;
  paths: ReturnType<typeof herPaths>;
  langHref: string;
  /**
   * The family texts asked again (lib/care/reconsent.ts): he or she has not agreed to the family text in force for this
   * link, so her store hands every reader the alert-only form; her screens say why in one quiet line
   */
  reconsent: boolean;
}

export async function herPage(sp: Record<string, string | string[] | undefined>, path: string): Promise<HerPage> {
  const link = typeof sp.link === "string" ? sp.link : undefined;
  const [ctx, locale] = await Promise.all([getPageSubject(link), getPatientLocale()]);
  if (!link || !ctx || ctx.subject.relation !== "family" || !ctx.subject.link || !ctx.subject.userId) redirect(link ? `/f?link=${encodeURIComponent(link)}` : "/f");
  const l = ctx.subject.link;
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") query.set(k, v);
  const here = `${path}?${query.toString()}`;
  return {
    ctx,
    link: l,
    userId: ctx.subject.userId,
    locale,
    dad: dadWord(l.patient_label, locale),
    tz: scopeTz(ctx.session),
    paths: herPaths(l.id),
    langHref: `/api/profile/lang?to=${otherLocale(locale)}&next=${encodeURIComponent(here)}`,
    reconsent: isHeld(ctx.subject.consent),
  };
}

/** How a link of hers ended: he stopped sharing, she left, or he said the person who accepted was not her. */
export type HerEndedState = "revoked" | "left" | "declined";

const isEnded = (state: string): state is HerEndedState => state === "revoked" || state === "left" || state === "declined";

export interface HerOwnPage {
  locale: Locale;
  /** her active link: the screen as it always was (the whole of 「我的」) */
  active: HerPage | null;
  /** the link in the address is hers and over: only what concerns her own account is left on 「我的」 */
  ended: HerEndedState | null;
  dad: string;
  paths: ReturnType<typeof herPaths>;
  langHref: string;
}

/**
 * The start of the four screens about her own account: 「我的」 and, under it, a new password, the devices she signed in
 * on and a new recovery code (the fe-d2 follow-up). They are about her sign-in, not about his records (their routes
 * know the person by the sign-in; real-app 3.9 gives her account row to her as it gives his to him, and 2.22, 3.10 and
 * 3.11 close only what goes through the link), so a link that has ended does not close them.
 *
 *   her active link                      as herPage: `active`, everything
 *   a link of hers that is over          `ended` says how; 「我的」 shows her own account's rows alone, and its way back
 *                                        is /f?link=, which says what happened. An account with a space of its own has
 *                                        all of this under its own 「我」 (/p/me) and is sent there.
 *   anything else                        as herPage: back to /f (signed out, no link named, a link that is not hers or
 *                                        no longer exists, one still waiting for him)
 *
 * Her link is asked for only when the address names one that did not open: the active page reads nothing more.
 */
export async function herOwnPage(sp: Record<string, string | string[] | undefined>, path: string): Promise<HerOwnPage> {
  const link = typeof sp.link === "string" ? sp.link : undefined;
  const ctx = link ? await getPageSubject(link) : null;
  if (link && !(ctx && ctx.subject.relation === "family" && ctx.subject.link)) {
    const me = await getPageUser();
    const mine = me ? (await familyLinks(me.store, me.user.userId, nowMs())).find((l) => l.id === link) : undefined;
    if (me && mine && isEnded(mine.state)) {
      if (me.scope) redirect("/p/me");
      const locale = await getPatientLocale();
      const query = new URLSearchParams();
      for (const [k, v] of Object.entries(sp)) if (typeof v === "string") query.set(k, v);
      return {
        locale,
        active: null,
        ended: mine.state,
        dad: dadWord(mine.patientLabel, locale),
        paths: herPaths(mine.id),
        langHref: `/api/profile/lang?to=${otherLocale(locale)}&next=${encodeURIComponent(`${path}?${query.toString()}`)}`,
      };
    }
  }
  const active = await herPage(sp, path);
  return { locale: active.locale, active, ended: null, dad: active.dad, paths: active.paths, langHref: active.langHref };
}

/**
 * His switches for her link with which change of them this is (the grant row's version): her pages hand the version to
 * their live part (components/family/HerLive.tsx, FamilyApp), which ignores a frame that is not newer.
 */
export async function herSwitches(store: Pick<Store, "getFamilyGrant">, scope: Pick<SessionRow, "id">, linkId: string): Promise<{ items: FamilyGrantItems; version: number }> {
  const row = await store.getFamilyGrant(scope.id, linkId);
  return { items: { ...NO_GRANTS, ...(row?.items ?? {}) }, version: row?.version ?? 0 };
}

let clockReads = 0;

/**
 * Track B's day clock for her pages (components/daily/elder/DayClock.tsx; real-app 2.7 「新加坡 0 点，开着的页面自己换到
 * 新的一天」, the table's last row: her phone 「同」): his "now" (a filming account's offset included), his zone and date,
 * and the next moment her page should be read again: his midnight, or sooner one of `times` ("08:45", today's reminder
 * moments, only where the page shows them). Nothing is read for it: the scope row is already here.
 */
export function herDayClock(scope: SessionRow, nowMs: number, times: readonly string[] = []): { stamp: number; serverNowMs: number; tz: string; date: string; nextAtMs: number } {
  const at = scopeNow(scope, nowMs);
  const d0 = scopeD0(scope);
  const tz = scopeTz(scope);
  const date = storyDate(d0, scope.story_day);
  const midnight = zonedTimeToUtcMs(storyDate(d0, scope.story_day + 1), "00:00", tz);
  const moments = times.filter((t) => /^\d{1,2}:\d{2}$/.test(t)).map((t) => zonedTimeToUtcMs(date, t, tz)).filter((m) => m > at);
  clockReads = (clockReads + 1) % 1_000_000_000;
  return { stamp: clockReads, serverNowMs: at, tz, date, nextAtMs: Math.min(midnight, ...moments) };
}
