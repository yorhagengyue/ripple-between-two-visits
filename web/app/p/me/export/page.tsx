/**
 * /p/me/export — 「我的数据」 (journey 15; real-app 2.23, 3.11; the elder brief 15; C2 track H; laid out after the timeline
 * draft's 15-1a and 15-1b). The 「我」 page's data row (components/me/DataEntry) opens it. First on this screen: export
 * his data (one file; recordings and photos as links that work for 24 hours; three a day), in a plain box with the
 * filled button under it; once made, a ticked node says so. Below, in one card, the other parts of his data, each its
 * own screen: how long visit recordings are kept, when his family looked, the privacy notice, deleting the account.
 * Only on his own account (the /p layout keeps everyone without a space out); the demo has none (404).
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MeEntry } from "@/components/me/MeEntry";
import { MeGroup } from "@/components/me/MeGroup";
import { P } from "@/components/me/parts";
import { PageHeader, Screen } from "@/components/ui";
import { careAccessEntries } from "@/lib/care/access-log";
import { asHLocale, hCopy } from "@/lib/privacy/copy";
import { exportAllowance } from "@/lib/privacy/export";
import { momentWords } from "@/lib/privacy/words";
import { getPatientLocale } from "@/lib/session/server";
import { getPageSubject } from "@/lib/subject";
import { accountDeps } from "@/lib/subject/account";
import { nowMs } from "@/lib/time/now";
import { ExportAction } from "./ExportAction";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "我的数据 · Ripple" };

export default async function MyDataPage() {
  const [ctx, uiLocale] = await Promise.all([getPageSubject(), getPatientLocale()]);
  if (!ctx) return null;
  if (ctx.subject.kind !== "account" || ctx.subject.relation !== "self" || !ctx.subject.userId) notFound();
  const locale = asHLocale(uiLocale);
  const c = hCopy(locale);
  const scope = ctx.session;
  const [allowance, looks] = await Promise.all([
    exportAllowance(accountDeps().store, { userId: ctx.subject.userId, scope }, { nowMs: nowMs() }),
    careAccessEntries(ctx.store, scope, { limit: 1 }),
  ]);
  const last = looks[0];
  return (
    <Screen locale={locale} className="rpm-screen">
      <PageHeader back={{ href: "/p/me", label: c.me }} title={c.dataTitle} locale={locale} />
      <div className="rpu-stack" data-testid="page-my-data">
        <P size="large">{c.dataLede}</P>
        <ExportAction locale={locale} tz={scope.tz} left={allowance.left} resetsAt={allowance.resetsAt} />
        <nav className="rpu" data-rp="data-menu" aria-label={c.myData}>
          <MeGroup>
            <MeEntry entry="recordings" href="/p/me/export/recordings" title={c.rowRecordings} status={c.rowRecordingsStatus} />
            <MeEntry
              entry="access"
              href="/p/me/export/access"
              title={c.rowAccess}
              status={last ? c.rowAccessLast(last.who?.trim() || (locale === "zh-Hans" ? "家人" : "Family"), momentWords(last.at, locale, scope.tz)) : c.rowAccessNone}
            />
            <MeEntry entry="privacy" href="/privacy" title={c.rowPrivacy} status={c.rowPrivacyStatus} />
            <MeEntry entry="delete" href="/p/me/delete" tone="danger" title={c.rowDelete} status={c.rowDeleteStatus} />
          </MeGroup>
        </nav>
      </div>
    </Screen>
  );
}
