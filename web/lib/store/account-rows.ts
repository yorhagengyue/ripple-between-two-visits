/**
 * Every column that can hold a person: a user id, or a scope id (an account's scope id is its user id). C2 track H.
 *
 * Deleting an account ends with a check that nothing is left (docs/plan/real-app.md 3.11 删除账号 step 4: 「每张表按
 * session_id 或 user_id 计数为 0」): store.countAccountRows(userId) counts the rows that still carry the id in each of
 * these columns. The memory store and the Supabase store both answer with the same "table.column" keys.
 *
 * The list is held to the schema by tests/unit/privacy/account-rows.test.ts, which reads supabase/migrations/*.sql:
 * every column named session_id, scope_id, user_id, patient_id or family_id, and every other uuid column that is not a
 * row's own id or a link id, must be listed here or in ACCOUNT_ROW_EXCEPTIONS with its reason. A new table that names
 * a person and is in neither turns that test red, so it cannot be forgotten.
 */
export const ACCOUNT_ROW_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  // the scope itself (an account's row has id = owner_user_id = the user's id)
  session: ["id", "owner_user_id"],
  session_member: ["session_id"],
  // his records
  visit: ["session_id"],
  utterance: ["session_id"],
  visit_item: ["session_id"],
  medication: ["session_id"],
  understanding_answer: ["session_id"],
  dose_log: ["session_id"],
  bp_reading: ["session_id"],
  note: ["session_id"],
  question: ["session_id", "asked_by_user_id"],
  family_grant: ["session_id"],
  reminder_clip: ["session_id", "by_user_id"],
  safety_event: ["session_id"],
  profile_fact: ["session_id", "entered_by_user_id"],
  watch_metric: ["session_id"],
  prevent_done: ["session_id"],
  diet_check: ["session_id"],
  chat_message: ["session_id"],
  brief_snapshot: ["session_id"],
  translation: ["session_id"],
  reminder_delivery: ["session_id"],
  // the event stream's history
  bus_seq: ["session_id"],
  bus_event: ["session_id"],
  // the account
  account: ["user_id"],
  account_recovery: ["user_id"],
  known_device: ["user_id"],
  reset_request: ["user_id"],
  account_event: ["user_id"],
  account_session: ["user_id"],
  consent_record: ["user_id", "scope_id"],
  push_subscription: ["user_id"],
  // family links, on either side
  care_link: ["patient_id", "family_id"],
  care_grant_history: ["session_id"],
  care_access_log: ["session_id", "family_user_id"],
};

/** Columns that look like they name a person and are left out on purpose, each with the reason. */
export const ACCOUNT_ROW_EXCEPTIONS: Readonly<Record<string, string>> = {
  "service_read_log.session_id": "the operators' audit trail (who, why, which tables) is kept when an account goes: the owner's decision; the id then names nobody",
  "account_session.session_id": "the sign-in session's own id (the identity provider's), not a scope",
};

/** "table.column" for every counted column, in a stable order. */
export function accountRowKeys(): string[] {
  return Object.entries(ACCOUNT_ROW_COLUMNS).flatMap(([table, cols]) => cols.map((c) => `${table}.${c}`));
}
