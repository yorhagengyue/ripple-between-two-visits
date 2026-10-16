/**
 * 「Wei Ling 能看到的内容更新了」 (the family texts asked again, owner 2026-10-14; lib/care/reconsent.ts): the card he
 * answers when he has not agreed to the family_share text in force for one of his links. It stands where the card of a
 * link she bound stands (components/his-family/BoundCard), and is drawn with the same parts: on Today in the place of
 * 「是她吗？」, on his page for her above the switches.
 *
 *   one entry of a line with the daughter's node: her name, the title
 *   the family_share text in force, its paragraphs (lib/care/consent.ts familyConsentText; the page passes them in)
 *   when someone is helping him on this phone: 「请陈先生本人点。」 (his 「同意」 writes a consent record of his: real-app 3.11)
 *   「同意」 and 「先不」 (components/his-family/ReconsentAnswer)
 * Until both of them have agreed, her view of him is the alert-only form; his switches stay as they are. The wrapper draws
 * nothing (display: contents), so on Today the buttons still dock at the bottom of the screen that holds it.
 */
import { BodyText, Timeline, TimelineItem } from "@/components/ui";
import { pc } from "@/lib/care/his-copy";
import { rcc } from "@/lib/care/reconsent-copy";
import type { PatientLinkView } from "@/lib/care/types";
import type { Locale } from "@/lib/i18n";
import { ReconsentAnswer } from "./ReconsentAnswer";
import "./his-family.css";
import "./his-bind.css";

export function ReconsentCard({
  locale,
  link,
  paragraphs,
  helped,
  date,
  dock = true,
  testId,
}: {
  locale: Locale;
  /** his link whose text he has not agreed to */
  link: PatientLinkView;
  /** the family_share text in force, in his language */
  paragraphs: readonly string[];
  /** someone is helping him on this phone: his name ("" when there is none); null: nobody is */
  helped: string | null;
  /** his date today (YYYY-MM-DD): what 「先不」 keeps */
  date: string;
  /** the buttons in the lower part of the screen (Today); false: in the page's flow (his page for her) */
  dock?: boolean;
  testId?: string;
}) {
  const name = link.familyLabel?.trim() || link.her?.displayName?.trim() || rcc(locale, "hisSomeone");
  return (
    <div className="contents" data-testid={testId} data-link={link.id}>
      <div className={dock ? "rpu-stack rph-confirm rphb-bound" : "rpu-stack rph-confirm rphb-bound rphb-card"} data-testid="reconsent-card">
        <Timeline>
          <TimelineItem node="dau" who={name} title={rcc(locale, "hisTitle", { name })} />
        </Timeline>
        {paragraphs.map((p) => (
          <BodyText key={p}>{p}</BodyText>
        ))}
        {helped !== null && (
          <BodyText variant="strong">
            <span data-testid="reconsent-self">{helped ? pc(locale, "confirmSelf", { name: helped }) : pc(locale, "confirmSelfNoName")}</span>
          </BodyText>
        )}
        {!dock && <ReconsentAnswer linkId={link.id} locale={locale} date={date} dock={false} />}
      </div>
      {dock && <ReconsentAnswer linkId={link.id} locale={locale} date={date} />}
    </div>
  );
}
