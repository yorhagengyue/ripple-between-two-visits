import type { ReactNode } from "react";
import { cx } from "@/lib/ui/props";
import type { DataAttrs } from "./AuthScreen";

/**
 * The screens the iOS app has no counterpart for (a text he agrees to, his recovery code, the card he prints), built
 * from the same parts: RippleCard's surface block with its hairline and 20px corners, the small tracked label, the
 * same text styles.
 */

/** RippleCard: a surface block with a hairline edge and 20px corners. */
export function AuthCard({ children, className, ...data }: { children: ReactNode; className?: string } & DataAttrs) {
  return (
    <div className={cx("rpa-ios-card", className)} {...data}>
      {children}
    </div>
  );
}

/** A consent text as published, in a card: paragraphs, and list items for the ones starting with 「· 」. */
export function AuthParagraphs({ paragraphs, testId }: { paragraphs: readonly string[]; testId?: string }) {
  return (
    <div className="rpa-ios-card rpa-ios-paragraphs" data-rp="paragraphs" data-testid={testId}>
      {paragraphs.map((p, i) => (
        <p key={i} data-item={p.startsWith("· ") ? "true" : undefined} data-rp-role="body">
          {p}
        </p>
      ))}
    </div>
  );
}

/** A line that opens a text under it (her sign-up's 「读条款全文」): the items in a card. */
export function AuthMore({ summary, items }: { summary: string; items: readonly string[] }) {
  return (
    <details className="rpa-ios-more" data-rp="more">
      <summary>{summary}</summary>
      <div className="rpa-ios-card rpa-ios-paragraphs">
        <ul>
          {items.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </div>
    </details>
  );
}

/**
 * The recovery code as he copies it: large, evenly spaced, selected whole by one tap. `label`, when given, is read out
 * before the code, which is then spelt one character at a time.
 */
export function AuthCode({ code, label, testId = "recovery-code" }: { code: string; label?: string; testId?: string }) {
  return (
    <p className="rpa-ios-code" data-rp="code" data-testid={testId} aria-label={label ? `${label}: ${code.split("").join(" ")}` : undefined}>
      {code}
    </p>
  );
}

/** The card he prints (or photographs): the app, his account, the code, and how to use it. On paper it is black on white. */
export function AuthRecoveryCard({ copy, login, code }: { copy: { cardTitle: string; cardAccount: string; cardCode: string; cardUse: string }; login: string; code: string }) {
  return (
    <section className="rpa-ios-recovery-card" data-rp="recovery-card" data-testid="recovery-card" aria-label={copy.cardTitle}>
      <p className="rpa-ios-recovery-title">{copy.cardTitle}</p>
      <p className="rpa-ios-recovery-row">
        <strong>{copy.cardAccount}</strong>
        {login}
      </p>
      <p className="rpa-ios-recovery-row">
        <strong>{copy.cardCode}</strong>
        <span className="rpa-ios-recovery-code">{code}</span>
      </p>
      <p className="rpa-ios-recovery-row" data-use="true">
        {copy.cardUse}
      </p>
    </section>
  );
}
