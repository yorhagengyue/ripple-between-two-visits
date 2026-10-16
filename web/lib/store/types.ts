/**
 * Store interface for every table in docs/plan/spec.md section 3.
 *
 * Rules every implementation follows:
 * - Everything except eval_run is scoped by session_id. Row ids are unique within a session
 *   (seed ids such as "v1", "med-amlodipine", "q-extra-tablet" repeat across sessions).
 * - Every method is async, so the in-memory store and the later Supabase adapter share one shape.
 * - Rows handed out are copies. Mutating a returned row never changes the store.
 * - The store does not publish realtime events. Route handlers call lib/bus.ts after a write.
 * - The store holds the whole story timeline (D0 to D42). Pages filter by session.story_day
 *   (DayRange filters below) when they want "what has happened so far".
 * - JSON columns are typed `unknown` here and must be JSON-serialisable.
 *
 * Field names follow spec section 3 (snake_case). Fields marked "extension" are not in the spec
 * table but carry seed data that later modules need.
 */

export type IsoDateTime = string; // 2026-10-09T00:00:00.000Z
export type IsoDate = string; // 2026-09-22
export type ClockTime = string; // "07:40" (24h, story time)

/**
 * "mr-tan": the template timeline (lib/story/seed.ts). "blank": an account that started from nothing (C2: real
 * accounts); no template data is ever read for it (lib/store/scope.ts reads the scope row instead).
 */
export type TemplateId = "mr-tan" | "blank";

/**
 * What a session row is (C2 architecture review, real-app 3.2): a judge's sandbox, the crew's filming session (both
 * "demo": a join code and a stored story clock), or an account's own space (id = the user's id; "today" computed).
 */
export type ScopeKind = "sandbox" | "filming" | "account";
export type OnboardingState = "started" | "done";

/** One weekly or daily habit in his routine ("Tai chi", Tue and Thu, 07:00). */
export interface ScopeRoutineEntry {
  label: string;
  label_zh?: string;
  /** "daily" or weekday names "Mon".."Sun" */
  days: "daily" | string[];
  time: string;
}

/**
 * An account's own settings (session.settings, JSON). Every key optional; readers take the scope first and never the
 * template for an account (lib/store/scope.ts). Other tracks add keys here.
 */
export interface ScopeSettings {
  /** his Healthier SG clinic */
  clinic?: string | null;
  routine?: ScopeRoutineEntry[];
  /** first reminder time for the morning dose ("HH:MM"); default: breakfast + 15 min */
  reminder_time?: string | null;
  /** C2 track C: the first reminder he set himself for the later parts of the day ({ midday, evening, night }: "HH:MM") */
  reminder_times?: Partial<Record<"midday" | "evening" | "night", string>> | null;
  /** UI language */
  locale?: string | null;
  [key: string]: unknown;
}

export type MemberRole = "patient" | "family" | "backstage" | "director" | "judge";

/** spec: doctor / dispenser / patient / family / unknown. "pharmacist" added for the D12 pharmacy visit. */
export type UtteranceRole = "doctor" | "dispenser" | "pharmacist" | "patient" | "family" | "unknown";
export type RoleState = "confirmed" | "inferred" | "unknown";

export type VisitKind = "healthier_sg_check_in" | "follow_up" | "pharmacy" | (string & {});
/**
 * awaiting_transcript: an account's recording is saved and waits for the transcription service (never a replay);
 * planned: a visit that has not happened yet (the example account's follow-up today).
 */
export type VisitStatus = "recording" | "transcribing" | "review" | "confirmed" | "awaiting_transcript" | "planned";

export type VisitItemType =
  | "consent"
  | "reading"
  | "instruction"
  | "lifestyle"
  | "target"
  | "threshold"
  | "diagnosis"
  | "medication"
  | "purpose"
  | "follow_up"
  | "test"
  | "question"
  | "answer"
  /**
   * Ripple's summary of what was said at the visit (lib/visit/ripple-summary.ts; no migration: visit_item.type is plain
   * text): one row per visit, id "<visit>-ripple-summary", a fixed neutral text, no utterance ids, never confirmed; the
   * points are in slots.summary. Not the record and never a source: the view, the verdicts, the candidates and the
   * explain sheet all leave it out.
   */
  | "summary";

export type RequiredLineId = "R1" | "R2" | "R3" | "R4";
export type ConfirmedBy = "patient" | "label" | null;

export type MedOrigin = "prescription" | "self_bought" | "relative" | "supplement";
export type MedStatus =
  | "awaiting_label"
  | "label_confirmed"
  | "pharmacist_checked"
  | "unverified"
  | "unidentified";

export type DaySlot = "morning" | "midday" | "evening" | "night";
export type DoseState = "taken" | "missed" | "unconfirmed";
export type BpState = "recorded" | "unconfirmed";
export type NoteSource = "typed" | "voice_note";

export type QuestionFor = "doctor" | "pharmacist";
/** spec values plus "understanding_check" (M5: items ticked "not sure" go to the question list). */
export type QuestionOrigin =
  | "own"
  | "before_you_go"
  | "refused_question"
  | "pattern"
  | "unidentified_medicine"
  | "understanding_check"
  // C2 (spec 3; track C's lib/profile/questions.ts addQuestionFor): a prevention item, a watch pattern, his chat
  | "preventive"
  | "watch_pattern"
  | "chat"
  // owner 10-15 (no migration: the column is plain text): Ripple wrote it from a reading outside his doctor's target and
  // what he said happened that day (lib/daily/bp-reason.ts); the evidence names the reading and his note
  | "reading";
export type QuestionStatus = "open" | "answered" | "skipped";

// ---------------------------------------------------------------- rows

/**
 * A scope: a demo row (judge sandbox, crew filming session) or an account's own space (C2, migration 0004).
 * The store hands out every row with story_day / story_time filled: stored for a demo row, computed for an account
 * from d0 and the real time in tz (lib/time/clock.ts projectScope), so downstream code reads "the day" the same way.
 */
export interface SessionRow {
  id: string;
  /** 6 chars, upper case, no 0/O/1/I; null on an account (no joining by code) */
  join_code: string | null;
  template: TemplateId;
  story_day: number;
  /** extension: story clock time "HH:MM"; null = no time shown in the day label */
  story_time: ClockTime | null;
  filming_mode: boolean;
  created_at: IsoDateTime;
  expires_at: IsoDateTime | null; // null = never expires (filming session, account)
  // ---- scope columns (0004)
  kind: ScopeKind;
  /** the account's user id (= id); null on a demo row */
  owner_user_id: string | null;
  /** day 0 of an account; null on a demo row (the template's d0 applies) */
  d0: IsoDate | null;
  /** IANA zone the account's day is counted in */
  tz: string;
  settings: ScopeSettings;
  onboarding: OnboardingState | null;
  /** an account laid out with Mr Tan's example data */
  example_data: boolean;
  /** an account: windows that closed before this moment are not tracked (never settled as "no reply") */
  tracking_since: IsoDateTime | null;
  /** a filming account: added to now before the day is computed */
  clock_offset_ms: number | null;
  /** an account the crew marked as a filming account (its clock may be offset) */
  filming: boolean;
}

/** A demo row (judge sandbox, crew filming session) as createSession hands it out: it always has its join code. */
export type DemoSessionRow = SessionRow & { join_code: string; kind: "sandbox" | "filming" };

export interface SessionMemberRow {
  id: string;
  session_id: string;
  role: MemberRole;
  device_label: string | null;
  created_at: IsoDateTime;
}

export interface VisitRow {
  id: string;
  session_id: string;
  kind: VisitKind;
  place: string;
  day: number;
  date: IsoDate;
  consent_utterance_id: string | null;
  status: VisitStatus;
  audio_path: string | null;
  /** extension: section of docs/plan/visits-script.md (D0, D8, D12, D42) */
  script_section: string | null;
  /** extension: name of the replay audio used by SPEECH_PROVIDER=mock */
  audio_fixture: string | null;
  created_at: IsoDateTime;
  // ---- C2 (0004), present only once set: the recording's retention (journey 15)
  /** the recording and its clips are deleted after this date */
  retain_until?: IsoDate | null;
  /** he chose to keep this visit's recording */
  keep_forever?: boolean | null;
  /** when the recording was deleted (the transcript and items stay) */
  audio_deleted_at?: IsoDateTime | null;
  // ---- C2 track F, round three (0016_f_visit_made), present only once set
  /**
   * How this visit's record was made: true, the labelling model and the translation were allowed (his consent to AI
   * processing was on at that moment); false, by the fixed rules only and nothing was translated. Written when the
   * whole-visit record is made (lib/visit/pipeline.ts finalizeVisit); unset on visits made before, and on seed rows.
   */
  ai_used?: boolean | null;
  // ---- C2 track R (0017_r_visit_audio_parts), present only once set
  /**
   * A long recording's files in order (lib/visit/parts.ts: a visit longer than one part is uploaded as consecutive
   * parts). Unset for a recording in one file: audio_path alone, as before. While parts are still arriving audio_path
   * stays null; once the last one is registered it is the first part's path. Read through lib/visit/recording.ts.
   */
  audio_parts?: VisitAudioPart[] | null;
}

/** One file of a long visit recording (visit.audio_parts). */
export interface VisitAudioPart {
  /** the file in the audio bucket, under the scope's prefix: <prefix>/visits/<visit id>/recording-<random>.wav */
  path: string;
  /** the length of its audio in milliseconds, as the server measured it from the file */
  ms: number;
}

export interface UtteranceRow {
  id: string;
  session_id: string;
  visit_id: string;
  t_start_ms: number;
  t_end_ms: number;
  speaker_cluster: number | null;
  role: UtteranceRole;
  role_state: RoleState;
  text: string;
  lang: string | null;
  clip_path: string | null;
  scripted_fallback: boolean;
  created_at: IsoDateTime;
}

export interface VisitItemRow {
  id: string;
  session_id: string;
  visit_id: string;
  type: VisitItemType;
  text: string;
  utterance_ids: string[];
  slots: Record<string, unknown>;
  confirmed_by: ConfirmedBy;
  required_line: RequiredLineId | null;
  /** extension: who said it, when known without utterances (the seeded R1–R4 are "doctor") */
  speaker: UtteranceRole | null;
  created_at: IsoDateTime;
}

export interface MedLabel {
  text: string;
  drug?: string | null;
  strength?: string | null;
  directions?: string | null;
  dispensed?: IsoDate | null;
  clinic?: string | null;
  /** replay photo under web/fixtures (labels/amlodipine.png) */
  photo_fixture?: string | null;
  /** Storage path once a real photo is uploaded */
  photo_path?: string | null;
}

export interface MedicationRow {
  id: string;
  session_id: string;
  drug_id: string | null; // kb/drugs.json id, or null when not identified
  origin: MedOrigin;
  label: MedLabel | null;
  status: MedStatus;
  start_day: number | null;
  /** extension: visit where it was prescribed */
  prescribed_visit_id: string | null;
  /** extension: free note from the seed ("bought for knee pain") */
  note: string | null;
  /** extension: the pharmacist's recorded answer about this medicine (D12) */
  pharmacist_answer: { visit_id: string; text: string } | null;
  created_at: IsoDateTime;
  // ---- C2 (0004), present only once set
  /** the slots he takes it in, read from the label or chosen by him (the demo has one morning slot) */
  dose_slots?: DaySlot[] | null;
  dose_slots_source?: "label" | "patient" | null;
  /**
   * when the medicine was confirmed on his list: a reminder window that closed before this is never settled as his
   * missed dose (lib/daily/doses.ts settleNoReply). Accounts without it fall back to the row's created_at.
   */
  start_at?: IsoDateTime | null;
}

export interface DoseLogRow {
  id: string;
  session_id: string;
  medication_id: string;
  day: number;
  slot: DaySlot;
  state: DoseState;
  reason: string | null; // option code, e.g. "tai_chi_morning"
  /** extension: the reason in his words (seed reason_text_zh) */
  reason_text: string | null;
  /**
   * C2 track B (0018_b_dose_pre_tracking; real-app 4.4), accounts only, present only once set (lib/store/rows.ts): what
   * this row is to a cell whose window closed before tracking began (lib/daily/tracking.ts answerCounts).
   *   true    part of his record from before tracking began: laid out with the space (the example's history, a filming
   *           account's scene), or his correction of an answer that already counted there. It counts.
   *   false   an answer written on an account, and not such a row.
   *   absent  a demo row, or a row from before the column existed.
   * An existing row keeps its value through logDose's upsert, as it keeps its id and created_at.
   */
  pre_tracking?: boolean | null;
  created_at: IsoDateTime;
}

export interface BpReadingRow {
  id: string;
  session_id: string;
  day: number;
  slot: DaySlot;
  systolic: number | null; // null when state = unconfirmed
  diastolic: number | null;
  state: BpState;
  /** extension: seed note ("hero moment") */
  note: string | null;
  created_at: IsoDateTime;
  // ---- C2 track B (0011_b_daily), present only once set
  /** the pulse he read off the monitor (the keypad's optional third row); never compared with anything */
  pulse?: number | null;
  // ---- C2 track B, second round (0016_b_bp_changes), present only once set
  /** the changes he made to this reading, oldest first (each with the values before it); unset until the first */
  history?: BpChange[] | null;
  /** when he deleted it: the row stays as the record, and listBp leaves it out unless asked */
  deleted_at?: IsoDateTime | null;
}

/** One change to a reading (0016_b_bp_changes): what he did, when, and the reading's values before it. */
export interface BpChange {
  at: IsoDateTime;
  action: "edit" | "delete" | "restore";
  systolic: number | null;
  diastolic: number | null;
  pulse: number | null;
  state: BpState;
}

export interface NoteRow {
  id: string;
  session_id: string;
  day: number;
  text: string;
  source: NoteSource;
  /** extension */
  lang: string | null;
  /** extension: what the app replied (seed: "logged; asked whether today's tablet was taken") */
  app_reply: string | null;
  created_at: IsoDateTime;
}

export interface QuestionRow {
  id: string;
  session_id: string;
  for: QuestionFor;
  origin: QuestionOrigin;
  text: string;
  /** extension */
  lang: string | null;
  status: QuestionStatus;
  answer_text: string | null;
  answer_utterance_id: string | null;
  /** extension: visit where the answer was given */
  answer_visit_id: string | null;
  /** extension: who answered */
  answer_speaker: UtteranceRole | null;
  /** extension: visit where it was asked */
  asked_at_visit_id: string | null;
  created_day: number | null;
  /** extension: why Ripple raised it (pattern questions) */
  evidence: string | null;
  created_at: IsoDateTime;
  /** C2 (0004), present only once set: a family member who asked it */
  asked_by_user_id?: string | null;
  // ---- C2 track C (0010_c_questions), present only once set: what he did to his own list
  /** he changed the words himself (the list shows them as his own words) */
  edited_at?: IsoDateTime | null;
  /** a duplicate he folded into this question id (status skipped; never shown or counted on its own) */
  merged_into?: string | null;
}

export interface FamilyGrantItems {
  dose_summary: boolean;
  bp_summary: boolean;
  questions_count: boolean;
  no_reply_alert: boolean;
  visit_transcripts: boolean;
  notes: boolean;
}

export interface FamilyGrantRow {
  session_id: string;
  member: string; // "wei-ling" in the demo; the care link's id on an account
  items: FamilyGrantItems;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
  // ---- C2 (0005), present only on an account's grant: the care link it belongs to and how many times it changed
  link_id?: string | null;
  version?: number;
}

export interface ReminderClipRow {
  id: string;
  session_id: string;
  by: string; // family member id, "wei-ling"
  audio_path: string | null;
  plays_at: string; // "after_breakfast" or "HH:MM"
  /** extension: transcript of the clip */
  text: string | null;
  /** extension */
  lang: string | null;
  created_at: IsoDateTime;
  // ---- C2 (0004), present only once set: who recorded it (cleared when her account goes), her label, which link
  by_user_id?: string | null;
  by_label?: string | null;
  link_id?: string | null;
}

export interface SafetyEventRow {
  id: string;
  session_id: string;
  input: string;
  lang: string | null;
  route: string; // lib/safety Route
  candidates: unknown;
  layer1: unknown;
  layer2: unknown;
  layer3: unknown;
  output: unknown;
  blocked: unknown;
  latency_ms: number | null;
  created_at: IsoDateTime;
}

export interface EvalRunRow {
  id: string;
  git_sha: string | null;
  results: unknown;
  created_at: IsoDateTime;
}

// ---------------------------------------------------------------- C2: accounts (0005)

export type LoginKind = "email" | "username";

/** The app's own account row (the identity itself lives in Supabase Auth, or lib/auth/memory.ts offline). */
export interface AccountRow {
  user_id: string;
  login_kind: LoginKind;
  /** the username he signs in with (no e-mail address); null for an e-mail account */
  username: string | null;
  display_name: string | null;
  locale: string | null;
  last_seen_at: IsoDateTime | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

/** His one recovery code, as a salted hash only (lib/auth). */
export interface RecoveryCodeRow {
  user_id: string;
  code_hash: string;
  created_at: IsoDateTime;
}

/** A phone he has used (the rp_device cookie's hash). */
export interface KnownDeviceRow {
  user_id: string;
  device_hash: string;
  label: string | null;
  first_seen_at: IsoDateTime;
  last_seen_at: IsoDateTime;
}

/** A family-assisted password reset in progress (off by default; real-app 3.6). */
export interface ResetRequestRow {
  id: string;
  user_id: string;
  device_hash: string;
  link_id: string | null;
  code_hash: string | null;
  expires_at: IsoDateTime;
  used_at: IsoDateTime | null;
  created_at: IsoDateTime;
}

/** Something that happened to the account (password_reset, recovery_code, export, ...). Never patient content. */
export interface AccountEventRow {
  id: string;
  user_id: string;
  kind: string;
  detail: Record<string, unknown>;
  created_at: IsoDateTime;
}

// ---------------------------------------------------------------- C2: family links (0005)

export type CareLinkStatus = "invited" | "accepted" | "active" | "declined" | "expired" | "revoked";

/**
 * Him (patient_id) and her (family_id, null until she accepts). invite_token_hash is the sha256 of the invitation
 * token: server-only, never in a response.
 */
export interface CareLinkRow {
  id: string;
  patient_id: string;
  family_id: string | null;
  relation: string | null;
  family_label: string | null;
  patient_label: string | null;
  status: CareLinkStatus;
  invite_token_hash: string | null;
  invite_expires_at: IsoDateTime | null;
  accepted_at: IsoDateTime | null;
  confirmed_at: IsoDateTime | null;
  revoked_at: IsoDateTime | null;
  revoked_by: "patient" | "family" | null;
  reset_helper: boolean;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

export type CareLinkErrorCode =
  | "invite_not_found"
  | "invite_used"
  | "invite_expired"
  | "invite_self"
  | "link_exists"
  | "link_not_found"
  | "link_not_accepted"
  | "link_closed";

/** A link's state change: done, or why not (the same codes from both stores). */
export type CareLinkResult = { ok: true; link: CareLinkRow } | { ok: false; code: CareLinkErrorCode };

/** One version of a link's switches (append-only). */
export interface GrantHistoryRow {
  link_id: string;
  session_id: string;
  version: number;
  items: FamilyGrantItems;
  created_at: IsoDateTime;
}

/** One read or write she made through a link (append-only; he can see these). */
export interface CareAccessLogRow {
  id: string;
  session_id: string;
  link_id: string | null;
  family_user_id: string | null;
  family_label: string | null;
  route: string;
  /** the sections read or written (grant keys, "reminder", "profile_fact") */
  items: string[];
  created_at: IsoDateTime;
}

/** The server reading health data with its own key outside a person's request: who, why, whose (append-only). */
export interface ServiceReadLogRow {
  id: string;
  actor: string;
  reason: string;
  session_id: string | null;
  tables: string[];
  created_at: IsoDateTime;
}

// ---------------------------------------------------------------- C2: consent (0005)

export type ConsentKind =
  | "terms_privacy"
  | "ai_processing"
  | "visit_recording"
  | "family_share"
  | "family_accept"
  | "family_reset_helper"
  | "retention_keep_forever"
  | "example_data";
export type ConsentDecision = "granted" | "declined" | "withdrawn";

/** A consent text as published (insert only; a changed text is a new version). */
export interface ConsentTextRow {
  kind: ConsentKind;
  version: string;
  locale: string;
  sha256: string;
  text: string;
  published_at: IsoDateTime;
}

/** One consent decision (append-only). */
export interface ConsentRecordRow {
  id: string;
  user_id: string;
  scope_id: string | null;
  kind: ConsentKind;
  decision: ConsentDecision;
  version: string | null;
  text_sha256: string | null;
  /** how it was given ("signup_screen", "visit_screen", ...) */
  method: string | null;
  evidence: unknown;
  /** someone helped him on his phone */
  assisted: boolean;
  created_at: IsoDateTime;
}

// ---------------------------------------------------------------- C2: push, deliveries, limits, jobs (0006)

export interface PushSubscriptionRow {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string | null;
  created_at: IsoDateTime;
  last_used_at: IsoDateTime | null;
  /**
   * C2 track D (0015_d_push_device.sql): the device this phone subscribed on, as the sha256 of its rp_device cookie
   * (lib/auth/device.ts deviceHash, the hash known_device and account_session hold). Signing that device out removes
   * the row. Absent or null: made before the column existed, or by a browser without the cookie.
   */
  device_hash?: string | null;
}

/** One reminder or alert sent (unique per scope, kind, ref, day, slot: never sent twice). */
export interface ReminderDeliveryRow {
  id: string;
  session_id: string;
  /** dose_first, dose_second, family_no_reply, bp_due, ... */
  kind: string;
  /** what it is about: a medicine id, a link id */
  ref: string;
  day: number;
  slot: string;
  sent_at: IsoDateTime;
  opened_at: IsoDateTime | null;
  created_at: IsoDateTime;
}

export interface RateHit {
  /** hits in the current window, this one included */
  count: number;
  allowed: boolean;
  reset_at: IsoDateTime;
}

/** A rate-limit bucket's live window, read without counting (track A: the sign-in lockout). */
export interface RateWindow {
  /** hits so far in this window */
  count: number;
  reset_at: IsoDateTime;
}

/** What a scheduled job did, in counts only. */
export interface OpsRunRow {
  id: string;
  job: string;
  counts: Record<string, number>;
  started_at: IsoDateTime;
  finished_at: IsoDateTime | null;
  created_at: IsoDateTime;
}

// ---------------------------------------------------------------- C2: the new modules (0001 + 0007)

export type ProfileFactSource = "patient" | "family" | "visit" | (string & {});

/** One fact in his profile (M11): a condition, an allergy, his clinic, ... */
export interface ProfileFactRow {
  id: string;
  session_id: string;
  kind: string;
  text: string;
  source: ProfileFactSource;
  /** who typed it (free label: "patient", "Wei Ling") */
  entered_by: string | null;
  /** "patient" once he confirmed it; null while it waits (a family proposal) */
  confirmed_by: string | null;
  visit_item_id: string | null;
  created_day: number | null;
  data: unknown;
  /** he said it is not right: kept, not shown */
  hidden: boolean | null;
  entered_by_user_id: string | null;
  link_id: string | null;
  confirmed_at: IsoDateTime | null;
  updated_at: IsoDateTime | null;
  created_at: IsoDateTime;
}

/** A prevention item he marked done (M10). */
export interface PreventDoneRow {
  id: string;
  session_id: string;
  item_id: string;
  day: number;
  source: string | null;
  visit_item_id: string | null;
  note: string | null;
  created_at: IsoDateTime;
}

/** One watch reading (M12): described, never judged. */
export interface WatchMetricRow {
  id: string;
  session_id: string;
  day: number;
  metric: string;
  value: number | null;
  unit: string | null;
  measured_at: IsoDateTime | null;
  source: string | null;
  created_at: IsoDateTime;
}

/** His answer to one item of the daily diet check (M13); one per item per day. */
export interface DietCheckRow {
  id: string;
  session_id: string;
  day: number;
  item: string;
  answer: string;
  source_ref: string | null;
  note: string | null;
  created_at: IsoDateTime;
}

/** One turn of his conversation with Ripple, kept per day (journey 04). */
export interface ChatMessageRow {
  id: string;
  session_id: string;
  day: number;
  role: "patient" | "ripple";
  text: string;
  lang: string | null;
  safety_event_id: string | null;
  /** Ripple's structured answer (lib/safety AskResult) */
  answer: unknown;
  created_at: IsoDateTime;
}

/** The brief as it was shown (journey 14). */
export interface BriefSnapshotRow {
  id: string;
  session_id: string;
  locale: string | null;
  data: unknown;
  shown_at: IsoDateTime | null;
  created_at: IsoDateTime;
}

// ---------------------------------------------------------------- C2 track F: the understanding checklist (0013_f_understanding)

/** One item of a medicine's understanding checklist (lib/explain/understanding.ts). */
export type UnderstandingItemId = "purpose" | "feel_fine" | "when" | "missed";
export type UnderstandingAnswerValue = "know" | "unsure";

/**
 * His answer to one item of a medicine's understanding checklist (journey 06: 「知道」 is kept, real-app 6.10,
 * e2e-chains 序 21): one row per medicine and item, the latest answer. Nobody scores him; 「不确定」 also has its
 * question on his list. The rows go with the medicine (a demo reset or an account's reseed re-creates the medicines,
 * and their answers go with the old ones: the migration's foreign key cascades, the memory store clears them).
 */
export interface UnderstandingAnswerRow {
  id: string;
  session_id: string;
  medication_id: string;
  item: UnderstandingItemId;
  answer: UnderstandingAnswerValue;
  /** the story day he answered (an account's today) */
  day: number | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime;
}

// ---------------------------------------------------------------- C2 track S: translations (0009_s_translations)

/** A doctor's English line in Chinese (en>zh-Hans), or his own Chinese words in English for the brief (zh-Hans>en). */
export type TranslationDirection = "en>zh-Hans" | "zh-Hans>en";
/** checked: passed both checks (lib/translate); rejected: a check said no, so the original words are shown alone */
export type TranslationStatus = "checked" | "rejected";

/**
 * One text translated once and checked twice (lib/translate): the same facts on both sides (numbers, medicine names,
 * dose units, frequencies, times; a negation kept), then the checker model said the meaning is unchanged. Kept per
 * scope, one row per (direction, source text), so a line is never translated again on the next look.
 */
export interface TranslationRow {
  id: string;
  session_id: string;
  direction: TranslationDirection;
  /** sha256 (hex) of the source text as lib/translate keys it (trimmed, NFC) */
  source_sha256: string;
  source_text: string;
  /** the translation; null when a check rejected it */
  text: string | null;
  status: TranslationStatus;
  /** what each check found, as codes (never a model's words): { facts: { pass, ... }, meaning: { pass, checker } } */
  checks: unknown;
  created_at: IsoDateTime;
}

// ---------------------------------------------------------------- inputs

/** Insert shape: the listed keys are required; id and every other column are optional. */
export type Insert<Row, Required extends keyof Row> = Pick<Row, Required> &
  Partial<Omit<Row, Required | "session_id" | "created_at">>;

/** Patch shape: any column except the keys. */
export type Patch<Row> = Partial<Omit<Row, "id" | "session_id" | "created_at">>;

export type NewMember = Insert<SessionMemberRow, "role">;
export type NewVisit = Insert<VisitRow, "kind" | "place" | "day">; // date defaults to d0 + day
export type NewUtterance = Insert<UtteranceRow, "t_start_ms" | "t_end_ms" | "text">;
export type NewVisitItem = Insert<VisitItemRow, "type" | "text">;
export type NewMedication = Insert<MedicationRow, "origin" | "status">;
export type NewDoseLog = Insert<DoseLogRow, "medication_id" | "day" | "slot" | "state"> & TappedAt;
export type NewBpReading = Insert<BpReadingRow, "day" | "slot"> & TappedAt; // state defaults to recorded
/**
 * C2 track O (real-app 2.25, an answer kept on the phone while there was no network): the moment he tapped, as the
 * fresh row's created_at. Left out, the row is stamped with the scope's now, as always. A dose row that already exists
 * keeps its own created_at (logDose's upsert), so this only ever dates a new row.
 */
export interface TappedAt {
  created_at?: IsoDateTime;
}
export type NewNote = Insert<NoteRow, "day" | "text" | "source">;
export type NewQuestion = Insert<QuestionRow, "for" | "origin" | "text">;
export type NewReminderClip = Insert<ReminderClipRow, "by" | "plays_at">;
export type NewSafetyEvent = Insert<SafetyEventRow, "input" | "route">;
export type NewEvalRun = Omit<EvalRunRow, "id" | "created_at"> & { id?: string };

export interface CreateSessionOptions {
  template?: TemplateId; // default "mr-tan"
  story_day?: number; // default meta.judge_landing_day (29)
  story_time?: ClockTime | null; // default null
  filming_mode?: boolean; // default false
  /** hours until expiry; omit or null = never expires */
  ttl_hours?: number | null;
  /** a demo row only: default "sandbox" when it expires, "filming" when it does not */
  kind?: "sandbox" | "filming";
}

/** Rows to lay out in a new or reseeded scope (lib/story/seed.ts SeedTables has this shape). */
export interface ScopeTables {
  visits?: VisitRow[];
  visit_items?: VisitItemRow[];
  medications?: MedicationRow[];
  dose_logs?: DoseLogRow[];
  bp_readings?: BpReadingRow[];
  notes?: NoteRow[];
  questions?: QuestionRow[];
  family_grants?: FamilyGrantRow[];
  reminder_clips?: ReminderClipRow[];
  // C2 track C (0014_c_example_seed): the example account's past visits' transcripts and its profile facts are laid
  // out in the same step as the rest (real-app 4.1: one transaction), never as writes after it
  utterances?: UtteranceRow[];
  profile_facts?: ProfileFactRow[];
}

/** An account's new space (createAccountScope). Its id is the user's id. */
export interface NewAccountScope {
  user_id: string;
  d0: IsoDate;
  /** default "blank" (no template data); "mr-tan" for the example account */
  template?: TemplateId;
  /** default Asia/Singapore */
  tz?: string;
  settings?: ScopeSettings;
  onboarding?: OnboardingState | null;
  example_data?: boolean;
  /** default: now (nothing before the account existed is tracked) */
  tracking_since?: IsoDateTime | null;
  /** rows to lay out (the example data); default none */
  tables?: ScopeTables;
}

/** What may change on an account's scope row. settings is merged key by key (a key set to null is kept as null). */
export interface ScopePatch {
  settings?: ScopeSettings;
  onboarding?: OnboardingState | null;
  tz?: string;
  example_data?: boolean;
  tracking_since?: IsoDateTime | null;
}

/** An account's reseed: the scope columns to set (settings replaced whole) and the new rows. */
export interface ReseedAccount {
  template?: TemplateId;
  d0?: IsoDate;
  settings?: ScopeSettings;
  onboarding?: OnboardingState | null;
  example_data?: boolean;
  tracking_since?: IsoDateTime | null;
  tables?: ScopeTables;
}

export interface NewAccount {
  user_id: string;
  login_kind: LoginKind;
  username?: string | null;
  display_name?: string | null;
  locale?: string | null;
}

export type AccountPatch = Partial<Pick<AccountRow, "display_name" | "locale" | "last_seen_at" | "username">>;

export interface NewResetRequest {
  id?: string;
  user_id: string;
  device_hash: string;
  link_id?: string | null;
  code_hash?: string | null;
  expires_at: IsoDateTime;
}

export interface NewCareInvite {
  id?: string;
  patient_id: string;
  relation?: string | null;
  family_label?: string | null;
  patient_label?: string | null;
  invite_token_hash: string;
  invite_expires_at: IsoDateTime;
}

export interface CareLinkFilter {
  patient_id?: string;
  family_id?: string;
  status?: CareLinkStatus[];
}

export type NewCareAccessLog = Omit<CareAccessLogRow, "id" | "session_id" | "created_at"> & { id?: string };
export type NewServiceReadLog = { actor: string; reason: string; session_id?: string | null; tables?: string[] };
export type NewConsentText = Omit<ConsentTextRow, "published_at"> & { published_at?: IsoDateTime };
export type NewConsentRecord = Pick<ConsentRecordRow, "user_id" | "kind" | "decision"> &
  Partial<Omit<ConsentRecordRow, "id" | "user_id" | "kind" | "decision" | "created_at">> & { id?: string };
export type NewPushSubscription = Pick<PushSubscriptionRow, "user_id" | "endpoint" | "p256dh" | "auth"> & { user_agent?: string | null; device_hash?: string | null };
export interface DeliveryKey {
  kind: string;
  ref: string;
  day: number;
  slot: string;
}
export type NewOpsRun = Pick<OpsRunRow, "job" | "counts" | "started_at"> & { finished_at?: IsoDateTime | null; id?: string };

export type NewProfileFact = Insert<ProfileFactRow, "kind" | "text" | "source">;
export type NewPreventDone = Insert<PreventDoneRow, "item_id" | "day">;
export type NewWatchMetric = Insert<WatchMetricRow, "day" | "metric">;
export type NewDietCheck = Insert<DietCheckRow, "day" | "item" | "answer">;
export type NewChatMessage = Insert<ChatMessageRow, "day" | "role" | "text">;
export type NewBriefSnapshot = Insert<BriefSnapshotRow, "data">;
/** C2 track S */
export type NewTranslation = Insert<TranslationRow, "direction" | "source_sha256" | "source_text" | "status">;
/** C2 track F */
export type NewUnderstandingAnswer = Pick<UnderstandingAnswerRow, "medication_id" | "item" | "answer"> & { day?: number | null; id?: string };

export interface ProfileFactFilter {
  /** default: hidden facts included */
  hidden?: boolean;
  source?: ProfileFactSource;
  /** true: only confirmed facts (confirmed_by set) */
  confirmed?: boolean;
}

export interface WatchFilter extends DayRange {
  metric?: string;
}

export interface ChatFilter extends DayRange {
  /** the newest N (kept oldest first) */
  limit?: number;
}

/** Inclusive day range. */
export interface DayRange {
  fromDay?: number;
  toDay?: number;
}

/** C2 track B (0016_b_bp_changes): readings he deleted stay as rows; a list leaves them out unless this asks for them. */
export interface BpFilter extends DayRange {
  includeDeleted?: boolean;
}

export interface VisitItemFilter {
  visit_id?: string;
  type?: VisitItemType;
  /** true = only R1–R4 rows */
  required_only?: boolean;
}

export interface DoseFilter extends DayRange {
  medication_id?: string;
}

export interface QuestionFilter {
  status?: QuestionStatus;
  for?: QuestionFor;
  origin?: QuestionOrigin;
}

// ---------------------------------------------------------------- errors

/**
 * account_scope: an operation that only exists for demo rows (the story clock, a reset, a joining device) was asked of
 * an account, or one that only exists for accounts of a demo row; conflict: a unique key is taken (a username).
 */
export type StoreErrorCode = "session_not_found" | "not_found" | "invalid" | "not_configured" | "account_scope" | "conflict";

export class StoreError extends Error {
  readonly code: StoreErrorCode;
  constructor(code: StoreErrorCode, message?: string) {
    super(message ?? code);
    this.name = "StoreError";
    this.code = code;
  }

  /**
   * Production builds put this module into many chunks and stores live on globalThis, so an error thrown by a store can
   * come from another copy of this class: `instanceof` recognises any error with this name and a string code.
   */
  static [Symbol.hasInstance](value: unknown): boolean {
    return isStoreError(value);
  }
}

/** A StoreError from any copy of this module (see StoreError[Symbol.hasInstance]); `code` narrows to one code. */
export function isStoreError(err: unknown, code?: StoreErrorCode): err is StoreError {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { name?: unknown; code?: unknown };
  return e.name === "StoreError" && typeof e.code === "string" && (code === undefined || e.code === code);
}

// ---------------------------------------------------------------- interface

export interface Store {
  readonly kind: "memory" | "supabase";

  // sessions (demo rows) and scopes (every row). Every SessionRow handed out has story_day / story_time filled:
  // stored for a demo row, computed for an account (lib/time/clock.ts projectScope).
  /** New demo session (sandbox or filming) seeded from the template timeline (deep copy). Returns id and join_code. */
  createSession(opts?: CreateSessionOptions): Promise<DemoSessionRow>;
  getSession(sessionId: string): Promise<SessionRow | null>;
  /** Case-insensitive. Expired sessions are not returned. */
  getSessionByJoinCode(joinCode: string): Promise<SessionRow | null>;
  listSessions(): Promise<SessionRow[]>;
  /** Story clock. time "HH:MM" or null; omitted = keep current time. Demo rows only (account_scope otherwise). */
  setStoryDay(sessionId: string, day: number, time?: ClockTime | null): Promise<SessionRow>;
  /** The demo's filming mode (phones hide the jump menu). Demo rows only (account_scope otherwise). */
  setFilmingMode(sessionId: string, on: boolean): Promise<SessionRow>;
  /** Restore every table to the template seed. Keeps id, join_code, members, filming_mode;
   *  story_day/story_time go back to the template defaults. Safety events are cleared. Demo rows only. */
  resetSession(sessionId: string): Promise<SessionRow>;
  deleteSession(sessionId: string): Promise<void>;
  /** Delete judge sandboxes that have expired (never a filming session, never an account). Returns how many. */
  deleteExpiredSandboxes(): Promise<number>;

  // account scopes (C2)
  /** An account's space: id = user_id, kind account, the given rows laid out in the same step. */
  createAccountScope(scope: NewAccountScope): Promise<SessionRow>;
  /** Every account scope (the scheduled jobs walk them). */
  listAccountScopes(): Promise<SessionRow[]>;
  /** Settings, onboarding, time zone, example flag, tracking start. Accounts only. */
  updateScope(scopeId: string, patch: ScopePatch): Promise<SessionRow>;
  /** Mark or unmark a filming account (crew only, track J). Unmarking clears the offset. Accounts only. */
  setFilmingAccount(scopeId: string, on: boolean): Promise<SessionRow>;
  /**
   * A filming account's clock offset (null clears it). Moves tracking_since to the new "now" of the scope, so the
   * skipped days are never settled as "no reply" (real-app 5.4). Filming accounts only (account_scope otherwise).
   */
  setClockOffset(scopeId: string, offsetMs: number | null): Promise<SessionRow>;
  /** Replace every record of an account's space (not its family links and their switches) and set its columns. */
  reseedAccount(scopeId: string, reseed: ReseedAccount): Promise<SessionRow>;

  // session_member (demo rows only: an account has no joining devices)
  addMember(sessionId: string, member: NewMember): Promise<SessionMemberRow>;
  listMembers(sessionId: string): Promise<SessionMemberRow[]>;

  // visit
  /** Sorted by day. */
  listVisits(sessionId: string): Promise<VisitRow[]>;
  getVisit(sessionId: string, visitId: string): Promise<VisitRow | null>;
  /** Insert, or merge into the existing row when id matches. */
  upsertVisit(sessionId: string, visit: NewVisit): Promise<VisitRow>;
  /** Patch an existing visit (status walk recording -> transcribing -> review -> confirmed, audio_path, consent). */
  updateVisit(sessionId: string, visitId: string, patch: Patch<VisitRow>): Promise<VisitRow>;
  /**
   * C2 track F, round three: remove one visit row. Used only to take back a planned follow-up when he changes, in the
   * visit's review, his answer that the doctor said to come back (lib/visit/pipeline.ts: still planned, never the day
   * he booked himself). Its lines and items go with it (a planned visit has none). not_found when there is no such row.
   */
  deleteVisit(sessionId: string, visitId: string): Promise<void>;

  // utterance
  addUtterances(sessionId: string, visitId: string, rows: NewUtterance[]): Promise<UtteranceRow[]>;
  /** Sorted by t_start_ms. */
  listUtterances(sessionId: string, visitId: string): Promise<UtteranceRow[]>;
  updateUtterance(sessionId: string, utteranceId: string, patch: Patch<UtteranceRow>): Promise<UtteranceRow>;

  // visit_item
  addVisitItems(sessionId: string, visitId: string, items: NewVisitItem[]): Promise<VisitItemRow[]>;
  listVisitItems(sessionId: string, filter?: VisitItemFilter): Promise<VisitItemRow[]>;
  updateVisitItem(sessionId: string, itemId: string, patch: Patch<VisitItemRow>): Promise<VisitItemRow>;

  // medication
  listMeds(sessionId: string): Promise<MedicationRow[]>;
  getMed(sessionId: string, medId: string): Promise<MedicationRow | null>;
  /** Insert, or merge into the existing row when id matches. */
  upsertMed(sessionId: string, med: NewMedication): Promise<MedicationRow>;
  /** Patch an existing medication (awaiting_label -> label_confirmed, drug_id, label). */
  updateMed(sessionId: string, medId: string, patch: Patch<MedicationRow>): Promise<MedicationRow>;
  /**
   * C2 track F, round three: take one medicine off his list. Used only to take back a prescription that still waits
   * for its label when he changes, in the visit's review, his answer that the doctor prescribed it
   * (lib/visit/pipeline.ts checks that nothing of his hangs on it: no label, never started). Its understanding
   * answers go with it. not_found when there is no such row.
   */
  deleteMed(sessionId: string, medId: string): Promise<void>;

  // dose_log
  /** Upsert on (medication_id, day, slot): a later "taken" replaces an earlier "unconfirmed". */
  logDose(sessionId: string, dose: NewDoseLog): Promise<DoseLogRow>;
  /** Sorted by day, then slot (morning, midday, evening, night). */
  listDoses(sessionId: string, filter?: DoseFilter): Promise<DoseLogRow[]>;

  // bp_reading
  /** Appends. state defaults to "recorded". */
  addBp(sessionId: string, reading: NewBpReading): Promise<BpReadingRow>;
  /** Sorted by day, then slot, then insertion. A reading he deleted (deleted_at set) is left out unless filter.includeDeleted. */
  listBp(sessionId: string, filter?: BpFilter): Promise<BpReadingRow[]>;

  // note
  addNote(sessionId: string, note: NewNote): Promise<NoteRow>;
  /** Sorted by day, then insertion. */
  listNotes(sessionId: string, filter?: DayRange): Promise<NoteRow[]>;

  // question
  /** Insertion order (seed order first). */
  listQuestions(sessionId: string, filter?: QuestionFilter): Promise<QuestionRow[]>;
  getQuestion(sessionId: string, questionId: string): Promise<QuestionRow | null>;
  /** status defaults to "open". */
  addQuestion(sessionId: string, question: NewQuestion): Promise<QuestionRow>;
  updateQuestion(sessionId: string, questionId: string, patch: Patch<QuestionRow>): Promise<QuestionRow>;

  // family_grant
  /** member defaults to "wei-ling". */
  getFamilyGrant(sessionId: string, member?: string): Promise<FamilyGrantRow | null>;
  /** Merges the given switches into the member's grant (creates it, all off, if missing). */
  setFamilyGrant(sessionId: string, member: string, items: Partial<FamilyGrantItems>): Promise<FamilyGrantRow>;

  // reminder_clip
  addReminderClip(sessionId: string, clip: NewReminderClip): Promise<ReminderClipRow>;
  listReminderClips(sessionId: string): Promise<ReminderClipRow[]>;

  // safety_event
  addSafetyEvent(sessionId: string, event: NewSafetyEvent): Promise<SafetyEventRow>;
  /** Oldest first; limit keeps the newest N. */
  listSafetyEvents(sessionId: string, opts?: { limit?: number }): Promise<SafetyEventRow[]>;

  // eval_run (not session-scoped)
  addEvalRun(run: NewEvalRun): Promise<EvalRunRow>;
  getLatestEvalRun(): Promise<EvalRunRow | null>;

  // ---------------------------------------------------------------- C2 additions

  // blood pressure and reminder clips: corrections (journeys 03, 18)
  updateBp(sessionId: string, readingId: string, patch: Patch<BpReadingRow>): Promise<BpReadingRow>;
  deleteBp(sessionId: string, readingId: string): Promise<void>;
  deleteReminderClip(sessionId: string, clipId: string): Promise<void>;
  // ---- C2 track B: his dose answer undone (journey 02; e2e-chains 序 24). The cell is free again: the next logDose
  // inserts a new row (new id, new created_at). not_found when the row is not there.
  deleteDose(sessionId: string, doseId: string): Promise<void>;

  // accounts (keyed by user id)
  /** conflict when the username is taken, invalid when the account exists. */
  createAccount(account: NewAccount): Promise<AccountRow>;
  getAccount(userId: string): Promise<AccountRow | null>;
  getAccountByUsername(username: string): Promise<AccountRow | null>;
  updateAccount(userId: string, patch: AccountPatch): Promise<AccountRow>;
  /**
   * Everything of the account: its row, recovery code, devices, events, consents, push subscriptions, the links where
   * he is the patient and where she is the family member, and his space with all its rows. Her reminder clips in his
   * space keep their rows with by_user_id cleared; access-log rows keep her label with family_user_id cleared.
   */
  deleteAccount(userId: string): Promise<void>;
  /** Replace his recovery code hash (one at a time). */
  setRecoveryCode(userId: string, codeHash: string): Promise<RecoveryCodeRow>;
  getRecoveryCode(userId: string): Promise<RecoveryCodeRow | null>;
  /** Upsert: first_seen_at kept, last_seen_at (and label when given) updated. */
  touchKnownDevice(userId: string, deviceHash: string, label?: string | null): Promise<KnownDeviceRow>;
  listKnownDevices(userId: string): Promise<KnownDeviceRow[]>;
  createResetRequest(request: NewResetRequest): Promise<ResetRequestRow>;
  getResetRequest(id: string): Promise<ResetRequestRow | null>;
  /** Marks it used; null when it was already used (one use only). */
  useResetRequest(id: string): Promise<ResetRequestRow | null>;
  addAccountEvent(userId: string, kind: string, detail?: Record<string, unknown>): Promise<AccountEventRow>;
  /** Oldest first. */
  listAccountEvents(userId: string): Promise<AccountEventRow[]>;

  // family links (care_link) and their switches (family_grant with member = link id)
  /** He invites: the link (invited) and its switches (all off, then `items`). */
  createInvite(invite: NewCareInvite, items?: Partial<FamilyGrantItems>): Promise<CareLinkResult>;
  /** She accepts with the token's hash: invite_not_found, invite_used, invite_expired, invite_self, link_exists. */
  acceptInvite(tokenHash: string, familyUserId: string, familyLabel?: string | null): Promise<CareLinkResult>;
  /** He confirms it is her (active) or not (declined, the token void): link_not_found, link_not_accepted. */
  confirmLink(linkId: string, patientUserId: string, yes: boolean): Promise<CareLinkResult>;
  /** He stops sharing (by patient) or she leaves (by family): link_not_found, link_closed. */
  revokeLink(linkId: string, actorUserId: string, by: "patient" | "family"): Promise<CareLinkResult>;
  getCareLink(linkId: string): Promise<CareLinkRow | null>;
  /** Insertion order. */
  listCareLinks(filter: CareLinkFilter): Promise<CareLinkRow[]>;
  /** Mark invitations past their expiry as expired. Returns how many. */
  expireInvites(): Promise<number>;
  /** A link's switch history, oldest version first. */
  listGrantHistory(linkId: string): Promise<GrantHistoryRow[]>;
  addCareAccessLog(sessionId: string, entry: NewCareAccessLog): Promise<CareAccessLogRow>;
  /** Oldest first; limit keeps the newest N. */
  listCareAccessLog(sessionId: string, opts?: { limit?: number }): Promise<CareAccessLogRow[]>;
  addServiceReadLog(entry: NewServiceReadLog): Promise<ServiceReadLogRow>;
  listServiceReadLog(opts?: { session_id?: string }): Promise<ServiceReadLogRow[]>;

  // consent
  /** Insert only: the same (kind, version, locale) again must carry the same sha256 (invalid otherwise). */
  putConsentText(text: NewConsentText): Promise<ConsentTextRow>;
  getConsentText(kind: ConsentKind, version: string, locale: string): Promise<ConsentTextRow | null>;
  addConsentRecord(record: NewConsentRecord): Promise<ConsentRecordRow>;
  /** Oldest first. */
  listConsentRecords(userId: string, filter?: { kind?: ConsentKind }): Promise<ConsentRecordRow[]>;

  // web push and deliveries
  /** Upsert on endpoint (a repeated subscribe keeps one row, now for this user). */
  savePushSubscription(sub: NewPushSubscription): Promise<PushSubscriptionRow>;
  listPushSubscriptions(userId: string): Promise<PushSubscriptionRow[]>;
  /** Unsubscribe, or the push service answered 410. */
  deletePushSubscription(endpoint: string): Promise<void>;
  /** Record a delivery once: created false (and the existing row) when this key was already sent. */
  recordDelivery(sessionId: string, key: DeliveryKey): Promise<{ created: boolean; delivery: ReminderDeliveryRow }>;
  markDeliveryOpened(sessionId: string, deliveryId: string): Promise<ReminderDeliveryRow>;
  listDeliveries(sessionId: string, filter?: DayRange): Promise<ReminderDeliveryRow[]>;

  // rate limits and the scheduled jobs (not scoped)
  /** One atomic hit in a fixed window; a window that has passed starts again at 1. */
  rateHit(bucket: string, windowS: number, limit: number): Promise<RateHit>;
  /** Drop rate-limit rows not touched since `beforeIso`. Returns how many. */
  pruneRateLimits(beforeIso: IsoDateTime): Promise<number>;
  /** Take or extend the lease when it is free, expired or already this holder's. */
  acquireJobLease(name: string, holder: string, ttlS: number): Promise<boolean>;
  releaseJobLease(name: string, holder: string): Promise<void>;
  addOpsRun(run: NewOpsRun): Promise<OpsRunRow>;
  listOpsRuns(job?: string): Promise<OpsRunRow[]>;

  // profile facts (M11)
  listProfileFacts(sessionId: string, filter?: ProfileFactFilter): Promise<ProfileFactRow[]>;
  addProfileFact(sessionId: string, fact: NewProfileFact): Promise<ProfileFactRow>;
  updateProfileFact(sessionId: string, factId: string, patch: Patch<ProfileFactRow>): Promise<ProfileFactRow>;

  // prevention (M10)
  listPreventDone(sessionId: string): Promise<PreventDoneRow[]>;
  addPreventDone(sessionId: string, row: NewPreventDone): Promise<PreventDoneRow>;
  deletePreventDone(sessionId: string, id: string): Promise<void>;

  // watch (M12)
  addWatchMetrics(sessionId: string, rows: NewWatchMetric[]): Promise<WatchMetricRow[]>;
  /** Sorted by day, then insertion. */
  listWatchMetrics(sessionId: string, filter?: WatchFilter): Promise<WatchMetricRow[]>;

  // diet (M13)
  /** Upsert on (day, item). */
  setDietCheck(sessionId: string, row: NewDietCheck): Promise<DietCheckRow>;
  listDietChecks(sessionId: string, filter?: DayRange): Promise<DietCheckRow[]>;

  // chat (journey 04)
  addChatMessage(sessionId: string, message: NewChatMessage): Promise<ChatMessageRow>;
  /** Oldest first; limit keeps the newest N. */
  listChatMessages(sessionId: string, filter?: ChatFilter): Promise<ChatMessageRow[]>;

  // brief snapshots (journey 14)
  addBriefSnapshot(sessionId: string, snapshot: NewBriefSnapshot): Promise<BriefSnapshotRow>;
  getBriefSnapshot(sessionId: string, id: string): Promise<BriefSnapshotRow | null>;
  /** Oldest first; limit keeps the newest N. */
  listBriefSnapshots(sessionId: string, opts?: { limit?: number }): Promise<BriefSnapshotRow[]>;
  markBriefShown(sessionId: string, id: string): Promise<BriefSnapshotRow>;

  // ---------------------------------------------------------------- C2 track A: sign-in protection (not scoped)
  /**
   * A rate-limit bucket's current window without counting a hit (rateHit counts): null when the bucket has no row or
   * its window has passed. The sign-in lockout reads it before checking a password (lib/auth/limits.ts).
   */
  getRateWindow(bucket: string): Promise<RateWindow | null>;
  /** Forget a bucket: a successful sign-in clears its failures, a recovery lifts the lock on that device. */
  clearRate(bucket: string): Promise<void>;

  // ---------------------------------------------------------------- C2 track L: an allowance that is a sum (not scoped)
  /**
   * Like rateHit, but adds `amount` (a whole number, 0 or more) instead of one: the live captions' daily allowance
   * counts seconds of audio (lib/guard/limits.ts). A window that has passed starts again at `amount`
   * (0015_l_rate_add.sql: rp_rate_add).
   */
  rateAdd(bucket: string, windowS: number, limit: number, amount: number): Promise<RateHit>;

  // ---------------------------------------------------------------- C2 track A: family-assisted reset (real-app 3.6; not scoped)
  /**
   * His switch 「忘记密码时，让她帮我」 on one of his own links (care_link.reset_helper; off until he turns it on):
   * link_not_found (no such link, or not his), link_closed (the link is not active).
   */
  setLinkResetHelper(linkId: string, patientUserId: string, on: boolean): Promise<CareLinkResult>;
  /** His family-assisted reset requests, oldest first. */
  listResetRequests(userId: string): Promise<ResetRequestRow[]>;
  /**
   * She was given a code for his request: the code's hash and her link go on it (a second code replaces the first).
   * null when there is no such request or it was used already.
   */
  setResetRequestCode(id: string, linkId: string, codeHash: string): Promise<ResetRequestRow | null>;

  // translations (C2 track S, lib/translate; 0009_s_translations)
  /** The scope's translation of one source text in one direction, or null. */
  getTranslation(sessionId: string, direction: TranslationDirection, sourceSha256: string): Promise<TranslationRow | null>;
  /** Insert once: when (direction, source) is already there, that first row stays and is returned. */
  putTranslation(sessionId: string, row: NewTranslation): Promise<TranslationRow>;
  /** Oldest first (his data export). */
  listTranslations(sessionId: string): Promise<TranslationRow[]>;

  // the understanding checklist's answers (C2 track F, lib/explain/understanding.ts; 0013_f_understanding)
  /** Upsert on (medication_id, item): his latest answer. not_found when the medicine does not exist. */
  setUnderstandingAnswer(sessionId: string, row: NewUnderstandingAnswer): Promise<UnderstandingAnswerRow>;
  /** Insertion order; `medication_id` narrows to one medicine. */
  listUnderstandingAnswers(sessionId: string, filter?: { medication_id?: string }): Promise<UnderstandingAnswerRow[]>;

  // ---------------------------------------------------------------- C2 track H: retention (journey 15; no migration)
  /**
   * Delete the scope's safety events made before `beforeIso`: they hold his own words and are kept 90 days (real-app
   * 3.11 保留期限; lib/jobs/retention.ts). Returns how many went. session_not_found when the scope does not exist,
   * invalid when `beforeIso` is not a moment.
   */
  pruneSafetyEvents(sessionId: string, beforeIso: IsoDateTime): Promise<number>;
  /**
   * What is still stored that names this person (real-app 3.11 删除账号 step 4: 「每张表按 session_id 或 user_id 计数为 0」): for
   * every column that can hold a user id or a scope id (lib/store/account-rows.ts; an account's scope id is its user
   * id), how many rows still carry this id, keyed "table.column". Only columns with rows are listed: {} means nothing
   * is left. Not through a scoped store (the deletion's check uses the process-wide one).
   */
  countAccountRows(userId: string): Promise<Record<string, number>>;

  // ---------------------------------------------------------------- C2 track I: web push (keyed by user id)
  /**
   * Unsubscribe one of the person's own phones: the row with this endpoint, only when it is theirs. True when a row
   * went. (deletePushSubscription is the scheduled jobs' one, by endpoint alone, for a push service's 410.)
   */
  deleteOwnPushSubscription(userId: string, endpoint: string): Promise<boolean>;
}
