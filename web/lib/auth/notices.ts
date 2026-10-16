/**
 * What his Today page says at the top after his password was reset (docs/plan/real-app.md 2.4, 3.6), so he knows if it
 * was not him:
 *
 *   with the recovery code      「你的密码在 10月9日 20:15 用恢复码重设过。」
 *   with a family member's help 「你的密码在 10月9日 20:15 由 Wei Ling 协助重设。」 (the name he gave her; 「家人」 without one)
 *   by the team's script        「你的密码在 10月9日 20:15 由 Ripple 团队重设。」 (test and filming accounts only)
 *
 * Said once: the line is there the next times he opens Today until he taps 「知道了」 (POST /api/auth/notice-seen writes
 * an account event reset_notice_seen naming the reset), and no longer than three days after the reset. A later reset
 * brings a new line. Pure: the page reads his account events through its scoped store (listAccountEvents is his own)
 * and passes them in; components/account/ResetNoticeLine.tsx shows it.
 *
 *   const events = await ctx.store.listAccountEvents(ctx.subject.userId!);
 *   const notice = passwordResetNotice(events, nowMs, locale);   // null: nothing to say
 */
import type { AccountEventRow } from "@/lib/store/types";
import { dayAndTime, type AccountLocale } from "./copy";

/** How long the line can stay on his Today page after the reset. */
export const RESET_NOTICE_MS = 3 * 24 * 3600 * 1000;

/** The account event he writes by tapping 「知道了」: detail { event: <the password_reset event's id> }. */
export const RESET_NOTICE_SEEN = "reset_notice_seen";

export interface ResetNotice {
  /** the password_reset event this is about (what 「知道了」 names) */
  event: string;
  method: "recovery_code" | "family_assisted" | "manual";
  /** the sentence */
  text: string;
  /** what to do if it was not him */
  hint: string;
  /** the button */
  ok: string;
}

/** The line for his latest password reset (the last three days, not yet acknowledged), or null. */
export function passwordResetNotice(events: readonly AccountEventRow[], nowMs: number, locale: AccountLocale): ResetNotice | null {
  const last = [...events].reverse().find((e) => e.kind === "password_reset");
  if (!last) return null;
  const at = Date.parse(last.created_at);
  if (!Number.isFinite(at) || nowMs - at > RESET_NOTICE_MS || at > nowMs + 60_000) return null;
  if (events.some((e) => e.kind === RESET_NOTICE_SEEN && e.detail?.event === last.id)) return null;
  const when = dayAndTime(last.created_at, locale);
  const en = locale === "en";
  const family = last.detail?.method === "family_assisted";
  const manual = last.detail?.method === "manual";
  const helper = typeof last.detail?.helper === "string" && last.detail.helper.trim() ? last.detail.helper.trim().slice(0, 40) : null;
  const text = family
    ? en
      ? `Your password was reset on ${when} with help from ${helper ?? "a family member"}.`
      : `你的密码在 ${when} 由 ${helper ?? "家人"} 协助重设。`
    : manual
      ? en
        ? `Your password was reset by the Ripple team on ${when}.`
        : `你的密码在 ${when} 由 Ripple 团队重设。`
      : en
        ? `Your password was reset with the recovery code on ${when}.`
        : `你的密码在 ${when} 用恢复码重设过。`;
  return {
    event: last.id,
    method: family ? "family_assisted" : manual ? "manual" : "recovery_code",
    text,
    hint: en ? "If this was not you, change your password under Me." : "如果不是你自己做的，请到「我」里改密码。",
    ok: en ? "OK" : "知道了",
  };
}
