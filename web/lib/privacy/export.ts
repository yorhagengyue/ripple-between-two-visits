/**
 * His data, exported (docs/plan/real-app.md 3.11 导出; the elder brief 15.1 「一份文件加 24 小时内有效的下载链接，一天最多导 3
 * 次」; journey 15; C2 track H). Server-only.
 *
 *   exportAllowance(...)    how many exports are left today (his scope's day, Singapore for an account without one)
 *   buildExport(...)        one JSON document: his account, his space, every table of his records, his side of the
 *                           family links with their switches, history and access log, his consents, account events,
 *                           devices, sign-in sessions, push subscriptions and the operators' reads of his data; plus
 *                           a list of his files (visit recordings, sentence clips, label photos, the reminders she
 *                           recorded for him) each with a signed link that works for 24 hours
 *   runExport(...)          the daily limit (3), the document, the count, an account event "export" (counts only)
 *
 * What she made, in her own export (real-app 3.11 「她的导出只有她的账号、她那一侧的链接、她的同意、她录的提醒的登记信息，不含他的
 * 数据」): for every person she has (or had) a link to, the reminders she recorded for him as they are registered
 * (reminders_recorded: which link, when it plays, the words kept from her own recording, when she made it, whether the
 * recording is still stored). No link to the sound and no path: the file lives in his storage and plays on his phone.
 * Her recordings are found in his reminders folder by the tag in their file names (lib/blob/prefix.ts blobUserTag);
 * the ones no registration points at any more are only counted.
 *
 * The document is made on request and handed straight to his phone: no copy is kept on the server, so there is no
 * export package to expire (real-app's exports/<id>/ folder is not used; the buckets hold recordings and photos only).
 *
 * Nothing in it names anyone else or says how to get in: no user ids (his own scope id included), no invitation-token
 * hash, no device or session hash, no push keys, no recovery-code hash. Rows from his own store already carry
 * session_id "" (lib/subject), and the key is dropped altogether. No invented text: field names and his data only.
 */
import { isStandInClip } from "@/lib/asr/fixtures";
import { bucketKey } from "@/lib/auth/limits";
import type { AuthProvider } from "@/lib/auth/provider";
import { blobPrefix, blobUserTag, pathInSession, reminderFileOf, type BlobBucket, type BlobStore } from "@/lib/blob";
import type { Env } from "@/lib/dev/enabled";
import { storyDate } from "@/lib/story/clock";
import type { AccountRow, CareLinkRow, SessionRow, Store, VisitAudioPart } from "@/lib/store/types";
import { DEFAULT_TZ, localDate, zonedTimeToUtcMs } from "@/lib/time/clock";
import { visitAudioPaths } from "@/lib/visit/recording";
import { addDays } from "./retention";
import { EXPORT_LIMIT_PER_DAY, EXPORT_LINK_SECONDS } from "./rules";

export { EXPORT_LIMIT_PER_DAY, EXPORT_LINK_SECONDS };
export const EXPORT_FORMAT = "ripple-export";
export const EXPORT_VERSION = 1;

export interface ExportStores {
  /** his own rows: the store bound to his scope (self mode), or to no scope for an account without one */
  own: Store;
  /**
   * the process-wide store, for what lies outside his own scope binding: the daily count, the operators' reads, and
   * (her export) the registrations of the reminders she recorded in the space of each person she has a link to
   */
  admin: Pick<Store, "rateHit" | "getRateWindow" | "listServiceReadLog" | "listReminderClips">;
  auth: Pick<AuthProvider, "listSessions">;
  blob: BlobStore;
}

export interface ExportWho {
  userId: string;
  account: AccountRow;
  /** his own scope row (the server's copy), or null */
  scope: SessionRow | null;
  /** his login as he types it (username or address) */
  login: string | null;
  /** this site's origin: the local blob driver's links are paths on it */
  origin: string;
}

export interface ExportClock {
  /** the app's clock (the developer test clock moves it): the day the count belongs to */
  nowMs: number;
  /** the machine's clock: the signed links' 24 hours are real hours */
  realNowMs: number;
  env?: Env;
}

export interface ExportFileEntry {
  kind: "visit_recording" | "sentence_clip" | "label_photo" | "reminder";
  bucket: BlobBucket;
  path: string;
  visit_id?: string;
  utterance_id?: string;
  medication_id?: string;
  reminder_id?: string;
  /** C2 track R, a visit recording kept as several files: which one this is (1 for the first) and how many there are */
  part?: number;
  parts?: number;
  /** a link that works until expires_at; null when the file is no longer in storage */
  url: string | null;
  expires_at: string | null;
}

export interface ExportFile {
  fileName: string;
  /** the document as sent (pretty-printed JSON) */
  json: string;
  data: Record<string, unknown>;
  files: number;
  rows: number;
  linksExpireAt: string;
}

// ------------------------------------------------------------------------------------------------ the daily limit

function tzOf(scope: Pick<SessionRow, "tz"> | null): string {
  return scope?.tz || DEFAULT_TZ;
}

/** The rate-limit bucket of his exports on one day (his id only as an HMAC). */
export function exportBucket(userId: string, day: string, env?: Env): string {
  return `h:ex:${bucketKey("user", userId, env)}:${day}`;
}

export interface ExportAllowance {
  day: string;
  used: number;
  left: number;
  /** his next midnight: the count starts again */
  resetsAt: string;
}

export async function exportAllowance(
  admin: Pick<Store, "getRateWindow">,
  who: { userId: string; scope: Pick<SessionRow, "tz"> | null },
  clock: Pick<ExportClock, "nowMs" | "env">,
): Promise<ExportAllowance> {
  const tz = tzOf(who.scope);
  const day = localDate(clock.nowMs, tz);
  const w = await admin.getRateWindow(exportBucket(who.userId, day, clock.env));
  const used = Math.min(EXPORT_LIMIT_PER_DAY, w?.count ?? 0);
  return { day, used, left: EXPORT_LIMIT_PER_DAY - used, resetsAt: new Date(zonedTimeToUtcMs(addDays(day, 1), "00:00", tz)).toISOString() };
}

// ------------------------------------------------------------------------------------------------ the document

const OTHER_PEOPLE = new Set(["session_id", "patient_id", "family_id", "family_user_id", "invite_token_hash", "entered_by_user_id", "asked_by_user_id", "by_user_id", "scope_id"]);

/** A row without its scope id and without anything that names another person. */
function clean<T extends object>(row: T, drop: readonly string[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (OTHER_PEOPLE.has(k) || drop.includes(k)) continue;
    out[k] = v;
  }
  return out;
}

function hisSideOfLink(l: CareLinkRow) {
  return {
    id: l.id,
    relation: l.relation,
    family_label: l.family_label,
    status: l.status,
    invited_at: l.created_at,
    invite_expires_at: l.invite_expires_at,
    accepted_at: l.accepted_at,
    confirmed_at: l.confirmed_at,
    revoked_at: l.revoked_at,
    revoked_by: l.revoked_by,
    reset_helper: l.reset_helper,
  };
}

function herSideOfLink(l: CareLinkRow) {
  return {
    id: l.id,
    relation: l.relation,
    patient_label: l.patient_label,
    status: l.status,
    accepted_at: l.accepted_at,
    confirmed_at: l.confirmed_at,
    revoked_at: l.revoked_at,
    revoked_by: l.revoked_by,
  };
}

function hostOf(endpoint: string): string | null {
  try {
    return new URL(endpoint).host;
  } catch {
    return null;
  }
}

/** The files his rows point at in his own storage folder (never a shared stand-in clip), once each. */
function candidateFiles(scope: SessionRow, tables: { visits: { id: string; audio_path: string | null; audio_parts?: VisitAudioPart[] | null }[]; utterances: { id: string; visit_id: string; clip_path: string | null }[]; meds: { id: string; label: { photo_path?: string | null } | null }[]; clips: { id: string; audio_path: string | null }[] }) {
  const prefix = blobPrefix(scope);
  const mine = (p: string | null | undefined): p is string => !!p && !isStandInClip(p) && pathInSession(prefix, p);
  const seen = new Set<string>();
  const out: Omit<ExportFileEntry, "url" | "expires_at">[] = [];
  const add = (e: Omit<ExportFileEntry, "url" | "expires_at">) => {
    const key = `${e.bucket}:${e.path}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(e);
  };
  // C2 track R: a long recording is several files, each one listed, in order (lib/visit/recording.ts)
  for (const v of tables.visits) {
    const paths = visitAudioPaths(v).filter(mine);
    paths.forEach((path, i) => add({ kind: "visit_recording", bucket: "audio", path, visit_id: v.id, ...(paths.length > 1 ? { part: i + 1, parts: paths.length } : {}) }));
  }
  for (const u of tables.utterances) if (mine(u.clip_path)) add({ kind: "sentence_clip", bucket: "audio", path: u.clip_path, visit_id: u.visit_id, utterance_id: u.id });
  for (const m of tables.meds) if (mine(m.label?.photo_path)) add({ kind: "label_photo", bucket: "labels", path: m.label!.photo_path!, medication_id: m.id });
  for (const c of tables.clips) if (mine(c.audio_path)) add({ kind: "reminder", bucket: "audio", path: c.audio_path, reminder_id: c.id });
  return out;
}

async function signFiles(blob: BlobStore, files: Omit<ExportFileEntry, "url" | "expires_at">[], origin: string, expiresAt: string): Promise<ExportFileEntry[]> {
  const out: ExportFileEntry[] = [];
  for (const f of files) {
    let url: string | null = null;
    try {
      const link = await blob.signedReadUrl(f.bucket, f.path, EXPORT_LINK_SECONDS);
      url = link.startsWith("/") ? `${origin.replace(/\/+$/, "")}${link}` : link;
    } catch (err) {
      // by name and code: the blob store lives on globalThis and may have been made by another route's copy of lib/blob
      const e = err as { name?: unknown; code?: unknown } | null;
      if (!(e && e.name === "BlobError" && e.code === "not_found")) throw err;
    }
    out.push({ ...f, url, expires_at: url ? expiresAt : null });
  }
  return out;
}

/**
 * The reminders this person recorded for the people she has (or had) a link to: the registration of each, never his
 * path or anything else of his. `stored` says whether the recording is still in storage; `unregistered` counts her
 * recordings there that no registration points at (uploaded and never saved, or deleted from her list: the nightly
 * sweep removes them).
 */
async function remindersRecordedBy(stores: Pick<ExportStores, "admin" | "blob">, userId: string, linksAsFamily: readonly CareLinkRow[]) {
  const tag = blobUserTag(userId);
  const rows: Record<string, unknown>[] = [];
  let unregistered = 0;
  for (const patientId of new Set(linksAsFamily.map((l) => l.patient_id))) {
    let clips: Awaited<ReturnType<Store["listReminderClips"]>>;
    try {
      clips = await stores.admin.listReminderClips(patientId);
    } catch {
      continue; // his space is gone (or he never had one): nothing of hers is left there
    }
    const prefix = blobPrefix({ id: patientId, kind: "account" });
    // the files in his reminders folder; a storage that does not answer leaves `stored` unknown (null)
    const files = await stores.blob.listFiles("audio", `${prefix}/reminders`).then(
      (list) => new Set(list.map((f) => f.path)),
      () => null,
    );
    const mine = clips.filter((c) => c.by_user_id === userId);
    for (const c of mine) {
      rows.push({
        id: c.id,
        link_id: c.link_id ?? null,
        plays_at: c.plays_at,
        text: c.text,
        lang: c.lang,
        created_at: c.created_at,
        recording_stored: c.audio_path && files ? files.has(c.audio_path) : null,
      });
    }
    if (files) {
      const registered = new Set(clips.map((c) => c.audio_path).filter((p): p is string => !!p));
      for (const f of files) if (reminderFileOf(prefix, tag, f) && !registered.has(f)) unregistered += 1;
    }
  }
  return { rows, unregistered };
}

/** The whole document (see the header). Reads only; counts nothing. */
export async function buildExport(stores: ExportStores, who: ExportWho, clock: ExportClock): Promise<ExportFile> {
  const { own } = stores;
  const u = who.userId;
  const scope = who.scope;
  const s = scope?.id ?? null;
  const linksAsPatient = await own.listCareLinks({ patient_id: u });
  const linksAsFamily = await own.listCareLinks({ family_id: u });

  const visits = s ? await own.listVisits(s) : [];
  const utterances = s ? (await Promise.all(visits.map((v) => own.listUtterances(s, v.id)))).flat() : [];
  const meds = s ? await own.listMeds(s) : [];
  const clips = s ? await own.listReminderClips(s) : [];
  const grants = s ? (await Promise.all(linksAsPatient.map((l) => own.getFamilyGrant(s, l.id)))).filter((g) => g !== null) : [];
  const history = (await Promise.all(linksAsPatient.map((l) => own.listGrantHistory(l.id)))).flat();
  const recorded = await remindersRecordedBy(stores, u, linksAsFamily);
  const [sessions, recovery, serviceReads] = await Promise.all([
    stores.auth.listSessions(u),
    own.getRecoveryCode(u),
    s ? stores.admin.listServiceReadLog({ session_id: s }) : Promise.resolve([]),
  ]);

  const tables: Record<string, Record<string, unknown>[]> = {
    visits: visits.map((r) => clean(r)),
    utterances: utterances.map((r) => clean(r)),
    visit_items: s ? (await own.listVisitItems(s)).map((r) => clean(r)) : [],
    medications: meds.map((r) => clean(r)),
    understanding_answers: s ? (await own.listUnderstandingAnswers(s)).map((r) => clean(r)) : [],
    dose_log: s ? (await own.listDoses(s)).map((r) => clean(r)) : [],
    // C2 track B (0016_b_bp_changes): the readings he deleted are still his record (deleted_at and history say so)
    bp_readings: s ? (await own.listBp(s, { includeDeleted: true })).map((r) => clean(r)) : [],
    notes: s ? (await own.listNotes(s)).map((r) => clean(r)) : [],
    questions: s ? (await own.listQuestions(s)).map((r) => clean(r)) : [],
    reminder_clips: clips.map((r) => clean(r)),
    profile_facts: s ? (await own.listProfileFacts(s)).map((r) => clean(r)) : [],
    prevent_done: s ? (await own.listPreventDone(s)).map((r) => clean(r)) : [],
    watch_metrics: s ? (await own.listWatchMetrics(s)).map((r) => clean(r)) : [],
    diet_checks: s ? (await own.listDietChecks(s)).map((r) => clean(r)) : [],
    chat_messages: s ? (await own.listChatMessages(s)).map((r) => clean(r)) : [],
    brief_snapshots: s ? (await own.listBriefSnapshots(s)).map((r) => clean(r)) : [],
    translations: s ? (await own.listTranslations(s)).map((r) => clean(r)) : [],
    safety_events: s ? (await own.listSafetyEvents(s)).map((r) => clean(r)) : [],
    reminder_deliveries: s ? (await own.listDeliveries(s)).map((r) => clean(r, ["id", "created_at"])) : [],
    family_links: linksAsPatient.map(hisSideOfLink),
    family_switches: grants.map((g) => ({ link_id: g.link_id ?? g.member, items: g.items, version: g.version ?? null, updated_at: g.updated_at })),
    family_switch_history: history.map((h) => ({ link_id: h.link_id, version: h.version, items: h.items, created_at: h.created_at })),
    family_access_log: s ? (await own.listCareAccessLog(s)).map((r) => ({ at: r.created_at, link_id: r.link_id, who: r.family_label, items: r.items, route: r.route })) : [],
    links_as_family: linksAsFamily.map(herSideOfLink),
    reminders_recorded: recorded.rows,
    consents: (await own.listConsentRecords(u)).map((r) => clean(r, ["id", "user_id"])),
    account_events: (await own.listAccountEvents(u)).map((r) => ({ kind: r.kind, detail: r.detail, created_at: r.created_at })),
    devices: (await own.listKnownDevices(u)).map((d) => ({ label: d.label, first_seen_at: d.first_seen_at, last_seen_at: d.last_seen_at })),
    sign_in_sessions: sessions
      .filter((x) => x.user_id === u)
      .map((x) => ({ device: x.device_label, not_my_phone: x.ephemeral, created_at: x.created_at, last_seen_at: x.last_seen_at, ended_at: x.ended_at, ended_reason: x.ended_reason })),
    push_subscriptions: (await own.listPushSubscriptions(u)).map((p) => ({ service: hostOf(p.endpoint), user_agent: p.user_agent, created_at: p.created_at, last_used_at: p.last_used_at })),
    service_reads: serviceReads.map((r) => ({ actor: r.actor, reason: r.reason, tables: r.tables, created_at: r.created_at })),
  };

  const expiresAt = new Date(clock.realNowMs + EXPORT_LINK_SECONDS * 1000).toISOString();
  const files = scope ? await signFiles(stores.blob, candidateFiles(scope, { visits, utterances, meds, clips }), who.origin, expiresAt) : [];
  const tz = tzOf(scope);
  const day = localDate(clock.nowMs, tz);
  const counts = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length]));
  const data: Record<string, unknown> = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    generated_at: new Date(clock.nowMs).toISOString(),
    links_expire_at: expiresAt,
    account: {
      login: who.login,
      login_kind: who.account.login_kind,
      display_name: who.account.display_name,
      locale: who.account.locale,
      created_at: who.account.created_at,
      last_seen_at: who.account.last_seen_at,
      recovery_code_set_at: recovery?.created_at ?? null,
    },
    space: scope
      ? {
          kind: scope.kind,
          d0: scope.d0,
          today: scope.d0 ? storyDate(scope.d0, scope.story_day) : null,
          tz: scope.tz,
          settings: scope.settings,
          onboarding: scope.onboarding,
          example_data: scope.example_data,
          filming: scope.filming,
          tracking_since: scope.tracking_since,
          created_at: scope.created_at,
        }
      : null,
    counts,
    tables,
    files,
    // her recordings in other people's storage that no registration points at any more (removed by the nightly sweep)
    reminder_recordings_unregistered: recorded.unregistered,
  };
  const rows = Object.values(counts).reduce((a, b) => a + b, 0);
  return { fileName: `ripple-export-${day}.json`, json: `${JSON.stringify(data, null, 2)}\n`, data, files: files.length, rows, linksExpireAt: expiresAt };
}

export type ExportResult = { ok: true; file: ExportFile; left: number } | { ok: false; status: 429; error: "export_limit"; until: string };

/** The limit, the document, the count and the account event. */
export async function runExport(stores: ExportStores, who: ExportWho, clock: ExportClock): Promise<ExportResult> {
  const allowance = await exportAllowance(stores.admin as Pick<Store, "getRateWindow">, who, clock);
  if (allowance.left <= 0) return { ok: false, status: 429, error: "export_limit", until: allowance.resetsAt };
  const file = await buildExport(stores, who, clock);
  await stores.admin.rateHit(exportBucket(who.userId, allowance.day, clock.env), 2 * 86_400, EXPORT_LIMIT_PER_DAY);
  await stores.own.addAccountEvent(who.userId, "export", { files: file.files, rows: file.rows });
  return { ok: true, file, left: allowance.left - 1 };
}
