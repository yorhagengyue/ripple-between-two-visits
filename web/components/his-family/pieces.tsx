/**
 * The small pieces of his family screens (the timeline draft's 16-20; front-end line fe-fam): what several of those
 * screens share and the foundation has no piece for. Plain markup, no state and nothing server-only, so the pages
 * (server) and components/family/HisFamily.tsx (client) both use them.
 *
 *   HisScreen     one of his family screens: the draft's header (「‹ 家人」, the title, a grey line under it) on the paper
 *                 ground, with nothing fixed at the bottom (the draft's 16-20 have no tab bar and no say bar). The
 *                 page's own test hooks sit on a wrapper without a box of its own.
 *   Lead          the draft's large paragraph: the one sentence a screen opens with (24)
 *   Failed        something he tapped did not work: the red-bordered box, read out at once
 *   InviteSteps   「现在到哪一步了」 (the draft's 17-2): the invitation as a line of three, sent, she accepts, he confirms
 */
import type { ReactNode } from "react";
import { Box, PageHeader, Screen, Timeline, TimelineItem } from "@/components/ui";
import { pc } from "@/lib/care/his-copy";
import type { Locale } from "@/lib/i18n";
import "./his-family.css";

export function HisScreen({
  locale,
  back,
  title,
  subtitle,
  testId,
  state,
  attrs,
  children,
}: {
  locale: Locale;
  /** 「‹ 家人」: where the way back goes and what it is called */
  back?: { href: string; label?: string };
  title: ReactNode;
  /** the grey line under the title: who this is and how the link stands (「女儿 · 已确认」) */
  subtitle?: ReactNode;
  /** the page's test id and state, on a wrapper that draws nothing */
  testId?: string;
  state?: string;
  attrs?: Record<`data-${string}`, string | number | undefined>;
  children: ReactNode;
}) {
  return (
    <div className="contents" data-testid={testId} data-state={state} {...attrs}>
      <Screen locale={locale} className="rph-screen">
        <PageHeader locale={locale} back={back} title={title} subtitle={subtitle} />
        {children}
      </Screen>
    </div>
  );
}

export function Lead({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <p className="rpu rph-lead" data-rp="lead" data-testid={testId}>
      {children}
    </p>
  );
}

export function Failed({ children, detail, testId }: { children: ReactNode; detail?: ReactNode; testId?: string }) {
  return (
    <div className="rph-alert" role="alert" data-testid={testId}>
      <Box variant="red" title={children}>
        {detail}
      </Box>
    </div>
  );
}

/** How far an invitation has come: only these three states have steps (an ended one is said in words instead). */
export type StepState = "invited" | "accepted" | "active";

export function isStepState(state: string | null | undefined): state is StepState {
  return state === "invited" || state === "accepted" || state === "active";
}

/**
 * The invitation as a line of three entries. The node says where it stands: a tick for what is done, the accent dot for
 * what is happening now, the grey ring for what comes next. `sent` and `until` are dates as the page words them
 * (「10月12日」); the second entry's words follow the state (waiting for her, or she accepted and he is to confirm).
 */
export function InviteSteps({ locale, state, sent, until }: { locale: Locale; state: StepState; sent?: string | null; until?: string | null }) {
  return (
    <div data-testid="invite-steps" data-state={state}>
      <Timeline>
        <TimelineItem node="ok" title={pc(locale, "stepSent")} note={sent ? pc(locale, "stepSentOn", { date: sent }) : undefined} />
        {state === "invited" ? (
          <TimelineItem node="now" title={pc(locale, "stepWaiting")} note={until ? pc(locale, "stepUntil", { date: until }) : undefined} />
        ) : (
          <TimelineItem node={state === "accepted" ? "now" : "ok"} title={pc(locale, state === "accepted" ? "stepAccepted" : "stepAcceptedDone")} />
        )}
        <TimelineItem node={state === "active" ? "ok" : "next"} title={pc(locale, "stepConfirmed")} />
      </Timeline>
    </div>
  );
}
