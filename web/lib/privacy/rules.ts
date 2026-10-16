/**
 * The numbers of his data's rules, in one place (docs/plan/real-app.md 3.11 保留期限, 导出; the sign-up text says the same
 * in words). Pure, client-safe: the privacy notice, the screens, the jobs and the routes all read these.
 */
export const DAY_MS = 86_400_000;
/** a visit recording is kept this many days from the visit's date, unless he keeps it for good */
export const AUDIO_KEEP_DAYS = 90;
/** safety events (they hold his own words) */
export const SAFETY_EVENT_KEEP_DAYS = 90;
/** an example account nobody used for this many days is deleted (never a filming account) */
export const EXAMPLE_IDLE_DAYS = 30;
/** a scope's event history (the live stream's replay): the newest 200, and none older than this many days */
export const BUS_EVENT_KEEP_DAYS = 7;
/** rate-limit rows untouched this many hours are dropped */
export const RATE_LIMIT_KEEP_HOURS = 48;
/** an orphan file is removed once it is this many days old (lib/privacy/sweep.ts) */
export const ORPHAN_GRACE_DAYS = 2;
/** exports a day */
export const EXPORT_LIMIT_PER_DAY = 3;
/** how long the links in an export work */
export const EXPORT_LINK_SECONDS = 24 * 3600;
