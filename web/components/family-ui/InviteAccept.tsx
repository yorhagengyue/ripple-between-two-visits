import type { MouseEventHandler, ReactNode } from "react";
import { fill, familyCopy } from "@/lib/ui/copy";
import { cx, type FamilyBaseProps } from "@/lib/ui/props";
import type { UiLocale } from "@/lib/ui/tokens";
import { EmptyBlock } from "./FamilyBits";
import { FamilyButton } from "./FamilyButton";
import { FamilyDock, FamilyHero, FamilyNote } from "./FamilyScreen";
import type { SharedItem } from "./SharedSection";
import { FamilyError } from "./FamilyStates";
import { DayMark } from "./WeekStrip";

export type InviteState = "invite" | "waiting" | "done" | "used" | "error";

/**
 * Accepting Dad's one-time invitation (the v3 draft's A1, H3, in the words written before it): who invited her, what
 * she will see once he switches each item on (a dashed ring per item, nothing is on yet; under each name what exactly
 * she would see of it), the sentence about what stays hidden, 「接受」 and 「先不要」; a used or expired invitation says
 * so, what to do, and offers the login.
 */
export function InviteAccept({
  state,
  locale,
  inviter,
  shares,
  onAccept,
  acceptHref,
  notNowHref,
  homeHref,
  loginHref,
  onRetry,
  notSeen,
  waitTitle,
  usedTitle,
  usedBody,
  usedNote,
  pending,
  children,
  className,
  style,
}: FamilyBaseProps & {
  state: InviteState;
  locale: UiLocale;
  /** how he is named to her: 「爸爸」 / 「陈先生」 */
  inviter: string;
  /** what she can see once he switches it on (read only): the name and, under it, what exactly she would see */
  shares: readonly SharedItem[];
  onAccept?: MouseEventHandler<HTMLButtonElement>;
  acceptHref?: string;
  notNowHref?: string;
  homeHref?: string;
  /** a used or expired invitation: 「登录」 */
  loginHref?: string;
  onRetry?: () => void;
  /** what stays hidden unless he turns it on */
  notSeen?: ReactNode;
  waitTitle?: ReactNode;
  usedTitle?: ReactNode;
  usedBody?: ReactNode;
  usedNote?: ReactNode;
  pending?: boolean;
  /** more of the invitation screen (the consent words she agrees to, an error line) */
  children?: ReactNode;
}) {
  // the words say him the way the invitation names him (「妈妈邀请你看她的 Ripple」)
  const copy = familyCopy(locale, inviter);
  return (
    <section className={cx("rpf rpf-col", className)} data-rp="invite" data-state={state} data-testid="invite" style={style}>
      {state === "invite" && (
        <>
          <h1 className="rpf-h1" data-testid="family-headline">
            {fill(copy.inviteTitle, { name: inviter })}
          </h1>
          <p className="rpf-sub">{copy.inviteLead}</p>
          {shares.length > 0 && (
            <>
              <p className="rpf-perm-head">{copy.inviteSees}</p>
              <ul className="rpf-perm" data-testid="invite-sees">
                {shares.map((s, i) => (
                  <li key={s.grant ?? i} data-grant={s.grant}>
                    <DayMark mark="waiting" size={22} />
                    <span className="rpf-perm-text">
                      <span>{s.title}</span>
                      {s.detail ? <span className="rpf-perm-detail">{s.detail}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {notSeen && (
            <p className="rpf-note rpf-perm-note" data-testid="invite-not-seen">
              {notSeen}
            </p>
          )}
          {children}
          <FamilyDock foot="c">
            {acceptHref ? (
              <FamilyButton href={acceptHref} data-testid="invite-accept">
                {copy.inviteAccept}
              </FamilyButton>
            ) : (
              <FamilyButton onClick={onAccept} pending={pending} data-testid="invite-accept">
                {copy.inviteAccept}
              </FamilyButton>
            )}
            {notNowHref && (
              <FamilyButton href={notNowHref} variant="secondary" data-testid="invite-not-now">
                {copy.inviteNotNow}
              </FamilyButton>
            )}
          </FamilyDock>
        </>
      )}
      {state === "waiting" && (
        <>
          <FamilyHero tone="quiet" title={waitTitle ?? copy.inviteWaitTitle} detail={copy.inviteWaitBody} />
          <FamilyDock foot="n">
            <FamilyNote>{copy.sharedBy}</FamilyNote>
          </FamilyDock>
        </>
      )}
      {state === "done" && (
        <>
          <FamilyHero tone="ok" title={copy.inviteDoneTitle} detail={copy.inviteDoneBody} />
          <FamilyDock foot="c">{homeHref && <FamilyButton href={homeHref}>{copy.inviteOpenHome}</FamilyButton>}</FamilyDock>
        </>
      )}
      {state === "used" && (
        <>
          {/* the line about logging in belongs to the button under it: only when there is one */}
          <EmptyBlock title={usedTitle ?? copy.inviteUsedTitle} detail={usedBody ?? copy.inviteUsedBody} note={loginHref ? (usedNote ?? copy.inviteUsedNote) : undefined} />
          <FamilyDock foot="e">
            {loginHref && (
              <FamilyButton href={loginHref} variant="secondary" data-testid="invite-used-login">
                {copy.login}
              </FamilyButton>
            )}
          </FamilyDock>
        </>
      )}
      {state === "error" && (
        <FamilyError locale={locale} dad={inviter} onRetry={onRetry}>
          {copy.inviteError}
        </FamilyError>
      )}
    </section>
  );
}
