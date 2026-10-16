/**
 * Icons for both phones (24 grid). Drawn from docs/design/tone-v2/tone.html where it has one: strokes are 2.3
 * ("粗一点的图标"), never thinner than 2. Decorative only: every icon sits next to a word (no icon-only buttons),
 * so they are all aria-hidden.
 */
import type { ReactNode } from "react";
import type { TabKey } from "@/lib/ui/copy";
import type { SourceKind } from "@/lib/ui/tokens";

export type IconName =
  | "steth"
  | "person"
  | "counter"
  | "bottle"
  | "bag"
  | "leaflet"
  | "ripple"
  | "check"
  | "chevron"
  | "back"
  | "play"
  | "pause"
  | "sound"
  | "phone"
  | "mic"
  | "keyboard"
  | "lock"
  | "info"
  | "bell"
  | "dash"
  | "offline"
  | "calendar"
  | "pattern"
  | "box"
  | "shield"
  | "download"
  | "trash"
  | "device"
  | "camera"
  | "family"
  | "watch"
  | "chat"
  | "heart"
  | "refresh"
  | "stop"
  | "dot"
  | "list"
  | "home"
  | "capsule"
  | "pulse"
  | "redo"
  | "user"
  | "doc"
  | "sparkle"
  | "send"
  | "close";

const PATHS: Record<IconName, ReactNode> = {
  steth: (
    <>
      <path d="M6 3v6a4 4 0 0 0 8 0V3" />
      <path d="M10 13v2.5a4.5 4.5 0 0 0 9 0V13" />
      <circle cx="19" cy="11" r="1.8" />
    </>
  ),
  person: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
    </>
  ),
  counter: (
    <>
      <circle cx="12" cy="6.5" r="3.2" />
      <path d="M6.5 15c1-2.6 3-4 5.5-4s4.5 1.4 5.5 4" />
      <path d="M3 15h18v5H3z" />
    </>
  ),
  bottle: (
    <>
      <path d="M8 3h8v3H8z" />
      <path d="M7 6h10v14a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1z" />
      <path d="M12 10.5v6M9 13.5h6" />
    </>
  ),
  bag: (
    <>
      <path d="M5 8h14l-1 12H6z" />
      <path d="M9 8V6a3 3 0 0 1 6 0v2" />
    </>
  ),
  leaflet: (
    <>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
      <path d="M9 12h6M9 16h6" />
    </>
  ),
  ripple: (
    <>
      <circle cx="12" cy="12" r="2" />
      <path d="M7.5 7.5a6.4 6.4 0 0 0 0 9M16.5 7.5a6.4 6.4 0 0 1 0 9" />
      <path d="M4.5 4.5a10.6 10.6 0 0 0 0 15M19.5 4.5a10.6 10.6 0 0 1 0 15" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  chevron: <path d="m9 6 6 6-6 6" />,
  back: <path d="m15 5-7 7 7 7" />,
  play: <path d="M7 4.5v15l12.5-7.5z" fill="currentColor" />,
  pause: (
    <>
      <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" />
    </>
  ),
  sound: (
    <>
      <path d="M4 10v4h4l5 4V6L8 10z" />
      <path d="M16.5 9a4 4 0 0 1 0 6" />
      <path d="M19 6.5a7.5 7.5 0 0 1 0 11" />
    </>
  ),
  phone: <path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2" />,
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </>
  ),
  keyboard: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <path d="M6 10h1M10 10h1M14 10h1M18 10h0M7 14h10" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7.5v.5" />
    </>
  ),
  bell: (
    <>
      <path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z" />
      <path d="M10 21h4" />
    </>
  ),
  dash: <path d="M6 12h12" />,
  offline: (
    <>
      <path d="M3 3l18 18" />
      <path d="M8.5 16a5 5 0 0 1 7 0M5 12.5a10 10 0 0 1 4.2-2.4M19 12.5a10 10 0 0 0-3.4-2.2M2 9a15 15 0 0 1 4.5-2.8M22 9a15 15 0 0 0-9.5-3.9" />
      <path d="M12 20h.01" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="3" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  pattern: (
    <>
      <path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.5" />
      <path d="M20 4v4.5h-4.5" />
      <path d="M20 12a8 8 0 0 1-13.7 5.6L4 15.5" />
      <path d="M4 20v-4.5h4.5" />
    </>
  ),
  box: (
    <>
      <path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z" />
      <path d="M3.5 7.5 12 12l8.5-4.5M12 12v9" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 5 6v5c0 4.5 3 8.5 7 10 4-1.5 7-5.5 7-10V6z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v11M7 10l5 5 5-5" />
      <path d="M5 20h14" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16M10 4h4M6 7l1 13h10l1-13" />
      <path d="M10 11v6M14 11v6" />
    </>
  ),
  device: (
    <>
      <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
      <path d="M11 18.5h2" />
    </>
  ),
  camera: (
    <>
      <rect x="2.5" y="7" width="13" height="10" rx="2" />
      <path d="m15.5 11 6-3.5v9l-6-3.5" />
    </>
  ),
  family: (
    <>
      <circle cx="8.5" cy="8" r="3.2" />
      <circle cx="16.5" cy="9.5" r="2.6" />
      <path d="M2.5 20c.9-3.6 3.3-5.5 6-5.5s5.1 1.9 6 5.5M14.5 14.6c.6-.2 1.3-.3 2-.3 2.4 0 4.2 1.7 5 4.7" />
    </>
  ),
  watch: (
    <>
      <rect x="6" y="6" width="12" height="12" rx="3" />
      <path d="M9 6V3h6v3M9 18v3h6v-3M12 9.5V12l1.8 1.2" />
    </>
  ),
  chat: <path d="M4 5h16v11H9l-5 4z" />,
  heart: <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />,
  refresh: (
    <>
      <path d="M20 12a8 8 0 1 1-2.4-5.7L20 8.5" />
      <path d="M20 4v4.5h-4.5" />
    </>
  ),
  stop: <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />,
  dot: <circle cx="12" cy="12" r="6" fill="currentColor" stroke="none" />,
  list: (
    <>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <circle cx="4.5" cy="6" r="1" />
      <circle cx="4.5" cy="12" r="1" />
      <circle cx="4.5" cy="18" r="1" />
    </>
  ),
  home: (
    <>
      <path d="M4 10.5 12 4l8 6.5V20H4z" />
      <path d="M10 20v-5h4v5" />
    </>
  ),
  capsule: (
    <g transform="rotate(-45 12 12)">
      <rect x="3" y="8" width="18" height="8" rx="4" />
      <path d="M12 8v8" />
    </g>
  ),
  pulse: <path d="M3 12h4l3-7 4 14 3-7h4" />,
  redo: (
    <>
      <path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5" />
      <path d="M4 4v4.5h4.5" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8.5" r="3.6" />
      <path d="M5 20c1.2-3.6 3.9-5.4 7-5.4s5.8 1.8 7 5.4" />
      <circle cx="12" cy="12" r="10" />
    </>
  ),
  doc: (
    <>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M8.5 8h7M8.5 12h7M8.5 16h4" />
    </>
  ),
  sparkle: <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18" />,
  send: <path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
};

/** One icon. `size` in px at the default text size; scales with the text through the em-based CSS when `scale`. */
export function Icon({
  name,
  size = 24,
  stroke = 2.3,
  className,
}: {
  name: IconName;
  size?: number;
  stroke?: number;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      data-icon={name}
    >
      {PATHS[name]}
    </svg>
  );
}

/** The icon that says where words come from (tone v2: stethoscope for the doctor, person for family, bag for the label ...). */
export const SOURCE_ICON: Record<SourceKind, IconName> = {
  doctor: "steth",
  dispenser: "counter",
  pharmacist: "bottle",
  label: "bag",
  leaflet: "leaflet",
  family: "person",
  self: "user",
  ripple: "ripple",
};

/** Tab bar icons (tone v2: 28px, 2.3 stroke, every one over its word; owner 10-14: the four places of his bar). */
export const TAB_ICON: Record<TabKey, IconName> = {
  today: "home",
  visit: "steth",
  records: "doc",
  me: "user",
};
