/**
 * Desktop frame for the judges' demo, the evaluation and how-it-works pages, and the crew's backstage and director:
 * light background, large type, no decoration (suits side-by-side screen recording).
 *
 * The look is the timeline design's palette and type (components/staff/staff.css, scoped to .rpj on the root here): the
 * page around the phone in /demo's frame is the same paper, ink and purple as the phone. The current page's link carries
 * aria-current, drawn purple over a 4px bar like the phone's current tab.
 *
 * The navigation shows what this browser may open (real-app 5.2): everyone gets Demo, Evaluation and How it works; the
 * film crew's browser (the rp_crew cookie, lib/crew/gate.ts) also gets Backstage, Director and Crew. The crew's pages
 * answer 404 to anyone else, so a judge is never shown a link that leads nowhere. Server component.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { isCrewPage } from "@/lib/crew/gate";
import "./staff.css";

const PUBLIC_LINKS: { href: string; label: string }[] = [
  { href: "/demo", label: "Demo" },
  { href: "/eval", label: "Evaluation" },
  { href: "/how", label: "How it works" },
];

const CREW_LINKS: { href: string; label: string }[] = [
  { href: "/backstage", label: "Backstage" },
  { href: "/director", label: "Director" },
  { href: "/backstage/crew", label: "Crew" },
];

export async function StaffShell({
  title,
  right,
  wide = true,
  children,
}: {
  title: string;
  right?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  const crew = await isCrewPage();
  const links = crew ? [...PUBLIC_LINKS, ...CREW_LINKS] : PUBLIC_LINKS;
  return (
    <div className="rpj min-h-dvh bg-page text-ink" lang="en">
      <header className="rpj-head border-b border-hair bg-surface">
        <div className={`mx-auto flex flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3 ${wide ? "max-w-[1440px]" : "max-w-4xl"}`}>
          <p className="rpj-brand text-lg font-bold">
            Ripple <span className="font-normal text-ink-2">· {title}</span>
          </p>
          <nav className="rpj-nav flex flex-wrap gap-x-5 gap-y-1 text-[16px] text-ink-2" aria-label="Pages" data-testid="staff-nav" data-crew={crew ? "true" : "false"}>
            {links.map((l) => (
              <Link key={l.href} href={l.href} aria-current={l.label === title ? "page" : undefined} className="inline-flex min-h-11 min-w-11 items-center justify-center hover:text-ink">
                {l.label}
              </Link>
            ))}
          </nav>
          {right ? <div className="ml-auto">{right}</div> : null}
        </div>
      </header>
      <main className={`mx-auto px-4 py-6 sm:px-6 ${wide ? "max-w-[1440px]" : "max-w-4xl"}`}>{children}</main>
    </div>
  );
}
