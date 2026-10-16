import type { ReactNode } from "react";
import { Timeline, TimelineItem } from "@/components/ui";
import { pushPageCopy, type PushPageLocale } from "@/lib/push/copy";
import "@/components/me/me.css";

/**
 * The iPhone's three steps to the Home Screen on 「我 › 提醒和通知」 (real-app 2.6 「iPhone：先显示三步图文：点分享 → 加到主屏
 * 幕 → 从主屏打开」), drawn as the timeline draft's 通用-5d: three "next" nodes on one line, each with its sentence and
 * its picture:
 *
 *   1  the Share button as Safari draws it (a box with an arrow going up)
 *   2  「添加到主屏幕」 as the share sheet draws it (a square with a plus)
 *   3  Ripple's own icon, the one to tap on the Home Screen
 *
 * The sentences are lib/push/copy.ts iosStep1-3, the same ones track I's components/push/HomeScreenSteps and the manual
 * (/how) print; the pictures only repeat what the sentence says, so they are hidden from a screen reader. The test
 * hooks are that component's: data-testid="push-ios-steps", a [data-rp="row"] per step, a [data-rp="step-picture"] in
 * each.
 */
function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" focusable="false">
      {children}
    </svg>
  );
}

const PICTURES: ReactNode[] = [
  // Safari's Share button
  <Glyph key="share">
    <path d="M12 15V3" />
    <path d="M8 7l4-4 4 4" />
    <path d="M8 10H6.5A1.5 1.5 0 0 0 5 11.5v8A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-8a1.5 1.5 0 0 0-1.5-1.5H16" />
  </Glyph>,
  // 「添加到主屏幕」 in the share sheet
  <Glyph key="add">
    <rect x="4" y="4" width="16" height="16" rx="4" />
    <path d="M12 8.5v7" />
    <path d="M8.5 12h7" />
  </Glyph>,
  // Ripple's icon on the Home Screen
  // eslint-disable-next-line @next/next/no-img-element -- a 180px static icon from /public; next/image adds nothing here
  <img key="icon" src="/icons/apple-touch-icon.png" alt="" width={48} height={48} />,
];

export function HomeScreenLine({ locale, testId = "push-ios-steps" }: { locale: PushPageLocale; testId?: string }) {
  const c = pushPageCopy(locale);
  const steps = [c.iosStep1, c.iosStep2, c.iosStep3];
  return (
    <Timeline testId={testId}>
      {steps.map((text, i) => (
        <TimelineItem key={text} node="next">
          <div className="rpm-step" data-rp="row" data-step={i + 1}>
            <span className="rpm-step-picture" aria-hidden="true" data-rp="step-picture">
              {PICTURES[i]}
            </span>
            <p className="rpm-step-text">{text}</p>
          </div>
        </TimelineItem>
      ))}
    </Timeline>
  );
}
