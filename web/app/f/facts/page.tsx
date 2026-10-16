/**
 * /f/facts?link= — she adds a line to his details, for him to confirm (C2 track D, round two; real-app 3.10 「补档案：她写的
 * 事实是 source = family、confirmed_by = null。他点『对』之前，不进任何引用来源；他点『对』以后，她的 /f 出现『爸爸确认了』」,
 * 2.5, M11). Through her active link (else back to /f). The form posts to track C's route; this page lists what she
 * wrote through this link and how each line stands: 「等爸爸确认」 or 「爸爸确认了」. A line he answered 「不对」 is no longer
 * shown. Only her own words are here: nothing of his details is read out to her, so this is not a look at his records
 * and writes no access-log row (the proposal itself reaches him as 「Wei Ling 写了：……对吗？」).
 */
import { FactComposer, FactsLive } from "@/components/family/FactComposer";
import { FamilyHero, FamilyNote, FamilyScreen, FamilySection, FamilyTop, FactRow, FactRows } from "@/components/family-ui";
import { herFacts } from "@/lib/care/facts";
import { hc, type HerKey } from "@/lib/care/her-copy";
import { herPage } from "@/lib/care/her-page";
import type { HerFact } from "@/lib/care/home-types";
import type { Locale } from "@/lib/i18n";
import { clockWords } from "@/lib/profile/dates";

export const dynamic = "force-dynamic";

const KIND_KEYS: Record<string, HerKey> = {
  condition: "factKind_condition",
  allergy: "factKind_allergy",
  clinic: "factKind_clinic",
  routine: "factKind_routine",
  other: "factKind_other",
};

/** A line as her list words it: what it is about (in her word for him: 「她常去的诊所」), then her own words (a breakfast time in her language). */
function lineWords(f: HerFact, locale: Locale, dad: string): string {
  const about = hc(locale, KIND_KEYS[f.kind] ?? "factKind_other", { dad });
  const words = f.kind === "routine" && f.time ? clockWords(f.time, locale) : f.text;
  return locale === "zh-Hans" ? `${about}：${words}` : `${about}: ${words}`;
}

export default async function FamilyFactsPage({ searchParams }: PageProps<"/f/facts">) {
  const p = await herPage(await searchParams, "/f/facts");
  const { ctx, link, locale, dad } = p;
  const facts = await herFacts(ctx.store, ctx.session, link.id);
  return (
    <div className="contents" data-testid="family-facts" data-waiting={facts.filter((f) => f.state === "waiting").length} data-confirmed={facts.filter((f) => f.state === "confirmed").length}>
      <FamilyScreen locale={locale}>
        <FamilyTop back={{ href: p.paths.me, label: hc(locale, "meBack") }} locale={locale} langHref={p.langHref} />
        <FamilyHero tone="quiet" title={hc(locale, "factsTitle", { dad })} detail={hc(locale, "factsLead", { dad })} />
        <FactsLive linkId={link.id} since={ctx.since} />
        <FactComposer locale={locale} linkId={link.id} dad={dad} />
        {facts.length > 0 && (
          <section data-testid="her-facts">
            <FamilySection>{hc(locale, "factsMine")}</FamilySection>
            <FactRows style={{ marginTop: 10 }}>
              {facts.map((f) => (
                <FactRow
                  key={f.id}
                  label={lineWords(f, locale, dad)}
                  value={hc(locale, f.state === "waiting" ? "factWaiting" : f.edited ? "factConfirmedEdited" : "factConfirmed", { dad })}
                  off={f.state === "waiting"}
                  data-testid={`her-fact-${f.state}`}
                />
              ))}
            </FactRows>
          </section>
        )}
        <FamilyNote style={{ marginTop: 24 }}>{hc(locale, "factsNote", { dad })}</FamilyNote>
      </FamilyScreen>
    </div>
  );
}
