import type { CSSProperties, ReactNode } from "react";
import { pushPageCopy, type PushPageLocale } from "@/lib/push/copy";

/**
 * The iPhone's three steps to the Home Screen, each with its picture (C2 track I, follow-up; real-app 2.6: 「iPhone：先
 * 显示三步图文：点分享 → 加到主屏幕 → 从主屏打开」). Shown before he taps anything, wherever reminders are offered on
 * an iPhone that did not open Ripple from the Home Screen: iOS gives notifications only to a web app that is there.
 *
 *   1  the Share button as Safari draws it (a box with an arrow going up)
 *   2  「添加到主屏幕」 as the share sheet draws it (a square with a plus)
 *   3  Ripple's own icon, the one to tap on the Home Screen
 *
 * Elder sizes (web/progress/f2.md): 20px sentences, a 64px picture, a hairline between steps. The pictures only repeat
 * what the sentence says, so they are hidden from a screen reader. The sentences are lib/push/copy.ts iosStep1-3, the
 * same ones the manual (/how) prints.
 */
const box: CSSProperties = {
  flex: "none",
  width: "calc(64 * var(--rp-u))",
  height: "calc(64 * var(--rp-u))",
  borderRadius: "calc(16 * var(--rp-u))",
  background: "var(--rp-tint)",
  color: "var(--rp-ink)",
  display: "grid",
  placeItems: "center",
};

function Picture({ children }: { children: ReactNode }) {
  return (
    <span style={box} aria-hidden="true" data-rp="step-picture">
      {children}
    </span>
  );
}

function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" focusable="false" style={{ width: "calc(36 * var(--rp-u))", height: "calc(36 * var(--rp-u))" }}>
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
  <img key="icon" src="/icons/apple-touch-icon.png" alt="" width={48} height={48} style={{ width: "calc(48 * var(--rp-u))", height: "calc(48 * var(--rp-u))", borderRadius: "calc(11 * var(--rp-u))", display: "block" }} />,
];

export function HomeScreenSteps({
  locale,
  lead,
  testId = "push-ios-steps",
  style,
  steps: own,
}: {
  locale: PushPageLocale;
  lead?: ReactNode;
  testId?: string;
  style?: CSSProperties;
  /** C2 track D (only add): the three sentences in another screen's words (her button is 「打开通知」, not 「开提醒」) */
  steps?: readonly [string, string, string];
}) {
  const c = pushPageCopy(locale);
  const steps = own ?? [c.iosStep1, c.iosStep2, c.iosStep3];
  return (
    <div className="rpu" data-testid={testId} data-rp="home-screen-steps" style={style}>
      {lead && (
        <p className="rpu rpu-text" data-rp-role="body" data-variant="plain" style={{ margin: 0 }}>
          {lead}
        </p>
      )}
      <ol style={{ listStyle: "none", margin: lead ? "8px 0 0" : 0, padding: 0 }}>
        {steps.map((text, i) => (
          <li
            key={text}
            data-rp="row"
            data-step={i + 1}
            style={{ display: "flex", alignItems: "center", gap: "calc(14 * var(--rp-u))", padding: "12px 0", borderBottom: i < steps.length - 1 ? "1.5px solid var(--rp-line)" : undefined }}
          >
            <span style={{ flex: "none", width: "1.2em", fontSize: "var(--rp-fs-secondary)", fontWeight: 800, textAlign: "center" }}>{i + 1}</span>
            <Picture>{PICTURES[i]}</Picture>
            <span style={{ flex: 1, minWidth: 0, fontSize: "var(--rp-fs-body)", lineHeight: 1.5 }}>{text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
