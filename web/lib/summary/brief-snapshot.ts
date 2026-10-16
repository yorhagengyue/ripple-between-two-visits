/**
 * The brief as it was shown to the doctor (C2 track B, second round; real-app 2.18, 6.6 「快照照序 19」; e2e-chains 14.2,
 * 序 19: 哪天、给谁、看的是哪一版). Server-only.
 *
 * When he opens 「给医生看」 the page asks for this once (components/brief/BriefShown.tsx -> POST /api/brief). What is kept
 * in brief_snapshot (migration 0007, his own scope; in his export, gone with his account):
 *
 *   date      the day whose brief it was (his date), and the window it covered
 *   to        who it was shown to: the doctor (the only "show" there is)
 *   version   a short fingerprint of the content, so "which version" has an answer: the same brief shown twice that day
 *             is one row (its shown_at moves to the last time); a brief that changed in between (he logged a reading
 *             in the waiting room) is a new row
 *   views     the two pages the doctor could see (English and 华语), exactly the data the screen drew, so a later look
 *             at /p/brief?shown=<id> is the same page with the same numbers, whatever he logs afterwards. Clip links
 *             are left out (they are short-lived links, and the shown page has no play button).
 *   shown_at  when (the store's markBriefShown)
 *
 * Nothing is judged and nothing is added: the snapshot is the page.
 */
import { createHash } from "node:crypto";
import type { Locale } from "@/lib/i18n";
import { isAccount } from "@/lib/store/scope";
import type { BriefSnapshotRow, SessionRow, Store } from "@/lib/store/types";
import { nowMs as appNowMs } from "@/lib/time/now";
import { buildAccountBrief, type AccountBriefView } from "./account-brief";

export const BRIEF_SNAPSHOT_V = 1;

export interface BriefSnapshotData {
  v: typeof BRIEF_SNAPSHOT_V;
  kind: "account";
  /** his date that day, YYYY-MM-DD */
  date: string;
  window: { fromDate: string; toDate: string; lastVisitDate: string | null };
  to: "doctor";
  version: string;
  views: Record<Locale, AccountBriefView>;
}

export interface BriefShownInfo {
  id: string;
  date: string;
  version: string;
  shownAt: string | null;
  /** false: this version was already kept today (only shown_at moved) */
  created: boolean;
}

/** The view without what must not be kept: the short-lived clip links. */
export function viewForSnapshot(view: AccountBriefView): AccountBriefView {
  return {
    ...view,
    target: view.target ? { ...view.target, clipUrl: null } : null,
    targetLine: view.targetLine ? { ...view.targetLine, clipUrl: null } : null,
    above: view.above ? { ...view.above, line: { ...view.above.line, clipUrl: null } } : null,
  };
}

/** JSON with every object's keys in order, so the same content always gives the same text. */
function stable(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(stable).join(",")}]`;
  if (x && typeof x === "object") {
    const o = x as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(x) ?? "null";
}

/** A short fingerprint of what the two pages say (12 hex of SHA-256 over their data). */
export function briefVersion(views: Record<Locale, AccountBriefView>): string {
  return createHash("sha256").update(stable([views.en, views["zh-Hans"]])).digest("hex").slice(0, 12);
}

export function isBriefSnapshotData(x: unknown): x is BriefSnapshotData {
  const d = x as Partial<BriefSnapshotData> | null;
  return !!d && typeof d === "object" && d.v === BRIEF_SNAPSHOT_V && d.kind === "account" && typeof d.date === "string" && typeof d.version === "string" && !!d.views && !!d.views.en && !!d.views["zh-Hans"];
}

/**
 * Record that today's brief was shown to the doctor. Builds the two pages again at this moment (what the screen he is
 * holding was built from a second ago; translations only from what is already kept, so this never waits on a model),
 * keeps them unless this very version is already kept for today, and stamps shown_at.
 */
export async function recordBriefShown(store: Store, scope: SessionRow, opts: { nowMs?: number; homeLocale?: Locale } = {}): Promise<BriefShownInfo> {
  if (!isAccount(scope)) throw new Error("recordBriefShown is for an account");
  const nowMs = opts.nowMs ?? appNowMs();
  const [en, zh] = await Promise.all([
    buildAccountBrief(store, scope, "en", { nowMs, translate: "cache" }),
    buildAccountBrief(store, scope, "zh-Hans", { nowMs, translate: "cache" }),
  ]);
  const views = { en: viewForSnapshot(en), "zh-Hans": viewForSnapshot(zh) } as Record<Locale, AccountBriefView>;
  const version = briefVersion(views);
  const recent = await store.listBriefSnapshots(scope.id, { limit: 10 });
  const same = recent.find((r) => isBriefSnapshotData(r.data) && r.data.date === en.date && r.data.version === version) ?? null;
  const row: BriefSnapshotRow =
    same ??
    (await store.addBriefSnapshot(scope.id, {
      locale: opts.homeLocale ?? "en",
      data: {
        v: BRIEF_SNAPSHOT_V,
        kind: "account",
        date: en.date,
        window: { fromDate: en.window.fromDate, toDate: en.window.toDate, lastVisitDate: en.window.lastVisit?.date ?? null },
        to: "doctor",
        version,
        views,
      } satisfies BriefSnapshotData,
    }));
  const shown = await store.markBriefShown(scope.id, row.id);
  return { id: shown.id, date: en.date, version, shownAt: shown.shown_at, created: !same };
}

export interface ShownBrief {
  id: string;
  shownAt: string | null;
  data: BriefSnapshotData;
}

/** One kept brief of this scope (null: not there, or not a page this version can draw). */
export async function shownBrief(store: Store, scope: SessionRow, id: string): Promise<ShownBrief | null> {
  const row = await store.getBriefSnapshot(scope.id, id);
  if (!row || !isBriefSnapshotData(row.data)) return null;
  return { id: row.id, shownAt: row.shown_at, data: row.data };
}

/** The brief he last showed the doctor (null: never). */
export async function lastShownBrief(store: Store, scope: SessionRow): Promise<ShownBrief | null> {
  const rows = (await store.listBriefSnapshots(scope.id, { limit: 10 })).filter((r) => r.shown_at && isBriefSnapshotData(r.data));
  const last = rows.sort((a, b) => (a.shown_at ?? "").localeCompare(b.shown_at ?? "")).at(-1);
  return last ? { id: last.id, shownAt: last.shown_at, data: last.data as BriefSnapshotData } : null;
}
