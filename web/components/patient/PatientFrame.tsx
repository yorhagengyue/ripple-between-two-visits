"use client";

/**
 * Live phone frame for Mr Tan (variant "patient") and Wei Ling (variant "family"): the day label and
 * filming mode follow the session as the director changes them. Patient pages also get the tab bar
 * and the reminder card. Filming mode hides the jump menu and the debug line and enlarges text.
 *
 * M6: patient pages also get Wei Ling's recorded reminder (`reminder`, the ReminderClipPlayer that
 * app/p/layout.tsx mounts so it plays on whichever page he is on), and Today ends with the way to the
 * visit brief and to 「家人能看到什么」 (/p/family). Not a sixth tab: the bar stays five columns at 360px.
 *
 * M6 privacy on /f (variant "family"): `role` is the role of the device's member row, worked out on the server
 * (app/f/page.tsx, lib/family/role.ts pageIdentity), never the rp_role cookie, which the page can rewrite. Her phone
 * gets no jump menu (its links are his pages, its beats name his reading and his note, its buttons are his side's),
 * and the menu's code is loaded only where it is shown (next/dynamic), so the story beats are not in /f's scripts for
 * her. The debug line on /f leaves out the join code (with it a device can join).
 *
 * C2 (real-app 5.2): the jump menu and the debug line are the film crew's: they appear only on a browser that carries
 * the crew's cookie (components/session/useCrewBrowser, asked once per page load), and never in filming mode. His pages
 * also follow the director: a scene jump or a replay start opens the page it names (components/session/SceneFollower,
 * loaded only on his pages).
 */
import dynamic from "next/dynamic";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { LangToggle } from "@/components/LangToggle";
import { useLiveSession } from "@/components/live/LiveSession";
import { PhoneShell } from "@/components/PhoneShell";
import { useCrewBrowser } from "@/components/session/useCrewBrowser";
import { OneAudio } from "@/components/visit/elder/OneAudio";
import { ft } from "@/lib/family/i18n";
import { t, type Locale, type MessageKey } from "@/lib/i18n";
import { ReminderCard } from "./ReminderCard";
import { TabBar } from "./TabBar";

/** The developer jump menu, in its own chunk: a page that does not render it (her /f) does not download it. */
const JumpMenu = dynamic(() => import("./JumpMenu").then((m) => m.JumpMenu));
/** His phone follows the director's scene and replay cues; its own chunk too, never loaded on her /f. */
const SceneFollower = dynamic(() => import("@/components/session/SceneFollower").then((m) => m.SceneFollower));

const LIVE_KEY = { connecting: "live.connecting", open: "live.open", closed: "live.closed" } as const;
const KNOWN_ROLES = ["patient", "family", "backstage", "director", "judge"];

export function PatientFrame({
  locale,
  variant,
  role,
  reminder,
  children,
}: {
  locale: Locale;
  variant: "patient" | "family";
  role: string | null;
  /** Wei Ling's recorded reminder player (patient pages) */
  reminder?: ReactNode;
  children: ReactNode;
}) {
  const { session, d0, live } = useLiveSession();
  const pathname = usePathname();
  const crew = useCrewBrowser();
  const filming = session.filming_mode;
  const roleKey = role && KNOWN_ROLES.includes(role) ? (`role.${role}` as MessageKey) : null;

  return (
    <PhoneShell
      locale={locale}
      d0={d0}
      day={session.story_day}
      time={session.story_time}
      filming={filming}
      // whose phone it is: her demo phone takes the daughter's dark tokens (components/patient/demo-phone.css)
      side={variant}
      headerRight={<LangToggle locale={locale} />}
      footer={variant === "patient" ? <TabBar locale={locale} /> : undefined}
    >
      {/* C2 follow-up (real-app 12 「朗读和医生原话叠着放」): one sound at a time on the demo's phones too: starting a clip, a
          read-aloud or her reminder stops the one that was playing (the account pages' own helper) */}
      <OneAudio />
      {variant === "patient" ? <ReminderCard locale={locale} /> : null}
      {variant === "patient" ? reminder : null}
      {variant === "patient" ? <SceneFollower /> : null}
      {children}
      {variant === "patient" && pathname === "/p/today" ? <TodayLinks locale={locale} /> : null}
      {filming || !crew ? null : (
        <>
          {/* not on Wei Ling's phone (her member row's role, from the server): its links are his pages, its beats
              name his reading and his note, and its buttons (clock, reset) are his side's (lib/family/gate.ts refuses
              them for her). A judge's sandbox opening /f keeps it. */}
          {variant === "family" && role === "family" ? null : <JumpMenu locale={locale} />}
          <p className="mt-4 text-[13px] text-ink-3" data-testid="debug-info">
            {/* /f never shows the join code */}
            {[
              variant === "family" || !session.join_code ? null : t(locale, "debug.session", { code: session.join_code }),
              roleKey ? t(locale, "debug.role", { role: t(locale, roleKey) }) : null,
              t(locale, LIVE_KEY[live]),
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </>
      )}
    </PhoneShell>
  );
}

/** The way from Today to the visit brief and to what his family can see (18px rows in plain v3 cards; the teal list border is kept for Ripple's question list). */
function TodayLinks({ locale }: { locale: Locale }) {
  return (
    <nav className="mt-4 flex flex-col gap-3" data-testid="today-links">
      <Link href="/p/brief" className="rp-card block px-4 py-3" data-testid="link-brief">
        <span className="rp-qt block">{t(locale, "nav.brief")} →</span>
      </Link>
      <Link href="/p/family" className="rp-card block px-4 py-3" data-testid="link-family-grants">
        <span className="rp-qt block">{ft(locale, "g.link")} →</span>
      </Link>
    </nav>
  );
}
