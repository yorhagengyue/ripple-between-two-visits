/**
 * Track H's hourly job (C2; docs/plan/real-app.md 3.11 保留期限 and 定时任务 「每小时：录音到期、safety_event、bus_event、导出包、
 * 过期邀请、rate_limit」; journey 15): privacy.retention. Server-only.
 * Registered with the foundation's runner when this module loads; lib/jobs/index.ts loads it (one import line), and it
 * loads track H's nightly job (./orphans.ts) with it.
 *
 * One pass:
 *   every account scope (a store bound to it, system mode; lib/privacy/retention.ts retainScope)
 *     - recorded visits get their retain_until (the visit date + 90 days) written when they have none
 *     - a recording past it, not kept for good: its files go, its paths are cleared, audio_deleted_at is set;
 *       the transcript and the visit's items stay
 *     - safety events older than 90 days go
 *     - his channel's event history older than 7 days goes (the newest 200 are kept on publish; real time)
 *   invitations past their date are marked expired (real-app 3.10 「过期的邀请由定时任务标 expired」)
 *   rate-limit rows untouched for 48 hours go
 *   every consent text is written to consent_text once (insert only; lib/privacy/consents.ts), so a record's hash
 *   always has its text row, whichever track wrote the record
 * An export leaves nothing on the server (lib/privacy/export.ts), so there is no export package to delete. Idle example
 * accounts, expired judge sandboxes and orphan files are the nightly job's (./orphans.ts).
 * ops_run gets counts only (the runner writes it); the log line is whitelisted (lib/log.ts).
 *
 * The demo is never touched here: its sandboxes expire on their own and a reset clears a session.
 */
import { getBlobStore } from "@/lib/blob";
import { getBus } from "@/lib/bus";
import { log } from "@/lib/log";
import { publishConsentTexts } from "@/lib/privacy/consents";
import { retainScope } from "@/lib/privacy/retention";
import { BUS_EVENT_KEEP_DAYS, DAY_MS, RATE_LIMIT_KEEP_HOURS } from "@/lib/privacy/rules";
import { realNowMs } from "@/lib/time/now";
import "./orphans";
import { forEachAccountScope, registerJob, type JobDefinition } from "./runner";

export const RETENTION_JOB = "privacy.retention";
export const RETENTION_EVERY_MS = 60 * 60_000;
/** rate-limit buckets untouched this long are dropped (real-app 3.11: 48 hours) */
export const RATE_LIMIT_KEEP_MS = RATE_LIMIT_KEEP_HOURS * 3600_000;
/** a scope's event history is kept this long at most (real-app 3.11: 7 days) */
export const BUS_EVENT_KEEP_MS = BUS_EVENT_KEEP_DAYS * DAY_MS;

export const RETENTION_JOB_DEF: JobDefinition = {
  name: RETENTION_JOB,
  everyMs: RETENTION_EVERY_MS,
  leaseS: 900,
  async run(ctx) {
    const blob = getBlobStore();
    const bus = getBus();
    const total = { scopes: 0, visits: 0, files: 0, clips: 0, stamped: 0, safety: 0, events: 0, scope_failed: 0, invites_expired: 0, rate_limits: 0, consent_texts: 0, consent_texts_failed: 0 };
    // events carry the machine's time (lib/bus.ts), so their 7 days are measured on the machine's clock
    const eventsBefore = realNowMs() - BUS_EVENT_KEEP_MS;
    total.scopes = await forEachAccountScope(ctx.store, async (subject) => {
      try {
        const c = await retainScope(subject.store, subject.scope, { blob, nowMs: ctx.nowMs });
        total.visits += c.visits;
        total.files += c.files;
        total.clips += c.clips;
        total.stamped += c.stamped;
        total.safety += c.safety;
        total.events += await bus.pruneBefore(subject.scope.id, eventsBefore);
      } catch {
        total.scope_failed += 1; // the next pass tries again; the other scopes go on
      }
    });
    total.invites_expired = await ctx.store.expireInvites();
    total.rate_limits = await ctx.store.pruneRateLimits(new Date(ctx.nowMs - RATE_LIMIT_KEEP_MS).toISOString());
    const texts = await publishConsentTexts(ctx.store);
    total.consent_texts = texts.texts;
    total.consent_texts_failed = texts.failed;
    log("info", "job.ran", { job: RETENTION_JOB, counts: total });
    return total;
  },
};

registerJob(RETENTION_JOB_DEF);
