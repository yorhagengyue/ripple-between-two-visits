/**
 * /p/meds — every medicine he has on the story day, grouped by where it came from (医生开的 / 自己买的 / 亲戚带的 /
 * 保健品), each with its check status, and the big 「拍药袋」 button (task M3 item 1).
 */
import Link from "next/link";
import { AccountMedsPage } from "@/components/meds/elder/pages";
import { StatusPill } from "@/components/meds/StatusPill";
import { cx } from "@/components/meds/classes";
import { t } from "@/lib/i18n";
import { mt } from "@/lib/meds/i18n";
import { listMedGroups } from "@/lib/meds/list";
import { getPatientLocale } from "@/lib/session/server";
import { getPageSubject } from "@/lib/subject";

export default async function MedsPage() {
  const [ctx, locale] = await Promise.all([getPageSubject(), getPatientLocale()]);
  if (!ctx) return null;
  // his own account (C2): the elder screen (components/meds/elder); the demo below is unchanged
  if (ctx.subject.kind === "account") return <AccountMedsPage ctx={ctx} locale={locale} />;
  const groups = await listMedGroups(ctx.store, ctx.session.id, ctx.session.story_day, locale, ctx.session.story_time);
  return (
    <div className="flex flex-col gap-4" data-testid="page-meds">
      <h1 className="text-[28px] font-bold">{t(locale, "nav.meds")}</h1>
      <Link href="/p/meds/add" className={`rp-btn rp-btn-accent ${cx.bigButton}`} data-testid="meds-add">
        {mt(locale, "meds.add")}
      </Link>
      {groups.length === 0 ? <p className="text-ink-2">{mt(locale, "meds.empty")}</p> : null}
      {groups.map((g) => (
        <section key={g.origin} className="flex flex-col gap-2" data-testid={`meds-group-${g.origin}`}>
          <h2 className="text-[20px] font-bold">{mt(locale, `origin.${g.origin}`)}</h2>
          <ul className="flex flex-col gap-2">
            {g.items.map((m) => (
              <li key={m.id}>
                <Link href={`/p/meds/${encodeURIComponent(m.id)}`} className={`rp-card ${cx.row}`} data-testid={`med-row-${m.id}`} data-status={m.status}>
                  <span className="min-w-0">
                    <span className={cx.rowName}>{m.name}</span>
                    {/* C2 track E (real-app 12 「药名没有中文」): the Chinese generic name from the fixed table
                        (lib/meds/zh-names.ts), next to the English name, in the 华语 UI; never a translation made up here */}
                    {locale === "zh-Hans" && m.zhName ? (
                      <span className="ml-2 text-ink-2" lang="zh-Hans" data-testid={`med-zh-${m.id}`}>
                        {m.zhName}
                      </span>
                    ) : null}
                    {m.strength ? <span className={cx.rowStrength}>{m.strength}</span> : null}
                  </span>
                  <StatusPill status={m.status} locale={locale} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
