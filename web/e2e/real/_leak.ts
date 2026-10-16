/**
 * The watch for what must never reach a person's account (C2 track G; docs/plan/real-app.md 5.6 H1 and H3, lines
 * 1101-1103; 4.8 rule 7; 8.12 「全程扫 H3」). Used by e2e/real/story-leak.spec.ts and by the two whole-line journeys.
 *
 * Everything an account's browser gets is looked at: what the screen shows (the page's text), the raw HTML (the
 * document as it is now, with the data the framework ships inside it), and the body of every response the page asks
 * for (documents, the client router's payloads, every API answer). Each is checked for:
 *
 *   the demo's story words    「Day 29」, 「第29天」; a story clock label; the jump menu; the debug line
 *   the demo's plumbing       ?session= in any address the server built; a join code; the demo's own event types
 *                             (clock.changed, session.reset, session.filming_mode, session.member_joined)
 *   ids of people             each id given with addId (the account's scope id, which is the person's user id, and
 *                             the other party's): as it is, and inside base64 text (a token's payload)
 *   the story's own dates     24 Aug to 6 Oct 2026, in ISO, Chinese and English forms; only when the spec says so
 *                             (`storyDates`), which it may only do with the test clock far from those dates, so that
 *                             no real record of the account can fall on one
 *
 * A finding is a Hit: who, where, which rule, and the words around it. Nothing is thrown here: the caller ends with
 * expect(watch.report()).toEqual([]), so one run lists every leak instead of stopping at the first.
 *
 * Not looked at: the static files of the build (/_next/, scripts, styles, pictures, sound: they are the same for
 * everyone), the developer tools (/api/dev/*: they exist only on a test server and answer with ids by design), and the
 * open event stream itself (it never ends; `streamStart` reads its first frames instead).
 */
import type { APIResponse, BrowserContext, Page, Response } from "@playwright/test";
import { findId } from "../../tests/support/id-needles";

export interface Hit {
  who: string;
  where: string;
  rule: string;
  sample: string;
}

interface Rule {
  name: string;
  re: RegExp;
  /** which kinds of text it applies to (default: all) */
  on?: ("visible" | "html" | "response")[];
  /** a match that is not one after all (a date that carries another year, or is the tail of a longer number) */
  skip?: (m: RegExpExecArray, text: string) => boolean;
}

const RULES: Rule[] = [
  { name: "story day (Day N)", re: /\bDay\s?\d+\b/ },
  { name: "story day (第N天)", re: /第\s*\d+\s*天/ },
  { name: "?session= in an address", re: /[?&](?:amp;)?session=/ },
  { name: "join code", re: /加入码|\bjoin code\b|"join_code"\s*:\s*"[^"]/i },
  { name: "demo chrome (jump menu, debug line, story clock label)", re: /data-testid=\\?"(?:jump-menu|debug-info|story-day-label)\\?"/, on: ["html", "response"] },
  { name: "demo event type", re: /\b(?:clock\.changed|session\.reset|session\.filming_mode|session\.member_joined)\b/, on: ["response"] },
];

/**
 * The story's own dates: day 0 (24 Aug 2026) to day 43 (6 Oct 2026). A date written with another year (「2025年10月3日」,
 * "3 Oct 2025": an official page's own date) is not one of them, and neither is the tail of a longer month (「18月」 does
 * not exist, 「10月1日」 inside 「2026年10月10日」 does: the day must end there, the month must start there).
 */
const STORY_DATE_RULES: Rule[] = [
  { name: "story date (ISO)", re: /2026-(?:08-(?:2[4-9]|3[01])|09-\d{2}|10-0[1-6])/g },
  {
    name: "story date (Chinese)",
    // group 1: the year, when one is written
    re: /(?:(\d{4})年)?(?:8月(?:2[4-9]|3[01])日|9月\d{1,2}日|10月[1-6]日)/g,
    skip: (m, text) => (m[1] !== undefined ? m[1] !== "2026" : /[\d月]/.test(text.charAt(m.index - 1))),
  },
  {
    name: "story date (English)",
    // group 1: the year, when one follows
    re: /\b(?:(?:2[4-9]|3[01]) Aug(?:ust)?|\d{1,2} Sep(?:tember)?|0?[1-6] Oct(?:ober)?|Aug(?:ust)? (?:2[4-9]|3[01])|Sep(?:tember)? \d{1,2}|Oct(?:ober)? 0?[1-6])\b(?:,? (\d{4})\b)?/g,
    skip: (m) => m[1] !== undefined && m[1] !== "2026",
  },
];

const STATIC = /^\/_next\/|\.(?:js|mjs|css|map|png|jpe?g|webp|gif|svg|ico|woff2?|ttf|wav|mp3|webm|mp4|json)$|^\/sw\.js$|^\/manifest\.webmanifest$/;
const TEXTUAL = /text\/html|application\/json|text\/x-component|text\/plain|application\/x-ndjson/;

/** JSON-escaped characters as the characters they stand for (the framework's inline data escapes some). */
function unescaped(text: string): string {
  return text.replace(/\\u([0-9a-fA-F]{4})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

export interface Allowance {
  rule: string | RegExp;
  where: RegExp;
  /** the words around the match must look like this */
  sample?: RegExp;
  why: string;
}

export class LeakWatch {
  readonly hits: Hit[] = [];
  /** how much was looked at (a scan that saw nothing proves nothing) */
  readonly seen = { pages: 0, responses: 0, api: 0, documents: 0, router: 0, chars: 0 };
  /** addresses the browsers asked for (path and query), for the caller's own checks */
  readonly asked: string[] = [];
  private readonly ids: { name: string; id: string; exceptWho?: RegExp }[] = [];
  private readonly allowances: (Allowance & { used: number })[] = [];
  private readonly pending = new Set<Promise<void>>();
  private rules: Rule[];

  constructor(opts: { storyDates?: boolean } = {}) {
    this.rules = opts.storyDates ? [...RULES, ...STORY_DATE_RULES] : [...RULES];
  }

  /** An id that must not be in anything the browsers get. `exceptWho`: a watcher name it may reach (never needed for a scope id). */
  addId(name: string, id: string, exceptWho?: RegExp): void {
    if (id) this.ids.push({ name, id, exceptWho });
  }

  /** A place where a rule is allowed to match, with the reason; `unusedAllowances` lists the ones that never did. */
  allow(a: Allowance): void {
    this.allowances.push({ ...a, used: 0 });
  }

  unusedAllowances(): string[] {
    return this.allowances.filter((a) => a.used === 0).map((a) => `${String(a.rule)} at ${String(a.where)}: ${a.why}`);
  }

  /** Look at one text. `kind`: what the screen shows, the raw HTML, or a response body. */
  text(who: string, where: string, raw: string, kind: "visible" | "html" | "response"): void {
    if (!raw) return;
    const text = kind === "visible" ? raw : unescaped(raw);
    this.seen.chars += text.length;
    for (const rule of this.rules) {
      if (rule.on && !rule.on.includes(kind)) continue;
      // every match is offered: one that is allowed here (or is not one after all) must not hide the next
      const re = new RegExp(rule.re.source, rule.re.flags.includes("g") ? rule.re.flags : `${rule.re.flags}g`);
      for (let m = re.exec(text), n = 0; m && n < 200; m = re.exec(text), n++) {
        if (m[0] === "") re.lastIndex += 1;
        if (rule.skip?.(m, text)) continue;
        this.hit(who, `${where} (${kind})`, rule.name, text.slice(Math.max(0, m.index - 50), m.index + m[0].length + 50));
      }
    }
    for (const { name, id, exceptWho } of this.ids) {
      if (exceptWho?.test(who)) continue;
      for (const form of findId(text, id)) {
        const at = form === "plain" ? text.toLowerCase().indexOf(id.toLowerCase()) : -1;
        this.hit(who, `${where} (${kind})`, `${name} (${form})`, at >= 0 ? text.slice(Math.max(0, at - 50), at + id.length + 20) : "inside base64 text");
      }
    }
  }

  private hit(who: string, where: string, rule: string, sample: string): void {
    const clean = sample.replace(/\s+/g, " ").trim();
    for (const a of this.allowances) {
      const sameRule = typeof a.rule === "string" ? a.rule === rule : a.rule.test(rule);
      if (sameRule && a.where.test(where) && (!a.sample || a.sample.test(clean))) {
        a.used += 1;
        return;
      }
    }
    // one line per rule and place: a page that repeats a leak does not bury the others
    if (this.hits.some((h) => h.who === who && h.where === where && h.rule === rule)) return;
    this.hits.push({ who, where, rule, sample: clean });
  }

  /** Watch every response a browser context's pages ask for. */
  attach(context: BrowserContext, who: string): void {
    context.on("response", (res: Response) => {
      const job = this.response(who, res).catch(() => undefined);
      this.pending.add(job);
      void job.finally(() => this.pending.delete(job));
    });
  }

  private async response(who: string, res: Response): Promise<void> {
    let url: URL;
    try {
      url = new URL(res.url());
    } catch {
      return;
    }
    const base = new URL(res.frame().page().url() || "http://x");
    if (url.origin !== base.origin && base.origin !== "null") return;
    const where = `${res.request().method()} ${url.pathname}${url.search}`;
    this.asked.push(where);
    // the address itself: a browser only asks for what a page or an answer told it to
    this.address(who, where);
    if (STATIC.test(url.pathname) || url.pathname.startsWith("/api/dev/")) return;
    const type = res.headers()["content-type"] ?? "";
    if (type.includes("text/event-stream") || !TEXTUAL.test(type)) return;
    if (res.status() >= 300 && res.status() < 400) {
      this.address(who, `${where} -> ${res.headers().location ?? ""}`);
      return;
    }
    const body = await res.text().catch(() => "");
    this.seen.responses += 1;
    if (url.pathname.startsWith("/api/")) this.seen.api += 1;
    else if (url.searchParams.has("_rsc") || type.includes("text/x-component")) this.seen.router += 1;
    else this.seen.documents += 1;
    this.text(who, where, body, "response");
  }

  /** An address a browser asked for (or was sent to): no ?session=, no id of a person. */
  private address(who: string, where: string): void {
    if (/[?&]session=/.test(where)) this.hit(who, where, "?session= in an address", where);
    for (const { name, id, exceptWho } of this.ids) if (!exceptWho?.test(who) && findId(where, id).length) this.hit(who, where, `${name} in an address`, where);
  }

  /** An answer got outside a page (context.request...): looked at like a page's own. */
  async api(who: string, res: APIResponse, method = "GET"): Promise<void> {
    const url = new URL(res.url());
    if (url.pathname.startsWith("/api/dev/")) return;
    const where = `${method} ${url.pathname}${url.search}`;
    this.address(who, where);
    const type = res.headers()["content-type"] ?? "";
    if (!TEXTUAL.test(type)) return;
    this.seen.responses += 1;
    this.seen.api += 1;
    this.text(who, where, await res.text().catch(() => ""), "response");
  }

  /** The page as it stands now: what it shows, and its HTML with everything shipped inside it. */
  async page(page: Page, who: string, name?: string): Promise<void> {
    const url = new URL(page.url());
    const where = name ?? `${url.pathname}${url.search}`;
    this.address(who, `page ${url.pathname}${url.search}`);
    const visible = await page.evaluate(() => document.body?.innerText ?? "").catch(() => "");
    const html = await page.content().catch(() => "");
    this.seen.pages += 1;
    this.text(who, where, visible, "visible");
    this.text(who, where, html, "html");
    // what a screen reader is given and the eye is not: labels, titles, alternative texts
    const spoken = await page
      .evaluate(() => [...document.querySelectorAll("[aria-label],[title],[alt],[placeholder]")].map((el) => ["aria-label", "title", "alt", "placeholder"].map((a) => el.getAttribute(a) ?? "").join(" ")).join("\n"))
      .catch(() => "");
    this.text(who, `${where} (labels)`, spoken, "visible");
  }

  /**
   * The first frames of this browser's own event stream (GET /api/events with its cookies, `query` for her link): the
   * text as it came within `ms`. The caller checks the first line; the frames are looked at like any answer.
   */
  async streamStart(page: Page, who: string, query = "", ms = 1500): Promise<string> {
    const text = await page.evaluate(
      async ({ query, ms }) => {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), ms);
        let out = "";
        try {
          const res = await fetch(`/api/events${query}`, { signal: ctl.signal, headers: { accept: "text/event-stream" } });
          if (!res.body) return `status ${res.status}`;
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          for (;;) {
            const next = await reader.read();
            if (next.done) break;
            out += decoder.decode(next.value, { stream: true });
          }
        } catch {
          // aborted after `ms`: what came so far is the answer
        } finally {
          clearTimeout(timer);
        }
        return out;
      },
      { query, ms },
    );
    this.seen.responses += 1;
    this.text(who, `GET /api/events${query} (first frames)`, text, "response");
    return text;
  }

  /** Wait until every response seen so far has been read. */
  async settle(): Promise<void> {
    for (let i = 0; i < 20 && this.pending.size; i++) await Promise.allSettled([...this.pending]);
  }

  /** Every finding, one line each (empty: nothing leaked). */
  report(): string[] {
    return this.hits.map((h) => `[${h.who}] ${h.where}: ${h.rule}: …${h.sample}…`);
  }
}
