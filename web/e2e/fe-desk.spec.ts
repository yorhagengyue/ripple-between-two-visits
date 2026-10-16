/**
 * The phone app on a computer (line fe-desk; owner 2026-10-11: the judges open the site on a laptop, the phone stays as
 * it is). app/desktop.css makes every phone page one column in a window 720px wide or wider; this file measures it, and
 * is how the pages of every other line are checked again after they merge.
 *
 * The pages are plain data, two lists: add a line per page.
 *   PHONE_PAGES   the app's main pages: measured at 1440x900, at 1280x720 and on a phone
 *   MORE_PAGES    every other screen (the same roots and bars, so one window is enough): measured at 1440x900 only
 * On each page, in a wide window:
 *   column   the page has its column, 430px wide, its middle within 1px of the window's, from the top of the window to
 *            its bottom, with its one-pixel line; the document does not scroll sideways
 *   inside   every visible element that is position: fixed lies between the column's left and right edges, and so does
 *            everything else of the page (each offender is named by its class or test id)
 *   stage    the colour behind the column is the stage's (light #E1E7EE; dark #05070A behind a dark column) and shows
 *            on both sides: nothing of the page is painted over it
 *   note     from 1100px the note is beside the column, in the page's language, readable on the stage, with a QR code
 *            of the site's origin plus "/"; it repeats no test id, role and name, or visible text of the page
 * then: Today's tab links and scrolling, the reminder strip above a page, a classic scrollbar, a larger text size, the
 * marks other lines use (data-rp-phone bare, "light" and "dark", each on the page's own root and on a root with a width
 * of its own; data-rp-phone-fixed at the bottom and at the top of the phone), the note at 1440 / 1000 / in /demo's
 * frame, the same pages at 390x844 (nothing changed for a phone) and at 719px, and the pages made for a computer (/demo,
 * /how, /eval, the sandbox phone, /design): not one rule of app/desktop.css matches anything on them, and their main
 * containers are as wide as before this layout existed.
 *
 * What this file never pins: the colours and inner boxes of pages this layout leaves alone (another line restyles
 * /demo, /how, /eval and the sandbox phone). "Left alone" is asserted as what it is: no rule of app/desktop.css applies.
 *
 * A page of another line that is not rebuilt yet, or whose root or bar lacks the hook, carries `waiting` for the check it
 * cannot pass: that check is still measured and its result printed ("[fe-desk] WAITING …"), but it does not fail the
 * run. FE_DESK_STRICT=1 asserts those too: run it so once every line has merged, then delete the `waiting` lines.
 *
 *   PW_PORT=3885 npx playwright test e2e/fe-desk.spec.ts                       (a server with the developer tools on)
 *   FE_SHOTS_DIR=D:/ripple-c2/shots/fe … e2e/fe-desk.spec.ts                   also writes <dir>/desk/<name>.png, 1440x900
 *   FE_DESK_STRICT=1 … e2e/fe-desk.spec.ts                                     nothing may be waiting any more
 *
 * Never opens /demo in a browser context that then opens account pages: a browser looking at the demo is answered by
 * the demo before its account.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { chromium, expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import {
  DESK_COLUMN,
  DESK_COLUMN_DARK,
  DESK_COLUMN_UNITS,
  DESK_FAMILY_COLUMN,
  DESK_FIXED_BARS,
  DESK_MIN_WIDTH,
  DESK_NOTE_MIN_WIDTH,
} from "../components/desktop/column";
import { DESK_COPY, deskLocale } from "../components/desktop/copy";
import { encodeQr, qrSvgPath } from "../lib/crew/qr";
import { contrastRatio } from "../lib/ui/contrast";
import { contrastViolations, textBelowMinimum } from "./_checks/page-checks";
import { clearClock, linkFamily, setClock, setSwitches, tick } from "./journeys/_d/family";

/* ====================================================================== the pages (plain data) */

/** Who is looking: nobody signed in, the example account (Mr Tan's six weeks), a blank account still setting up, his daughter. */
type Who = "nobody" | "example" | "blank" | "her";
type Check = "column" | "inside" | "stage" | "note";

interface PhonePage {
  /** the picture's name and the test's title */
  name: string;
  /**
   * The address. Two words in braces are filled in from the run: {link} is the family link between the example account
   * and her (his pages about her, her pages about him); {invite} is the token of an invitation nobody has answered yet.
   */
  path: string;
  who: Who;
  /** a control to tap once the page is up (a state of the page: the typing dock), by test id */
  tap?: string;
  /** the state exists only where the page has that control: without it the test is skipped, not failed */
  tapIfThere?: boolean;
  /** checks this page cannot pass yet, and what is missing, with the exact element: measured and printed, not failed */
  waiting?: Partial<Record<Check, string>>;
}

/** The app's main pages: measured at both wide sizes and on a phone. */
const PHONE_PAGES: PhonePage[] = [
  // signed out
  { name: "front", path: "/", who: "nobody" },
  { name: "login", path: "/login", who: "nobody" },
  { name: "signup", path: "/signup", who: "nobody" },
  { name: "recover", path: "/recover", who: "nobody" },
  { name: "privacy", path: "/privacy", who: "nobody" },
  // his own pages, on the example account
  { name: "today", path: "/p/today", who: "example" },
  { name: "today-typing", path: "/p/today", who: "example", tap: "say-type" },
  { name: "ask", path: "/p/ask", who: "example" },
  { name: "ask-typing", path: "/p/ask", who: "example", tap: "say-type", tapIfThere: true },
  { name: "bp", path: "/p/bp", who: "example" },
  { name: "visit", path: "/p/visit", who: "example" },
  { name: "meds", path: "/p/meds", who: "example" },
  { name: "meds-add", path: "/p/meds/add", who: "example" },
  { name: "questions", path: "/p/questions", who: "example" },
  { name: "brief", path: "/p/brief", who: "example" },
  { name: "brief-doctor", path: "/p/brief?show=doctor", who: "example" },
  { name: "family", path: "/p/family", who: "example" },
  { name: "family-link", path: "/p/family/{link}", who: "example" },
  { name: "me", path: "/p/me", who: "example" },
  { name: "chat", path: "/p/chat", who: "example" },
  { name: "prevent", path: "/p/prevent", who: "example" },
  { name: "diet", path: "/p/diet", who: "example" },
  { name: "watch", path: "/p/watch", who: "example" },
  // setting up, on a blank account
  { name: "onboard", path: "/onboard", who: "blank" },
  // his daughter's side: her screens keep their own column (.rpf-screen, app/ripple-ui.css); measured, never restyled
  { name: "f", path: "/f", who: "her" },
  { name: "f-alert", path: "/f/alert?link={link}", who: "her" },
  { name: "f-reminder", path: "/f/reminder?link={link}", who: "her" },
  { name: "f-me", path: "/f/me?link={link}", who: "her" },
  // her way in: the invitation he sent, opened by someone not signed in
  { name: "invite", path: "/invite/{invite}", who: "nobody" },
];

/** Every other screen: the same roots and bars as the main pages, so they are measured in one window, 1440x900. */
const MORE_PAGES: PhonePage[] = [
  // the way in (line entry): the choice of side, and the family side's log-in and sign-up
  { name: "who", path: "/who?do=signup", who: "nobody" },
  { name: "login-family", path: "/login?as=family", who: "nobody" },
  { name: "signup-family", path: "/signup?as=family", who: "nobody" },
  // his family pages
  { name: "family-link-seen", path: "/p/family/{link}/seen", who: "example" },
  { name: "family-link-stop", path: "/p/family/{link}/stop", who: "example" },
  { name: "family-invite", path: "/p/family/invite", who: "example" },
  // the question list
  { name: "questions-add", path: "/p/questions/add", who: "example" },
  { name: "questions-answered", path: "/p/questions/answered", who: "example" },
  { name: "questions-skipped", path: "/p/questions/skipped", who: "example" },
  { name: "questions-for-doctor", path: "/p/questions?for=doctor", who: "example" },
  // 「我」 and what is under it
  { name: "me-export", path: "/p/me/export", who: "example" },
  { name: "me-export-access", path: "/p/me/export/access", who: "example" },
  { name: "me-export-recordings", path: "/p/me/export/recordings", who: "example" },
  { name: "me-ai", path: "/p/me/ai", who: "example" },
  { name: "me-delete", path: "/p/me/delete", who: "example" },
  { name: "me-example", path: "/p/me/example", who: "example" },
  { name: "me-notifications", path: "/p/me/notifications", who: "example" },
  { name: "me-devices", path: "/p/me/devices", who: "example" },
  { name: "me-password", path: "/p/me/password", who: "example" },
  { name: "me-recovery", path: "/p/me/recovery", who: "example" },
  { name: "me-reset-help", path: "/p/me/reset-help", who: "example" },
  // (/p/me/filming answers 404 unless the phone carries the film crew's cookie: not opened here)
  { name: "profile", path: "/p/profile", who: "example" },
  { name: "profile-name", path: "/p/profile/name", who: "example" },
  { name: "profile-language", path: "/p/profile/language", who: "example" },
  { name: "profile-times", path: "/p/profile/times", who: "example" },
  { name: "profile-times-midday", path: "/p/profile/times/midday", who: "example" },
  // setting up, screen by screen (its buttons stay at the foot of the column: a sticky dock)
  { name: "onboard-clinic", path: "/onboard/clinic", who: "blank" },
  { name: "onboard-habits", path: "/onboard/habits", who: "blank" },
  { name: "onboard-meds", path: "/onboard/meds", who: "blank" },
  { name: "onboard-conditions", path: "/onboard/conditions", who: "blank" },
  { name: "onboard-family", path: "/onboard/family", who: "blank" },
  { name: "onboard-reminders", path: "/onboard/reminders", who: "blank" },
  { name: "onboard-done", path: "/onboard/done", who: "blank" },
  // the rest of her side; on /f the bottom sheet for Dad's number is the only thing of hers that is fixed
  { name: "f-sheet", path: "/f?link={link}", who: "her", tap: "call-dad", tapIfThere: true },
  { name: "f-week", path: "/f/week?link={link}", who: "her" },
  { name: "f-shared", path: "/f/shared?link={link}", who: "her" },
  { name: "f-shared-visits", path: "/f/shared/visits?link={link}", who: "her" },
  { name: "f-shared-notes", path: "/f/shared/notes?link={link}", who: "her" },
  { name: "f-facts", path: "/f/facts?link={link}", who: "her" },
  { name: "f-reminder-mine", path: "/f/reminder/mine?link={link}", who: "her" },
  { name: "f-phone", path: "/f/phone?link={link}", who: "her" },
  { name: "f-me-notifications", path: "/f/me/notifications?link={link}", who: "her" },
  { name: "f-me-devices", path: "/f/me/devices?link={link}", who: "her" },
  { name: "f-me-password", path: "/f/me/password?link={link}", who: "her" },
  { name: "f-me-recovery", path: "/f/me/recovery?link={link}", who: "her" },
  { name: "f-me-install", path: "/f/me/install?link={link}", who: "her" },
  { name: "f-me-leave", path: "/f/me/leave?link={link}", who: "her" },
  { name: "f-me-delete", path: "/f/me/delete?link={link}", who: "her" },
  // her sign-up and her login on the way into an invitation
  { name: "invite-join", path: "/invite/{invite}/join", who: "nobody" },
  { name: "invite-login", path: "/invite/{invite}/login", who: "nobody" },
];

/**
 * The pages made for a computer, with [left, width] of their main containers at 1440x900 as measured on c2-real 7bd3540,
 * before app/desktop.css existed. This layout must not move them. (Only the containers: what is inside them, and every
 * colour, belongs to the line that restyles these pages.)
 */
const COMPUTER_PAGES: { name: string; path: string; ready?: string; boxes: Record<string, [number, number]> }[] = [
  {
    name: "demo",
    path: "/demo",
    ready: '[data-testid="hero-button"][data-ready="true"]',
    boxes: { main: [0, 1440], "header > div": [0, 1440], '[data-testid="page-landing"]': [24, 1392] },
  },
  { name: "how", path: "/how", boxes: { main: [272, 896], "header > div": [272, 896] } },
  { name: "eval", path: "/eval", boxes: { main: [272, 896], "header > div": [272, 896] } },
];

const WIDE = [
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
] as const;
const PHONE = { width: 390, height: 844 } as const;

/** --rp-tint, the light stage; --rpf-page, the dark one. */
const LIGHT = "rgb(225, 231, 238)";
const DARK = "rgb(5, 7, 10)";
/** --rp-line and --rpf-hair-2: the column's one-pixel line on each stage. */
const LINE = "rgb(213, 220, 229)";
const LINE_DARK = "rgb(39, 41, 44)";

const DIR = process.env.FE_SHOTS_DIR?.trim() || null;
const STRICT = process.env.FE_DESK_STRICT === "1";
const PASSWORD = "a long test password";
const SGT = (date: string, hhmm: string) => `${date}T${hhmm}:00+08:00`;

/* ====================================================================== measuring */

interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
}

interface Measured {
  path: string;
  /** the window without its scrollbar, and with it */
  client: number;
  inner: number;
  winHeight: number;
  docHeight: number;
  scrollY: number;
  sideways: number;
  /** <body>'s colour: the stage */
  body: string;
  /** the first visible column: app/desktop.css's ("desk") or one of her screens ("hers") */
  column: (Box & { what: string; kind: "desk" | "hers"; dark: boolean; shadow: string; marginLeft: string; lang: string | null }) | null;
  /** every visible element that crosses the column's left or right edge (the outermost of each group) */
  outside: { what: string; position: string; left: number; right: number }[];
  /** what is painted in the stage's place beside the column */
  overStage: string[];
  /** the foundation's bars that are fixed right now */
  bars: { what: string; left: number; right: number; bottom: number }[];
  /** an ancestor of the column that scrolls by itself (there must be none: the document scrolls) */
  scrollers: string[];
  note: null | {
    box: Box;
    position: string;
    stage: string | null;
    lang: string | null;
    label: string | null;
    code: string | null;
    url: string | null;
    d: string | null;
    lead: string;
    text: string;
    colours: string[];
    sizes: number[];
  };
  /** what the note has in common with the page: test ids, role and name, visible text */
  duplicates: { testIds: string[]; names: string[]; texts: string[] };
}

/** Runs in the page. */
function measureInPage(sel: { desk: string; hers: string; dark: string; bars: string }): Measured {
  const round = (n: number) => Math.round(n * 100) / 100;
  const box = (el: Element): Box => {
    const r = el.getBoundingClientRect();
    return { left: round(r.left), right: round(r.right), top: round(r.top), bottom: round(r.bottom), width: round(r.width) };
  };
  const what = (el: Element) => {
    const id = el.getAttribute("data-testid");
    const cls = (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean).slice(0, 3).join(".");
    return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ""}${id ? `[data-testid="${id}"]` : ""}`;
  };
  const shown = (el: Element) => {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };
  const painted = (el: Element) => {
    const cs = getComputedStyle(el);
    const alpha = /rgba?\([^)]*[,/]\s*0(?:\.0+)?\s*\)$/.test(cs.backgroundColor) || cs.backgroundColor === "transparent" ? 0 : 1;
    return alpha > 0 || cs.backgroundImage !== "none";
  };
  const note = document.querySelector('[data-testid="desk-note"]');
  const inNote = (el: Element) => !!note && (el === note || note.contains(el));
  const skipped = (el: Element) => !!el.closest("nextjs-portal, script, style, template, noscript") || inNote(el);

  const desk = [...document.querySelectorAll(sel.desk)].filter(shown);
  const hers = [...document.querySelectorAll(sel.hers)].filter(shown);
  const col = desk[0] ?? hers[0] ?? null;
  const c = col ? box(col) : null;
  const client = document.documentElement.clientWidth;

  const outside: Measured["outside"] = [];
  const overStage: string[] = [];
  const scrollers: string[] = [];
  if (col && c) {
    // is this element cut off by something inside the column that clips or scrolls sideways?
    const clipped = (el: Element) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === "hidden" || ox === "auto" || ox === "scroll" || ox === "clip") return true;
      }
      return false;
    };
    const reported: Element[] = [];
    for (const el of document.body.querySelectorAll("*")) {
      if (skipped(el) || el.contains(col) || !shown(el)) continue;
      const b = box(el);
      if (b.left >= c.left - 0.5 && b.right <= c.right + 0.5) continue;
      const position = getComputedStyle(el).position;
      if (position !== "fixed" && clipped(el)) continue;
      if (reported.some((r) => r.contains(el))) continue;
      reported.push(el);
      outside.push({ what: what(el), position, left: b.left, right: b.right });
    }
    // the stage beside the column: at each sample point, the first thing that is painted must be <body> or <html>
    const xs: number[] = [];
    if (c.left > 8) xs.push(c.left * 0.25, c.left * 0.5, c.left * 0.75, c.left - 3);
    if (client - c.right > 8) xs.push(c.right + 3, c.right + (client - c.right) * 0.25, c.right + (client - c.right) * 0.5, c.right + (client - c.right) * 0.75);
    const found = new Set<string>();
    for (const x of xs) {
      for (const f of [0.06, 0.3, 0.5, 0.7, 0.94]) {
        for (const el of document.elementsFromPoint(Math.round(x), Math.round(window.innerHeight * f))) {
          if (el === document.body || el === document.documentElement) break;
          // the note stands on the stage by design; a transparent wrapper around the column lets the stage through
          if (inNote(el)) break;
          if (el.closest("nextjs-portal")) continue;
          if (el.contains(col) && !painted(el)) continue;
          found.add(what(el));
          break;
        }
      }
    }
    overStage.push(...found);
    for (let p = col.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      const oy = getComputedStyle(p).overflowY;
      if (p !== document.body && (oy === "auto" || oy === "scroll")) scrollers.push(what(p));
    }
  }

  const bars = [...document.querySelectorAll(sel.bars)]
    .filter((el) => shown(el) && getComputedStyle(el).position === "fixed")
    .map((el) => ({ what: what(el), left: box(el).left, right: box(el).right, bottom: box(el).bottom }));

  // what the note shares with the page
  const duplicates: Measured["duplicates"] = { testIds: [], names: [], texts: [] };
  let noteOut: Measured["note"] = null;
  if (note) {
    const qr = note.querySelector('[data-testid="desk-note-qr"]');
    const lead = note.querySelector(".rpdesk-note-lead");
    const text = note.querySelector(".rpdesk-note-text");
    noteOut = {
      box: box(note),
      position: getComputedStyle(note).position,
      stage: note.getAttribute("data-stage"),
      lang: note.getAttribute("lang"),
      label: note.getAttribute("aria-label"),
      code: qr?.getAttribute("aria-label") ?? null,
      url: qr?.getAttribute("data-url") ?? null,
      d: qr?.querySelector("path")?.getAttribute("d") ?? null,
      lead: (lead?.textContent ?? "").trim(),
      text: (text?.textContent ?? "").trim(),
      colours: [lead, text].filter((el): el is Element => !!el).map((el) => getComputedStyle(el).color),
      sizes: [lead, text].filter((el): el is Element => !!el).map((el) => parseFloat(getComputedStyle(el).fontSize)),
    };
    const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
    const mine = [...note.querySelectorAll("[data-testid]"), note];
    for (const el of mine) {
      const id = el.getAttribute("data-testid");
      if (id && document.querySelectorAll(`[data-testid="${id}"]`).length !== 1) duplicates.testIds.push(id);
    }
    // role and name: the note is a complementary landmark with a name, its code an image with a name
    const names = [norm(note.getAttribute("aria-label")), norm(qr?.getAttribute("aria-label"))].filter(Boolean);
    const noteWords = [noteOut.lead, noteOut.text, ...names].join("\n").toLowerCase();
    const candidates = new Map<string, string>();
    const add = (s: string | null | undefined, from: Element) => {
      const t = norm(s);
      // a letter, a digit or a Chinese character: punctuation alone is nobody's needle
      if (!t || !/[A-Za-z0-9\u3400-\u9FFF]/.test(t)) return;
      // a word of two or three Latin letters is inside half the sentences of any language: nobody can look for it alone
      if (t.length < 2 || (/^[\x20-\x7e]+$/.test(t) && t.length < 4)) return;
      if (!candidates.has(t)) candidates.set(t, what(from));
    };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const el = node.parentElement;
      if (!el || skipped(el)) continue;
      add(node.textContent, el);
    }
    for (const el of document.body.querySelectorAll("[aria-label], [alt], [title], [placeholder], input[type=button], input[type=submit]")) {
      if (skipped(el)) continue;
      for (const attr of ["aria-label", "alt", "title", "placeholder", "value"]) add(el.getAttribute(attr), el);
      const role = el.getAttribute("role") ?? (el.tagName === "ASIDE" ? "complementary" : el.tagName === "IMG" ? "img" : null);
      const label = norm(el.getAttribute("aria-label") ?? el.getAttribute("alt"));
      if (label && names.includes(label) && (role === "img" || role === "complementary")) duplicates.names.push(`${role} "${label}" on ${what(el)}`);
    }
    for (const el of document.body.querySelectorAll("aside, [role=complementary]")) if (!skipped(el)) duplicates.names.push(`a second complementary landmark: ${what(el)}`);
    for (const [t, from] of candidates) if (noteWords.includes(t.toLowerCase())) duplicates.texts.push(`"${t}" (${from})`);
  }

  return {
    path: location.pathname + location.search,
    client,
    inner: window.innerWidth,
    winHeight: window.innerHeight,
    docHeight: document.documentElement.scrollHeight,
    scrollY: round(window.scrollY),
    sideways: document.documentElement.scrollWidth - client,
    body: getComputedStyle(document.body).backgroundColor,
    column:
      col && c
        ? {
            ...c,
            what: what(col),
            kind: desk[0] ? "desk" : "hers",
            dark: !desk[0] || col.matches(sel.dark),
            shadow: getComputedStyle(col).boxShadow,
            marginLeft: getComputedStyle(col).marginLeft,
            lang: col.closest("[lang]")?.getAttribute("lang") ?? null,
          }
        : null,
    outside,
    overStage,
    bars,
    scrollers,
    note: noteOut,
    duplicates,
  };
}

const measure = (page: Page) => page.evaluate(measureInPage, { desk: DESK_COLUMN, hers: DESK_FAMILY_COLUMN, dark: DESK_COLUMN_DARK, bars: DESK_FIXED_BARS });

/**
 * The rules of app/desktop.css as the browser holds them (found by what only they contain: an .rpdesk-* class, or the
 * column's `:not(.rp-patient *)`): which media block each sits in, whether that block applies in this window, and
 * whether the rule matches anything in this document.
 */
function deskRulesInPage(): { loose: string[]; media: { condition: string; applies: boolean; rules: number }[]; matching: string[] } {
  const loose: string[] = [];
  const media = new Map<string, number>();
  const matching: string[] = [];
  const walk = (list: CSSRuleList, condition: string | null) => {
    for (const rule of Array.from(list)) {
      if (rule instanceof CSSMediaRule) walk(rule.cssRules, rule.conditionText);
      else if (rule instanceof CSSStyleRule) {
        if (!/rpdesk-|:not\(\.rp-patient \*\)/.test(rule.selectorText)) continue;
        if (condition === null) loose.push(`${rule.selectorText} { ${rule.style.cssText} }`);
        else media.set(condition, (media.get(condition) ?? 0) + 1);
        if ((condition === null || window.matchMedia(condition).matches) && document.querySelector(rule.selectorText)) matching.push(rule.selectorText);
      } else if ("cssRules" in rule) walk((rule as CSSGroupingRule).cssRules, condition);
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      walk(sheet.cssRules, null);
    } catch {
      // a sheet of another origin holds no rule of ours
    }
  }
  return { loose, media: [...media].map(([condition, rules]) => ({ condition, applies: window.matchMedia(condition).matches, rules })), matching };
}

const toHex = (rgb: string) => {
  const m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(rgb);
  if (!m) throw new Error(`not an rgb() colour: ${rgb}`);
  return `#${[m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, "0")).join("")}`;
};
const isDark = (rgb: string) => contrastRatio(toHex(rgb), "#ffffff") > 10;

/* ====================================================================== people and pages */

interface People {
  nobody: BrowserContext;
  example: BrowserContext;
  blank: BrowserContext;
  her: BrowserContext;
  all: BrowserContext[];
  /** what the words in braces of a page's path stand for in this run */
  vars: Record<string, string>;
}

async function devAccount(context: BrowserContext, data: Record<string, unknown>): Promise<void> {
  const res = await context.request.post("/api/dev/accounts", { data: { login: `dk${Math.random().toString(36).slice(2, 12)}`, password: PASSWORD, locale: "zh-Hans", ...data } });
  expect(res.status(), `dev account: ${await res.text()}`).toBe(201);
}

/** Mr Tan's example data on the developer test clock: laid out from Mon 12 Oct 2026, and now it is Tuesday morning, 08:30. */
async function exampleAccount(context: BrowserContext): Promise<void> {
  await setClock(context.request, SGT("2026-10-12", "10:00"));
  await devAccount(context, { space: "example", display_name: "陈先生" });
  await context.request.post("/api/me/example", { data: { action: "dismiss_intro" } });
  await setClock(context.request, SGT("2026-10-13", "08:30"));
}

/** Four browsers in windows of one size: nobody, the example account on a morning of its week, a blank account setting up, his daughter. */
async function people(browser: Browser, baseURL: string, viewport: { width: number; height: number }): Promise<People> {
  const mk = async () => {
    const context = await browser.newContext({ baseURL, viewport, locale: "zh-CN", timezoneId: "Asia/Singapore" });
    await context.addCookies([{ name: "rp_lang", value: "zh-Hans", url: baseURL }]);
    return context;
  };
  const nobody = await mk();
  const example = await mk();
  const blank = await mk();
  const her = await mk();
  await exampleAccount(example);
  await devAccount(blank, { space: "blank", onboarding: "started", display_name: "陈先生" });
  await devAccount(her, { space: "none", display_name: "Wei Ling" });
  const link = await linkFamily(example, her);
  await setSwitches(example, link, { dose_summary: true, bp_summary: true, questions_count: true, no_reply_alert: true });
  // her first-visit steps are done on this phone (lib/care/device.ts keeps that on the phone); Dad's number is not
  // saved, so 「打电话给爸爸」 opens her bottom sheet
  await her.addInitScript((id) => {
    try {
      localStorage.setItem(`rp_f_welcomed_${id}`, "1");
    } catch {
      // a page without storage
    }
  }, link);
  // an invitation nobody has answered: made by an account of its own, so the example account's family page stays as it is
  const host = await mk();
  await devAccount(host, { space: "blank", onboarding: "done", display_name: "林先生" });
  const made = await host.request.post("/api/family/invites", { data: { family_label: "Mei", relation: "daughter", patient_label: "爸爸" } });
  expect(made.status(), `an open invitation: ${await made.text()}`).toBe(201);
  const invite = String(((await made.json()) as { path: string }).path).replace(/^\/invite\//, "");
  await host.close();
  return { nobody, example, blank, her, all: [nobody, example, blank, her], vars: { link, invite } };
}

/** A page's address in this run: its words in braces filled in. */
function pathOf(p: PhonePage, vars: Record<string, string>): string {
  return p.path.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = vars[key];
    if (!value) throw new Error(`${p.name}: nothing to put for {${key}} in ${p.path}`);
    return encodeURIComponent(value);
  });
}

/** Open the page in its state; false when the state does not exist on this build (tapIfThere). */
async function openPhonePage(page: Page, p: PhonePage, vars: Record<string, string>): Promise<boolean> {
  const res = await page.goto(pathOf(p, vars));
  expect(res?.status(), `${p.path} answers`).toBeLessThan(400);
  await page.evaluate(() => document.fonts.ready);
  if (p.tap) {
    const control = page.getByTestId(p.tap);
    if (p.tapIfThere && (await control.count()) === 0) return false;
    await control.first().click();
  }
  // the note draws itself a frame after the page is up; give both a moment to settle before measuring
  await page.waitForTimeout(250);
  return true;
}

function report(line: string): void {
  test.info().annotations.push({ type: "fe-desk", description: line });
  console.log(`[fe-desk] ${line}`);
}

/**
 * One named check of a page. A check the page is still waiting for (another line's work) is run all the same and its
 * result printed, but it does not fail the run unless FE_DESK_STRICT=1.
 */
async function check(p: PhonePage, where: string, name: Check, body: () => void | Promise<void>): Promise<boolean> {
  const reason = p.waiting?.[name];
  if (!reason || STRICT) {
    await body();
    return true;
  }
  try {
    await body();
  } catch (err) {
    const first = String(err instanceof Error ? err.message : err).replace(ANSI, "").split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 4).join(" | ");
    report(`WAITING ${p.name} (${p.path}) ${where} ${name}: ${first} || ${reason}`);
    return false;
  }
  report(`${p.name} (${p.path}) ${where} ${name}: passes now, its \`waiting\` line can go`);
  return true;
}

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

const names = (list: { what: string; left: number; right: number }[]) => list.map((o) => `${o.what} [${o.left}, ${o.right}]`);

/** The four checks of one phone page in a wide window. */
async function expectPhonePage(page: Page, p: PhonePage, size: { width: number; height: number }): Promise<Measured> {
  const where = `at ${size.width}x${size.height}`;
  const m = await measure(page);
  const origin = new URL(page.url()).origin;

  await check(p, where, "column", () => {
    expect(m.column, `${p.path}: no phone column in the document (the foundation's Screen, a root marked data-rp-phone, or one of her screens)`).not.toBeNull();
    const c = m.column!;
    expect(Math.abs(c.width - DESK_COLUMN_UNITS), `${p.path}: the column ${c.what} is ${c.width}px wide, not ${DESK_COLUMN_UNITS}`).toBeLessThanOrEqual(0.5);
    expect(Math.abs((c.left + c.right) / 2 - m.client / 2), `${p.path}: the column ${c.what} [${c.left}, ${c.right}] is not in the middle of a window of ${m.client}`).toBeLessThanOrEqual(1);
    expect(c.top, `${p.path}: the column starts at the top of the window`).toBeLessThanOrEqual(0.5);
    expect(c.bottom, `${p.path}: the column reaches the bottom of the window (${m.winHeight})`).toBeGreaterThanOrEqual(m.winHeight - 0.5);
    expect(m.sideways, `${p.path}: the document scrolls sideways`).toBeLessThanOrEqual(0);
    expect(m.scrollers, `${p.path}: something around the column scrolls by itself (the document must)`).toEqual([]);
    if (c.kind === "desk") expect(c.shadow, `${p.path}: the column's one-pixel line`).toContain(c.dark ? LINE_DARK : LINE);
  });
  const c = m.column;
  if (!c) {
    report(`${p.name} (${p.path}) ${where}: no column, so inside, stage and note were not measured`);
    return m;
  }

  await check(p, where, "inside", () => {
    expect(names(m.outside.filter((o) => o.position === "fixed")), `${p.path}: fixed elements outside the column [${c.left}, ${c.right}]`).toEqual([]);
    expect(names(m.outside.filter((o) => o.position !== "fixed")), `${p.path}: elements of the page outside the column [${c.left}, ${c.right}]`).toEqual([]);
    for (const bar of m.bars) expect([bar.left, bar.right], `${p.path}: ${bar.what} has the column's edges`).toEqual([c.left, c.right]);
  });

  await check(p, where, "stage", () => {
    expect(m.body, `${p.path}: the colour behind the ${c.dark ? "dark" : "light"} column ${c.what}`).toBe(c.dark ? DARK : LIGHT);
    expect(Math.min(c.left, m.client - c.right), `${p.path}: the stage shows on both sides`).toBeGreaterThanOrEqual(100);
    expect(m.overStage, `${p.path}: painted over the stage beside the column`).toEqual([]);
  });

  if (size.width >= DESK_NOTE_MIN_WIDTH) {
    await check(p, where, "note", async () => {
      const n = m.note;
      expect(n, `${p.path}: the note beside the column`).not.toBeNull();
      if (!n) return;
      expect(n.position).toBe("fixed");
      expect(n.box.left, `${p.path}: the note is clear of the column`).toBeGreaterThanOrEqual(c.right + 8);
      expect(n.box.right, `${p.path}: the note is inside the window`).toBeLessThanOrEqual(m.client - 8);
      expect(n.box.top).toBeGreaterThanOrEqual(0);
      expect(n.box.bottom, `${p.path}: the whole note is in the window`).toBeLessThanOrEqual(m.winHeight);
      // the page's own language, the stage's own greys
      const locale = deskLocale(c.lang);
      expect(n.lang).toBe(locale);
      expect([n.label, n.code, n.lead, n.text]).toEqual([DESK_COPY[locale].label, DESK_COPY[locale].code, DESK_COPY[locale].lead, DESK_COPY[locale].text]);
      expect(n.stage, `${p.path}: the note's greys follow the stage (${m.body})`).toBe(isDark(m.body) ? "dark" : "light");
      for (const colour of n.colours) expect(contrastRatio(toHex(colour), toHex(m.body)), `${p.path}: ${colour} on ${m.body}`).toBeGreaterThanOrEqual(4.5);
      for (const px of n.sizes) expect(px).toBeGreaterThanOrEqual(18);
      // the code: the site's origin plus "/", whatever page this is
      expect(n.url).toBe(`${origin}/`);
      expect(n.d, `${p.path}: the code drawn is the code of ${origin}/`).toBe(qrSvgPath(encodeQr(`${origin}/`)!).d);
      // nothing of the page is said twice
      expect(m.duplicates.testIds, `${p.path}: a test id of the note is also the page's`).toEqual([]);
      expect(m.duplicates.names, `${p.path}: a role and name of the note is also the page's`).toEqual([]);
      expect(m.duplicates.texts, `${p.path}: words of the page that are inside the note's words`).toEqual([]);
      await expect(page.getByTestId("desk-note")).toHaveCount(1);
      await expect(page.getByRole("complementary")).toHaveCount(1);
      await expect(page.getByRole("img", { name: DESK_COPY[locale].code })).toHaveCount(1);
    });
  }
  return m;
}

async function shot(page: Page, name: string): Promise<void> {
  if (!DIR) return;
  const out = path.join(DIR, "desk");
  mkdirSync(out, { recursive: true });
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" }).catch(() => undefined);
  await page.screenshot({ path: path.join(out, `${name}.png`), animations: "disabled" });
}

test.afterAll(async ({ request }) => {
  await clearClock(request);
});

/* ====================================================================== a wide window: every phone page */

for (const size of WIDE) {
  test.describe(`a window of ${size.width}x${size.height}`, () => {
    let who: People;

    test.beforeAll(async ({ browser, baseURL }) => {
      test.setTimeout(120_000);
      who = await people(browser, baseURL!, size);
    });
    test.afterAll(async () => {
      for (const context of who?.all ?? []) await context.close();
    });

    // every screen at 1440x900, where the pictures are taken; the main pages again in the suite's own window, 1280x720
    for (const p of size.width === 1440 ? [...PHONE_PAGES, ...MORE_PAGES] : PHONE_PAGES) {
      test(`${p.name} (${p.path}): a column of 430 in the middle, the bars inside it, the stage on both sides, the note beside it`, async () => {
        test.setTimeout(60_000);
        const page = await who[p.who].newPage();
        try {
          const there = await openPhonePage(page, p, who.vars);
          test.skip(!there, `${p.path} has no ${p.tap} control on this build`);
          await expectPhonePage(page, p, size);
          if (size.width === 1440) await shot(page, p.name);
        } finally {
          await page.close();
        }
      });
    }

    test("Today: the tab bar's links work, and a page longer than the window scrolls with the window while the bars stay", async () => {
      test.setTimeout(60_000);
      const page = await who.example.newPage();
      try {
        await page.goto("/p/today");
        await expect(page.getByTestId("page-today")).toHaveAttribute("data-scope", "account");
        const m0 = await measure(page);
        const c = m0.column!;
        // all five tabs sit inside the column
        const tabs = await page.locator(".rpu-tabs [data-tab]").evaluateAll((els) => els.map((el) => ({ tab: el.getAttribute("data-tab"), left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right })));
        expect(tabs.map((t) => t.tab)).toEqual(["today", "visit", "meds", "bp", "questions"]);
        for (const t of tabs) {
          expect(t.left, `tab ${t.tab}`).toBeGreaterThanOrEqual(c.left - 0.5);
          expect(t.right, `tab ${t.tab}`).toBeLessThanOrEqual(c.right + 0.5);
        }
        // a tab leads where it says, and the page it opens is a column too; then back
        await page.locator('.rpu-tabs [data-tab="meds"]').click();
        await page.waitForURL("**/p/meds");
        await expect(page.locator('.rpu-tabs [data-tab="meds"]')).toHaveAttribute("aria-current", "page");
        const meds = await measure(page);
        expect([meds.column?.left, meds.column?.width]).toEqual([c.left, c.width]);
        await page.locator('.rpu-tabs [data-tab="today"]').click();
        await page.waitForURL("**/p/today");
        await expect(page.getByTestId("page-today")).toBeVisible();

        // the page is longer than the window: the window scrolls it, with the wheel over the column and over the stage
        const before = await measure(page);
        expect(before.docHeight, "Today is longer than the window").toBeGreaterThan(before.winHeight + 200);
        expect(before.bars.map((b) => b.what.split("[")[0]).sort(), "the say bar and the tab bar are fixed").toEqual(["div.rpu.rpu-say", "nav.rpu.rpu-tabs"]);
        await page.mouse.move(c.left + c.width / 2, before.winHeight / 2);
        await page.mouse.wheel(0, 300);
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(250);
        await page.mouse.move(c.left / 2, before.winHeight / 2);
        await page.mouse.wheel(0, 200);
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(450);
        const after = await measure(page);
        // the column moved up with the document; the bars did not move at all
        expect(after.column!.top).toBeCloseTo(-after.scrollY, 0);
        expect([after.column!.left, after.column!.right]).toEqual([c.left, c.right]);
        expect(after.bars).toEqual(before.bars);
        expect(Math.max(...after.bars.map((b) => b.bottom)), "the tab bar is at the bottom of the window").toBe(after.winHeight);
        expect(after.scrollers).toEqual([]);
        expect(names(after.outside)).toEqual([]);
      } finally {
        await page.close();
      }
    });
  });
}

/* ====================================================================== more of the wide layout */

test.describe("the wide layout", () => {
  test.use({ viewport: { width: 1440, height: 900 }, locale: "zh-CN", timezoneId: "Asia/Singapore" });

  test("the reminder that is due sits above the page as the top of the column", async ({ context, page }) => {
    test.setTimeout(90_000);
    await exampleAccount(context);
    try {
      // Tuesday 08:45: the morning reminder is out and not answered; he is on another page than Today
      await setClock(context.request, SGT("2026-10-13", "08:45"));
      await tick(context.request);
      await setClock(context.request, SGT("2026-10-13", "08:46"));
      await page.goto("/p/bp");
      const strip = page.getByTestId("due-reminder");
      await expect(strip).toBeVisible();
      await page.waitForTimeout(250);
      const m = await measure(page);
      const c = m.column!;
      const s = (await strip.boundingBox())!;
      expect([s.x, s.x + s.width], "the strip has the column's edges").toEqual([c.left, c.right]);
      expect(s.y, "the strip is the top of the column").toBe(0);
      expect(c.top, "the page starts right under it").toBeCloseTo(s.height, 0);
      expect(c.bottom, "and still ends at the bottom of the window").toBeGreaterThanOrEqual(m.winHeight - 0.5);
      expect(Math.abs(c.width - DESK_COLUMN_UNITS)).toBeLessThanOrEqual(0.5);
      expect(names(m.outside)).toEqual([]);
      expect(m.overStage).toEqual([]);
      expect(m.body).toBe(LIGHT);
      expect(await strip.evaluate((el) => getComputedStyle(el).boxShadow), "the strip carries the column's line").toContain(LINE);
      await shot(page, "bp-reminder-due");
    } finally {
      await setClock(context.request, SGT("2026-10-13", "08:30"));
    }
  });

  test("a larger text size widens the column instead of crushing the page, and the note leaves when there is no room", async ({ context, page }) => {
    test.setTimeout(90_000);
    await exampleAccount(context);
    await page.goto("/p/today");
    await expect(page.getByTestId("desk-note")).toHaveCount(1);
    const text = page.getByTestId("dose-headline").first();
    const px = await text.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    // 125%: the column is 537.5px, the note moves out with it and still fits
    await page.evaluate(() => (document.documentElement.style.fontSize = "20px"));
    await expect.poll(async () => (await measure(page)).column?.width).toBe(537.5);
    let m = await measure(page);
    expect(Math.abs((m.column!.left + m.column!.right) / 2 - m.client / 2)).toBeLessThanOrEqual(1);
    for (const bar of m.bars) expect([bar.left, bar.right]).toEqual([m.column!.left, m.column!.right]);
    await expect(page.getByTestId("desk-note")).toHaveCount(1);
    expect(m.note!.box.left).toBeGreaterThanOrEqual(m.column!.right + 8);
    expect(m.note!.box.right).toBeLessThanOrEqual(m.client - 8);
    // 200%: twice the width, twice the text, the bars with it; no room for the note any more
    await page.evaluate(() => (document.documentElement.style.fontSize = "32px"));
    await expect.poll(async () => (await measure(page)).column?.width).toBe(860);
    await expect(page.getByTestId("desk-note")).toHaveCount(0);
    m = await measure(page);
    expect(Math.abs((m.column!.left + m.column!.right) / 2 - m.client / 2)).toBeLessThanOrEqual(1);
    for (const bar of m.bars) expect([bar.left, bar.right]).toEqual([m.column!.left, m.column!.right]);
    expect(await text.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeCloseTo(px * 2, 1);
    expect(m.sideways).toBeLessThanOrEqual(0);
    // a window narrower than that column: the column is the window, the bars too, nothing scrolls sideways
    await page.setViewportSize({ width: 800, height: 900 });
    await expect.poll(async () => (await measure(page)).column?.width).toBe(800);
    m = await measure(page);
    expect(m.column!.left).toBe(0);
    for (const bar of m.bars) expect([bar.left, bar.right]).toEqual([0, 800]);
    expect(m.sideways).toBeLessThanOrEqual(0);
    // back to the default size: 430 again, and the note comes back
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => (document.documentElement.style.fontSize = ""));
    await expect.poll(async () => (await measure(page)).column?.width).toBe(430);
    await expect(page.getByTestId("desk-note")).toHaveCount(1);
  });

  /**
   * The mark a page root carries (the contract every line was given): bare or "light" is the light stage, "dark" the dark
   * one. The elder's sign-in pages come marked "light", her invitation pages "dark" (line fe-auth).
   */
  const MARKS = [
    { mark: "", stage: "light", body: LIGHT, line: LINE },
    { mark: "light", stage: "light", body: LIGHT, line: LINE },
    { mark: "dark", stage: "dark", body: DARK, line: LINE_DARK },
  ] as const;
  const OWN_ROOT = "a root with a width of its own";

  for (const kind of ["the page's own root", OWN_ROOT] as const) {
    test(`data-rp-phone on ${kind}: bare and "light" make it the column on the light stage, "dark" on the dark one`, async ({ page }) => {
      test.setTimeout(90_000);
      await page.goto("/");
      const note = page.getByTestId("desk-note");
      await expect(note).toHaveCount(1);
      const root = (await page.locator(DESK_COLUMN).first().elementHandle())!;
      if (kind === OWN_ROOT) {
        // The sign-in pages bring a root of their own (line fe-auth: in @layer components `width: 100%; max-width: 430px;
        // margin-inline: auto`, and outside any layer a ground for <body> behind a dark screen). A class of this test's
        // stands in for it on the front door's root. Unmarked it is no column, and no rule of this layout applies.
        await page.addStyleTag({
          content: [
            "@layer components { .xdesk-own-root { box-sizing: border-box; display: flex; flex-direction: column; width: 100%; max-width: 430px; min-height: 100dvh; margin-inline: auto; background: #0A0C0F; } }",
            'html:has(.xdesk-own-root[data-rp-phone="dark"]) body { background: #05070A; }',
          ].join("\n"),
        });
        await root.evaluate((el) => {
          el.setAttribute("class", "xdesk-own-root");
          el.removeAttribute("data-rp-phone");
        });
        await expect(note).toHaveCount(0);
        expect((await measure(page)).column, "an unmarked root of another kind is no column of this layout").toBeNull();
        expect((await page.evaluate(deskRulesInPage)).matching, "and no rule of app/desktop.css applies to its page").toEqual([]);
      }
      for (const m of MARKS) {
        const where = `${kind}, data-rp-phone="${m.mark}"`;
        await root.evaluate((el, mark) => el.setAttribute("data-rp-phone", mark), m.mark);
        await expect(note, where).toHaveAttribute("data-stage", m.stage);
        const got = await measure(page);
        expect([got.column?.width, got.column?.left, got.column?.dark], `${where}: the column`).toEqual([430, 505, m.stage === "dark"]);
        expect(got.body, `${where}: the stage`).toBe(m.body);
        expect(got.column?.shadow, `${where}: the column's line`).toContain(m.line);
        expect(got.sideways, `${where}: sideways scroll`).toBeLessThanOrEqual(0);
        // the note beside it is readable on that stage
        for (const colour of got.note!.colours) expect(contrastRatio(toHex(colour), toHex(m.body)), `${where}: ${colour} on ${m.body}`).toBeGreaterThanOrEqual(4.5);
        expect((await contrastViolations(page, { scope: '[data-testid="desk-note"]' })).violations, `${where}: axe on the note`).toEqual([]);
        if (kind !== OWN_ROOT && m.mark === "dark") await shot(page, "hook-dark-stage");
      }
      if (kind === OWN_ROOT) {
        // (the root is dark now, and the document holds no screen of the foundation)
        // its own `max-width: 430px` does not hold it back when the text is larger: 125% is 537.5px, like every column
        await page.evaluate(() => (document.documentElement.style.fontSize = "20px"));
        await expect.poll(async () => (await measure(page)).column?.width).toBe(537.5);
        await page.evaluate(() => (document.documentElement.style.fontSize = ""));
        await expect.poll(async () => (await measure(page)).column?.width).toBe(430);
        // and a marked fixed element keeps this column's edges too
        const strip = await page.evaluate(() => {
          const el = document.createElement("div");
          el.setAttribute("data-rp-phone-fixed", "");
          el.setAttribute("style", "position: fixed; top: 0; left: 0; right: 0; height: 4px;");
          document.body.appendChild(el);
          const r = el.getBoundingClientRect();
          el.remove();
          return [r.left, r.right];
        });
        expect(strip).toEqual([505, 935]);
      }
    });
  }

  test("data-rp-phone-fixed: a fixed element of another line keeps the column's left and right edges, at the bottom of the phone and at its top", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/");
    await expect(page.locator(DESK_COLUMN).first()).toBeVisible();
    // marked, it gets the column's left and right edges whatever its own left, right and width say; where it stands
    // (top or bottom) is its own to say
    const boxes = await page.evaluate((columnSelector) => {
      const column = document.querySelector(columnSelector)!;
      const put = (parent: Element, css: string, opts: { mark?: boolean; inner?: string } = {}) => {
        const el = document.createElement("div");
        if (opts.mark !== false) el.setAttribute("data-rp-phone-fixed", "");
        el.setAttribute("style", `position: fixed; background: #6A4C93; ${css}`);
        const inner = opts.inner ? document.createElement("span") : null;
        if (inner) {
          inner.setAttribute("style", opts.inner!);
          el.appendChild(inner);
        }
        parent.appendChild(el);
        const r = el.getBoundingClientRect();
        const i = inner?.getBoundingClientRect();
        const out = { x: [r.left, r.right], y: [r.top, r.bottom], inner: i ? [i.left, i.right] : null };
        el.remove();
        return out;
      };
      const c = column.getBoundingClientRect();
      return {
        column: [c.left, c.right],
        height: window.innerHeight,
        // at the bottom of the phone
        spanning: put(column, "bottom: 0; height: 24px; left: 0; right: 0;"),
        fullWidth: put(column, "bottom: 0; height: 24px; left: 0; width: 100%;"),
        inset: put(column, "bottom: 0; height: 24px; left: 14px; right: 14px; max-width: 520px; margin-inline: auto;"),
        onBody: put(document.body, "bottom: 0; height: 24px; inset-inline: 0;"),
        // at the top of the phone: a strip over its top edge, mounted beside the page, with a bar that grows inside it
        // from the left (the mark that the next page is on its way, line fe-12)
        strip: put(document.body, "top: 0; left: 0; right: 0; height: 4px; overflow: hidden; pointer-events: none;", {
          inner: "display: block; height: 100%; transform-origin: left center; transform: scaleX(.5);",
        }),
        stripFullWidth: put(column, "top: 0; left: 0; width: 100%; height: 4px;"),
        // and without the mark both span the window: the mark is what keeps them in
        unmarked: put(column, "bottom: 0; height: 24px; left: 0; right: 0;", { mark: false }),
        unmarkedStrip: put(document.body, "top: 0; left: 0; right: 0; height: 4px;", { mark: false }),
      };
    }, DESK_COLUMN);
    expect(boxes.column).toEqual([505, 935]);
    for (const key of ["spanning", "fullWidth", "inset", "onBody"] as const) {
      expect(boxes[key].x, `a marked fixed element at the bottom (${key})`).toEqual(boxes.column);
      expect(boxes[key].y, `… is still at the bottom of the window (${key})`).toEqual([boxes.height - 24, boxes.height]);
    }
    for (const key of ["strip", "stripFullWidth"] as const) {
      expect(boxes[key].x, `a marked fixed element at the top (${key})`).toEqual(boxes.column);
      expect(boxes[key].y, `… is still at the top of the window (${key})`).toEqual([0, 4]);
    }
    expect(boxes.strip.inner, "the bar inside the strip grows from the column's left edge").toEqual([505, 720]);
    expect(boxes.unmarked.x).toEqual([0, 1440]);
    expect(boxes.unmarkedStrip.x).toEqual([0, 1440]);
  });

  test("the note: there at 1440, gone at 1000, back when the window is wide again; it passes the pages' own text and contrast checks", async ({ page }) => {
    test.setTimeout(60_000);
    await page.goto("/");
    const note = page.getByTestId("desk-note");
    await expect(note).toBeVisible();
    expect((await textBelowMinimum(page, { scope: '[data-testid="desk-note"]', side: "elder" })).out, "text under 18px in the note").toEqual([]);
    expect((await contrastViolations(page, { scope: '[data-testid="desk-note"]' })).violations, "axe on the note, light stage").toEqual([]);
    expect(await note.locator("a, button, input, [tabindex]").count(), "nothing in the note takes a tap or the keyboard").toBe(0);
    await page.setViewportSize({ width: 1000, height: 800 });
    await expect(note).toHaveCount(0);
    const narrow = await measure(page);
    expect([narrow.column?.width, narrow.column?.left]).toEqual([430, 285]);
    expect(narrow.body, "the stage is still there at 1000").toBe(narrow.column?.dark ? DARK : LIGHT);
    await page.setViewportSize({ width: DESK_NOTE_MIN_WIDTH, height: 800 });
    await expect(note).toHaveCount(1);
    const m = await measure(page);
    expect(m.note!.box.left).toBeGreaterThanOrEqual(m.column!.right + 8);
    expect(m.note!.box.right).toBeLessThanOrEqual(m.client - 8);
    await page.setViewportSize({ width: DESK_NOTE_MIN_WIDTH - 1, height: 800 });
    await expect(note).toHaveCount(0);
    // English page, English note; the code is the same front door
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/login?lang=en");
    await expect(note).toHaveAttribute("lang", "en");
    await expect(note.locator(".rpdesk-note-lead")).toHaveText(DESK_COPY.en.lead);
    await expect(page.getByTestId("desk-note-qr")).toHaveAttribute("data-url", `${new URL(page.url()).origin}/`);
    await shot(page, "note-english");
    // a link from a phone page to a page made for a computer (no reload): the note leaves with the page it stood beside
    await page.goto("/");
    await expect(note).toHaveCount(1);
    await page.getByTestId("front-door-demo").click();
    await page.waitForURL("**/demo");
    await expect(page.getByTestId("page-landing")).toBeVisible();
    await expect(note).toHaveCount(0);
  });
});

test("with a classic scrollbar (100vw would be about 15px wider than the page) the bars sit exactly on the column, in the middle of the page", async ({ baseURL }) => {
  test.setTimeout(120_000);
  // Playwright hides scrollbars in headless Chromium; this browser keeps them, as browsers on Windows have them. A
  // browser of its own, because the way a browser is launched cannot change inside one file's worker.
  const browser = await chromium.launch({ ignoreDefaultArgs: ["--hide-scrollbars"] });
  try {
    const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 720 }, locale: "zh-CN", timezoneId: "Asia/Singapore" });
    await exampleAccount(context);
    const page = await context.newPage();
    await page.goto("/p/today");
    await expect(page.getByTestId("page-today")).toHaveAttribute("data-scope", "account");
    await page.waitForTimeout(250);
    const m = await measure(page);
    const bar = m.inner - m.client;
    test.skip(bar <= 0, "this browser draws its scrollbar over the page: there is no classic scrollbar to measure against");
    report(`classic scrollbar: ${bar}px (window ${m.inner}, page ${m.client}); column [${m.column!.left}, ${m.column!.right}]; bars ${m.bars.map((b) => `[${b.left}, ${b.right}]`).join(" ")}`);
    expect(Math.abs(m.column!.width - DESK_COLUMN_UNITS)).toBeLessThanOrEqual(0.5);
    expect(Math.abs((m.column!.left + m.column!.right) / 2 - m.client / 2), "the column is in the middle of the page, not of the window").toBeLessThanOrEqual(0.5);
    expect(m.bars.length, "the say bar and the tab bar").toBe(2);
    for (const b of m.bars) expect([b.left, b.right], `${b.what} on the column`).toEqual([m.column!.left, m.column!.right]);
    expect(m.sideways).toBeLessThanOrEqual(0);
    expect(names(m.outside)).toEqual([]);
  } finally {
    await browser.close();
  }
});

/* ====================================================================== a phone: nothing changed */

test.describe(`a phone, ${PHONE.width}x${PHONE.height}: nothing changed`, () => {
  let who: People;

  test.beforeAll(async ({ browser, baseURL }) => {
    test.setTimeout(120_000);
    who = await people(browser, baseURL!, PHONE);
  });
  test.afterAll(async () => {
    for (const context of who?.all ?? []) await context.close();
  });

  for (const p of PHONE_PAGES) {
    test(`${p.name} (${p.path}): the column fills the window, the bars span it, no note, no rule of app/desktop.css applies`, async () => {
      test.setTimeout(60_000);
      const page = await who[p.who].newPage();
      try {
        const there = await openPhonePage(page, p, who.vars);
        test.skip(!there, `${p.path} has no ${p.tap} control on this build`);
        const m = await measure(page);
        expect(m.note, "no note on a phone").toBeNull();
        expect(m.sideways).toBeLessThanOrEqual(0);
        for (const bar of m.bars) expect([bar.left, bar.right], `${bar.what} spans the phone`).toEqual([0, m.client]);
        // no stage either: the ground behind the page is whatever the page's own rules say, because none of this layout's do
        const rules = await page.evaluate(deskRulesInPage);
        expect(rules.media.filter((r) => r.applies), "media blocks of app/desktop.css that apply on a phone").toEqual([]);
        expect(rules.matching.filter((s) => s !== ".rpdesk-note"), "rules of app/desktop.css that match something on a phone").toEqual([]);
        if (!m.column) {
          expect(p.waiting?.column, `${p.path}: no column`).toBeTruthy();
          return;
        }
        expect([m.column.left, m.column.width], `${p.path}: the screen ${m.column.what} fills the phone`).toEqual([0, m.client]);
        if (m.column.kind === "desk") expect([m.column.shadow, m.column.marginLeft], "no line, no margin").toEqual(["none", "0px"]);
      } finally {
        await page.close();
      }
    });
  }

  test(`one pixel under the layout's width (${DESK_MIN_WIDTH - 1}px): still the phone's layout, edge to edge; at ${DESK_MIN_WIDTH}px the column`, async () => {
    test.setTimeout(60_000);
    const page = await who.example.newPage();
    try {
      await page.setViewportSize({ width: DESK_MIN_WIDTH - 1, height: 900 });
      await page.goto("/p/today");
      await expect(page.getByTestId("page-today")).toHaveAttribute("data-scope", "account");
      let m = await measure(page);
      expect([m.column?.left, m.column?.width, m.column?.shadow]).toEqual([0, DESK_MIN_WIDTH - 1, "none"]);
      for (const bar of m.bars) expect([bar.left, bar.right]).toEqual([0, DESK_MIN_WIDTH - 1]);
      expect((await page.evaluate(deskRulesInPage)).media.filter((r) => r.applies), `media blocks of app/desktop.css that apply at ${DESK_MIN_WIDTH - 1}px`).toEqual([]);
      expect(m.note).toBeNull();
      await page.setViewportSize({ width: DESK_MIN_WIDTH, height: 900 });
      await expect.poll(async () => (await measure(page)).column?.width).toBe(430);
      m = await measure(page);
      expect((await page.evaluate(deskRulesInPage)).media.filter((r) => r.applies).map((r) => r.condition)).toEqual([`screen and (min-width: ${DESK_MIN_WIDTH}px)`]);
      expect([m.column?.left, m.body]).toEqual([(DESK_MIN_WIDTH - 430) / 2, LIGHT]);
      for (const bar of m.bars) expect([bar.left, bar.right]).toEqual([m.column!.left, m.column!.right]);
      expect(m.note, "no room for the note yet").toBeNull();
    } finally {
      await page.close();
    }
  });
});

/* ====================================================================== the pages made for a computer: unchanged */

test.describe("the pages made for a computer do not change at all", () => {
  test.use({ viewport: { width: 1440, height: 900 }, locale: "zh-CN", timezoneId: "Asia/Singapore" });

  /**
   * No column, no note, and not one rule of app/desktop.css matches anything in the document: so nothing of the page,
   * its ground included, comes from this layout, whatever the page's own line makes it look like.
   */
  async function expectUntouched(page: Page, name: string): Promise<void> {
    await page.waitForTimeout(250);
    expect(await page.locator(DESK_COLUMN).count(), `${name}: a phone column`).toBe(0);
    await expect(page.getByTestId("desk-note")).toHaveCount(0);
    const rules = await page.evaluate(deskRulesInPage);
    // the stylesheet is there (so this is a real answer), and nothing of it applies to this document
    expect(rules.loose).toEqual([".rpdesk-note { display: none; }"]);
    expect(rules.media.map((r) => r.condition).sort()).toEqual(["screen and (min-width: 1100px)", "screen and (min-width: 720px)"]);
    expect(rules.media.reduce((n, r) => n + r.rules, 0), "rules of app/desktop.css in the build").toBeGreaterThanOrEqual(12);
    expect(rules.matching, `${name}: rules of app/desktop.css that match something`).toEqual([]);
  }

  for (const c of COMPUTER_PAGES) {
    test(`${c.path}: its main containers are where they were before the layout existed, and no rule of the layout applies`, async ({ page }) => {
      test.setTimeout(90_000);
      expect((await page.goto(c.path))?.status()).toBe(200);
      if (c.ready) await expect(page.locator(c.ready)).toBeVisible({ timeout: 30_000 });
      await page.evaluate(() => document.fonts.ready);
      const boxes = await page.evaluate((selectors) => Object.fromEntries(selectors.map((s) => [s, ((r) => (r ? [Math.round(r.left * 100) / 100, Math.round(r.width * 100) / 100] : null))(document.querySelector(s)?.getBoundingClientRect())])), Object.keys(c.boxes));
      expect(boxes, `${c.path}: [left, width] at 1440x900`).toEqual(c.boxes);
      await expectUntouched(page, c.path);
      if (c.name === "demo") {
        // the phone in the frame is a narrow window of its own: no note in it, the layout does not apply to it
        const framed = () => page.frames().find((f) => f !== page.mainFrame() && new URL(f.url()).pathname.startsWith("/p/"));
        await expect.poll(() => !!framed(), { timeout: 30_000, message: "/demo's frame shows a phone page" }).toBe(true);
        const inside = framed()!;
        await inside.waitForLoadState("load");
        await page.waitForTimeout(250);
        expect(await inside.locator('[data-testid="desk-note"]').count(), "a note inside the framed phone").toBe(0);
        expect(await inside.evaluate(() => window.innerWidth)).toBeLessThan(DESK_MIN_WIDTH);
        expect((await inside.evaluate(deskRulesInPage)).media.filter((r) => r.applies)).toEqual([]);
      }
      await shot(page, `computer-${c.name}`);
    });
  }

  test("the sandbox phone in its own tab (the old frame, already a column) and the /design phones are not columns of this layout", async ({ page }) => {
    test.setTimeout(120_000);
    // the judge's sandbox: /demo makes it, then its phone is opened full size
    await page.goto("/demo");
    await expect(page.locator('[data-testid="hero-button"][data-ready="true"]')).toBeVisible({ timeout: 30_000 });
    for (const sandboxPath of ["/p/today", "/p/ask"]) {
      await page.goto(sandboxPath);
      // the old frame is what keeps a screen inside it from being a column of this layout (the selector names it)
      const frame = page.locator(".rp-patient").first();
      await expect(frame).toBeVisible();
      const b = (await frame.boundingBox())!;
      report(`sandbox ${sandboxPath} at 1440x900: the old frame .rp-patient is at ${b.x}, ${b.width} wide (its own rules; 505 and 430 before this layout existed)`);
      // a screen of the foundation inside the old frame is not a column: no line, no stage, no note
      for (const shadow of await page.locator(".rp-patient .rpu-screen").evaluateAll((els) => els.map((el) => getComputedStyle(el).boxShadow))) expect(shadow).toBe("none");
      await expectUntouched(page, `sandbox ${sandboxPath}`);
      await shot(page, `computer-sandbox${sandboxPath.replace(/\//g, "-")}`);
    }
    // the /design phones fill their container
    for (const designPath of ["/design/screens/elder-today-pending", "/design/frames", "/design/screens", "/design"]) {
      expect((await page.goto(designPath))?.status()).toBe(200);
      if (designPath !== "/design") expect(await page.locator('.rpu-screen[data-fill="container"]').count(), `${designPath} shows screens`).toBeGreaterThan(0);
      expect(await page.locator(DESK_COLUMN).count(), `${designPath}: a phone column`).toBe(0);
      await expect(page.getByTestId("desk-note")).toHaveCount(0);
      expect((await page.evaluate(deskRulesInPage)).matching, `${designPath}: rules of app/desktop.css that match something`).toEqual([]);
    }
    await page.goto("/design/screens/elder-today-pending");
    expect(await page.locator(".rpu-screen").first().evaluate((el) => el.getBoundingClientRect().width), "the composed screen fills the window").toBe(1440);
  });
});
