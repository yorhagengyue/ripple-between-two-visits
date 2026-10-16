"use client";

/**
 * Her invitation screen (the v3 draft's A1), the interactive half: signed in, 「接受」 accepts here (POST
 * /api/family/invites/accept) and opens her page, which waits for him to confirm; signed out, 「接受」 goes to her short
 * sign-up, which offers the login (「已经有账号？登录」); both come back and accept. The words she agrees to (family_accept) are
 * on the screen, and her record points at them.
 */
import { useState } from "react";
import { InviteAccept, type SharedItem } from "@/components/family-ui";
import { elderWords } from "@/lib/care/copy";
import type { Locale } from "@/lib/i18n";

/** Why her 「接受」 did not go through, in words. `dad`: how the invitation names him (他 / 她 by it, or that word). */
export function acceptError(code: string | undefined, locale: Locale, dad: string | null | undefined): string {
  const zh = locale === "zh-Hans";
  const w = elderWords(dad, locale);
  switch (code) {
    case "invite_expired":
      return zh ? `这个邀请过期了。请${w.him}重新发一个。` : `This invitation has expired. Ask ${w.him} for a new one.`;
    case "invite_used":
    case "invite_not_found":
      return zh ? `这个邀请用不了了。请${w.him}重新发一个。` : `This invitation can't be used. Ask ${w.him} for a new one.`;
    case "invite_self":
      return zh ? "不能接受自己发出的邀请。" : "You can't accept your own invitation.";
    case "link_exists":
      return zh ? `你已经在看${w.his} Ripple 了。` : `You already follow ${w.his} Ripple.`;
    default:
      return zh ? "现在连不上，邀请还在。请再试一次。" : "Can't connect right now. The invitation is still there: try again.";
  }
}

/** Accept with this browser's sign-in; resolves to where her page is, or the error words (`dad`: how the invitation names him). */
export async function acceptInvite(token: string, locale: Locale, dad: string | null | undefined): Promise<{ next: string } | { error: string; code?: string }> {
  try {
    const res = await fetch("/api/family/invites/accept", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }), credentials: "same-origin", cache: "no-store" });
    const body = (await res.json().catch(() => ({}))) as { next?: string; error?: string };
    if (res.ok && body.next) return { next: body.next };
    if (body.error === "link_exists") return { next: "/f" };
    return { error: acceptError(body.error, locale, dad), code: body.error };
  } catch {
    return { error: acceptError(undefined, locale, dad) };
  }
}

export function InviteScreen({
  locale,
  token,
  dad,
  signedIn,
  shares,
  notSeen,
  consent,
  joinHref,
}: {
  locale: Locale;
  token: string;
  dad: string;
  signedIn: boolean;
  shares: SharedItem[];
  /** what stays hidden unless he turns it on, in one sentence */
  notSeen: string;
  consent: { title: string; paragraphs: string[] };
  joinHref: string;
  /** kept for callers: the login is offered on her sign-up screen (A2), as the draft has it */
  loginHref?: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const zh = locale === "zh-Hans";
  return (
    <InviteAccept
      state="invite"
      locale={locale}
      inviter={dad}
      shares={shares}
      notSeen={notSeen}
      pending={pending}
      acceptHref={signedIn ? undefined : joinHref}
      onAccept={
        signedIn
          ? async () => {
              setPending(true);
              setError(null);
              const r = await acceptInvite(token, locale, dad);
              if ("next" in r) {
                window.location.assign(r.next);
                return;
              }
              setPending(false);
              setError(r.error);
            }
          : undefined
      }
      notNowHref="/"
    >
      {/* not in the draft, kept: the words she agrees to by accepting (her family_accept record points at them) */}
      <details className="rpf rpf-details" data-testid="invite-consent">
        <summary>{zh ? `接受就是同意：${consent.title}` : `Accepting means you agree: ${consent.title}`}</summary>
        <ul className="rpf-list">
          {consent.paragraphs.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </details>
      {error && (
        <p className="rpf rpf-error" role="alert" data-testid="invite-error">
          {error}
        </p>
      )}
    </InviteAccept>
  );
}
