/**
 * Track B's scheduled jobs (C2; real-app 2.7, 2.9, 2.24, 8.3): the medicine day and the blood pressure reminders of every
 * account. Server-only. Registered with the foundation's runner (lib/jobs/runner.ts) when this module loads; lib/jobs
 * (index.ts) loads it, and instrumentation.ts loads lib/jobs once when the server starts, so POST /api/dev/tick and the
 * JOBS=1 loop both see them.
 *
 *   daily.doses   every minute: settle closed windows as "no reply", his first and second reminder per slot, her
 *                 "no reply" alert (lib/daily/dose-run.ts)
 *   daily.bp      every minute: his blood pressure reminder on the days and parts of the day the doctor gave, and
 *                 "not measured" when that part of the day passes without a reading (lib/daily/bp-run.ts)
 *
 * Each account scope is worked on through a store bound to it (system mode, lib/jobs/runner.ts forEachAccountScope);
 * the links and the accounts' languages are read through the process store, which lib/jobs may use. ops_run gets
 * counts only.
 */
import type { Locale } from "@/lib/i18n";
import { runBpDay } from "@/lib/daily/bp-run";
import { runDoseDay, type LinkWithSwitch } from "@/lib/daily/dose-run";
import type { SessionRow, Store } from "@/lib/store/types";
import { forEachAccountScope, registerJob, type JobDefinition } from "./runner";

const asLocale = (v: string | null | undefined): Locale => (v === "en" ? "en" : "zh-Hans");

/** His language: his account's, else his scope's setting, else 华语. */
export async function patientLocale(store: Store, scope: SessionRow): Promise<Locale> {
  const account = scope.owner_user_id ? await store.getAccount(scope.owner_user_id).catch(() => null) : null;
  return asLocale(account?.locale ?? (typeof scope.settings?.locale === "string" ? scope.settings.locale : null));
}

/** His active care links, each with its no-reply switch and her language. */
export async function linksWithSwitch(store: Store, scope: SessionRow): Promise<LinkWithSwitch[]> {
  if (!scope.owner_user_id) return [];
  const links = await store.listCareLinks({ patient_id: scope.owner_user_id, status: ["active"] });
  const out: LinkWithSwitch[] = [];
  for (const link of links) {
    const grant = await store.getFamilyGrant(scope.id, link.id);
    const her = link.family_id ? await store.getAccount(link.family_id).catch(() => null) : null;
    out.push({ link, noReplyAlert: !!grant?.items.no_reply_alert, locale: asLocale(her?.locale) });
  }
  return out;
}

export const DAILY_DOSES_JOB: JobDefinition = {
  name: "daily.doses",
  everyMs: 60_000,
  leaseS: 120,
  async run(ctx) {
    const total = { scopes: 0, settled: 0, first: 0, second: 0, family: 0, sent: 0 };
    total.scopes = await forEachAccountScope(ctx.store, async (subject) => {
      const scope = subject.scope;
      const c = await runDoseDay(subject.store, scope, ctx.nowMs, {
        locale: await patientLocale(ctx.store, scope),
        links: () => linksWithSwitch(ctx.store, scope),
      });
      total.settled += c.settled;
      total.first += c.first;
      total.second += c.second;
      total.family += c.family;
      total.sent += c.sent;
    });
    return total;
  },
};

export const DAILY_BP_JOB: JobDefinition = {
  name: "daily.bp",
  everyMs: 60_000,
  leaseS: 120,
  async run(ctx) {
    const total = { scopes: 0, reminded: 0, not_measured: 0, sent: 0 };
    total.scopes = await forEachAccountScope(ctx.store, async (subject) => {
      const c = await runBpDay(subject.store, subject.scope, ctx.nowMs, { locale: await patientLocale(ctx.store, subject.scope) });
      total.reminded += c.reminded;
      total.not_measured += c.notMeasured;
      total.sent += c.sent;
    });
    return total;
  },
};

registerJob(DAILY_DOSES_JOB);
registerJob(DAILY_BP_JOB);
