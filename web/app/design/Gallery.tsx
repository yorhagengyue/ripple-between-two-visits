import type { ReactNode } from "react";
import type { UiLocale } from "@/lib/ui/tokens";

/** /design chrome shared by the gallery pages. Not app UI. */

export const GALLERY_PAGES = [
  { href: "/design", label: "老人端组件 · Elder" },
  { href: "/design/family", label: "女儿端组件 · Daughter" },
  { href: "/design/screens", label: "整屏样例 · Screens" },
  { href: "/design/frames", label: "今天页和「我」页框架 · Frames" },
] as const;

export function Board({
  side,
  eyebrow,
  title,
  lede,
  rules,
  current,
  children,
}: {
  side: "elder" | "family";
  eyebrow: string;
  title: string;
  lede: ReactNode;
  rules?: readonly ReactNode[];
  current: (typeof GALLERY_PAGES)[number]["href"];
  children: ReactNode;
}) {
  return (
    <main className="rpd-board" lang="zh-Hans" data-rp-gallery="true" data-rp-side={side}>
      <header className="rpd-head">
        <p className="rpd-eyebrow">{eyebrow}</p>
        <h1 className="rpd-title">{title}</h1>
        <p className="rpd-lede">{lede}</p>
        {rules && (
          <ul className="rpd-rules">
            {rules.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        )}
        <nav aria-label="Gallery">
          <ul className="rpd-nav">
            {GALLERY_PAGES.map((p) => (
              <li key={p.href}>
                <a href={p.href} aria-current={p.href === current ? "page" : undefined}>
                  {p.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </header>
      {children}
    </main>
  );
}

export function Section({ id, title, note, children, lang }: { id: string; title: string; note?: ReactNode; children: ReactNode; lang?: string }) {
  return (
    <section className="rpd-section" id={id} lang={lang}>
      <h2 className="rpd-h2">{title}</h2>
      {note && <p className="rpd-note">{note}</p>}
      {children}
    </section>
  );
}

/** One component: its name, a one-line note, and its cells. */
export function Block({ id, name, note, children }: { id: string; name: string; note: ReactNode; children: ReactNode }) {
  return (
    <section className="rpd-component" id={id} data-component={name}>
      <h3 className="rpd-h3">{name}</h3>
      <p className="rpd-note">{note}</p>
      <div className="rpd-grid">{children}</div>
    </section>
  );
}

/** One specimen at phone width, on the side's page ground. */
export function Cell({
  cap,
  lang,
  filming,
  bleed,
  state,
  children,
}: {
  cap: string;
  lang?: UiLocale;
  filming?: boolean;
  bleed?: boolean;
  /** normal | empty | loading | error | ... (for tests and the screenshot names) */
  state?: string;
  children: ReactNode;
}) {
  return (
    <div className="rpd-cell" lang={lang} data-filming={filming ? "true" : undefined} data-bleed={bleed ? "true" : undefined} data-state={state ?? "normal"}>
      <span className="rpd-cap">{cap}</span>
      {children}
    </div>
  );
}

/** The mock's fake system bar (time, signal, battery). Phone hardware for the comparison, not app UI. */
export function PhoneStatusBar({ time }: { time: string }) {
  return (
    <div className="rpd-sys" aria-hidden="true" data-check-allow="phone-hardware">
      <span>{time}</span>
      <span className="rpd-sys-ic">
        <svg width="18" height="12" viewBox="0 0 18 12">
          <rect x="0" y="8" width="3" height="4" rx="1" fill="currentColor" />
          <rect x="5" y="5" width="3" height="7" rx="1" fill="currentColor" />
          <rect x="10" y="2" width="3" height="10" rx="1" fill="currentColor" />
          <rect x="15" y="0" width="3" height="12" rx="1" fill="currentColor" />
        </svg>
        <svg width="26" height="12" viewBox="0 0 26 12">
          <rect x=".5" y=".5" width="22" height="11" rx="3" fill="none" stroke="currentColor" />
          <rect x="2" y="2" width="16" height="8" rx="1.5" fill="currentColor" />
          <rect x="23.5" y="4" width="2" height="4" rx="1" fill="currentColor" />
        </svg>
      </span>
    </div>
  );
}

/** A 390x844 phone in the gallery, with its caption and the link to the full-screen version. */
export function PhoneFrame({
  side,
  time,
  caption,
  href,
  hrefLabel,
  name,
  children,
}: {
  side: "elder" | "family";
  time: string;
  caption?: { title: string; body: string };
  href?: string;
  hrefLabel?: string;
  name: string;
  children: ReactNode;
}) {
  return (
    <div className="rpd-phone-col">
      <div className="rpd-phone" data-side={side} data-composition={name}>
        <PhoneStatusBar time={time} />
        {children}
      </div>
      {caption && (
        <p className="rpd-phone-cap">
          <b>{caption.title}</b>
          {caption.body}
        </p>
      )}
      {href && (
        <a className="rpd-open" href={href}>
          {hrefLabel ?? "打开整屏"} · {name}
        </a>
      )}
    </div>
  );
}
