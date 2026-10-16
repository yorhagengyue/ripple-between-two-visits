/**
 * Small pieces the screens under 「我」 share (line fe-me; web/progress/fe-me.md), each made of the foundation's own
 * parts (components/ui, app/ripple-ui.css) so that every screen here is in the timeline draft's look:
 *
 *   P              a paragraph of the screen itself: the draft's `p` (21px; "large" 24px for a screen's first sentence;
 *                  `quiet` grey)
 *   ConsentText    a consent text as published: its paragraphs, the ones starting with 「· 」 hanging under their dot
 *   StepHeader     a header whose way back is a button: the second screen of a two-step flow goes back to its first
 *                  in place (PageHeader's way back is a link)
 *   CodeFrame      the recovery code in the draft's frame, read out one character at a time
 *   Said           what a tap just did, or why it did not: a tinted box (done) or a red one (it did not work)
 * No hooks here, so a server page can use them as they are. The password field is PasswordInput.tsx (a client file).
 */
import type { ReactNode } from "react";
import { HeaderUnder } from "@/components/ui/AccountHeader";
import { Box } from "@/components/ui/Box";
import { Icon } from "@/components/ui/icons";
import { cx } from "@/lib/ui/props";
import "./me.css";

export function P({
  children,
  size,
  quiet = false,
  strong = false,
  indent = false,
  testId,
  role,
  lang,
}: {
  children: ReactNode;
  size?: "large" | "small";
  quiet?: boolean;
  strong?: boolean;
  /** start where a timeline's text starts */
  indent?: boolean;
  testId?: string;
  role?: "status" | "alert";
  lang?: string;
}) {
  return (
    <p className={cx("rpu rpm-p", indent && "rpu-ind")} data-rp="text" data-rp-role="body" data-size={size} data-quiet={quiet ? "true" : undefined} data-strong={strong ? "true" : undefined} data-testid={testId} role={role} lang={lang}>
      {children}
    </p>
  );
}

export function ConsentText({ title, paragraphs, testId }: { title?: ReactNode; paragraphs: readonly string[]; testId?: string }) {
  return (
    <div className="rpu rpm-text" data-testid={testId}>
      {title != null && title !== "" && (
        <p data-strong="true" data-rp-role="body">
          {title}
        </p>
      )}
      {paragraphs.map((p, i) => (
        <p key={i} data-item={p.startsWith("· ") ? "true" : undefined} data-rp-role="body">
          {p}
        </p>
      ))}
    </div>
  );
}

export function StepHeader({ backLabel, onBack, title, subtitle }: { backLabel?: string; onBack?: () => void; title?: ReactNode; subtitle?: ReactNode }) {
  return (
    <>
      <div className="rpu rpu-meta" data-rp="meta">
        {onBack && backLabel && (
          <button type="button" className="rpu-back rpm-back-btn" data-rp="back" onClick={onBack} data-testid="step-back">
            <Icon name="back" stroke={2.8} />
            {backLabel}
          </button>
        )}
        {(title != null || subtitle != null) && (
          <div className="rpu-meta-row">
            <div className="rpu-meta-text">
              {title != null && (
                <h1 className="rpu-meta-title" data-rp="page-title">
                  {title}
                </h1>
              )}
              {subtitle != null && (
                <span className="rpu-meta-story" data-rp="meta-story">
                  {subtitle}
                </span>
              )}
            </div>
          </div>
        )}
      </div>
      <HeaderUnder />
    </>
  );
}

export function CodeFrame({ code, label, note, testId = "recovery-code" }: { code: string; label: string; note?: ReactNode; testId?: string }) {
  return (
    <div className="rpu rpu-code rpm-code" data-rp="recovery-code">
      <p className="rpu-code-t" translate="no" data-testid={testId} aria-label={`${label}: ${code.split("").join(" ")}`}>
        {code}
      </p>
      {note != null && <p className="rpu-code-s">{note}</p>}
    </div>
  );
}

export function Said({ tone, children, testId, indent }: { tone: "done" | "problem"; children: ReactNode; testId?: string; indent?: boolean }) {
  return (
    <Box variant={tone === "problem" ? "red" : "tint"} indent={indent}>
      <span role={tone === "problem" ? "alert" : "status"} data-testid={testId} data-tone={tone}>
        {children}
      </span>
    </Box>
  );
}
