/**
 * 「Wei Ling 接受了邀请，是她吗？」 (the timeline draft's 18-1; real-app 2.20 step 3): the one card he answers before she
 * sees anything, the same on 「我 → 家人」 and on Today (the notice 「Wei Ling 已经接受」 lands on Today's).
 *
 *   one entry of a line with the daughter's node: her name and 「接受了邀请」, the question (28), and under it the name
 *   she gave and how she signs in (what he checks; the draft shows her phone number there, which the app does not have)
 *   a grey box: 「你点「是她」以前，她什么都看不到。」 and why it is asked
 *   when someone is helping him on this phone: 「请陈先生本人点。」 (real-app 3.11)
 *   「不是」 and 「是她」 side by side in the lower part (components/family/HisFamily ConfirmHer)
 *
 * The wrapper draws nothing (display: contents), so the buttons still dock at the bottom of the screen that holds it.
 */
import { ConfirmHer } from "@/components/family/HisFamily";
import { BodyText, Box, Timeline, TimelineItem } from "@/components/ui";
import { pc } from "@/lib/care/his-copy";
import type { PatientLinkView } from "@/lib/care/types";
import type { Locale } from "@/lib/i18n";
import "./his-family.css";

export function ConfirmCard({
  locale,
  link,
  helped,
  testId,
}: {
  locale: Locale;
  /** the link she accepted */
  link: PatientLinkView;
  /** someone is helping him on this phone: his name ("" when there is none); null: nobody is */
  helped: string | null;
  testId?: string;
}) {
  const name = link.familyLabel ?? link.her?.displayName ?? "";
  const who = link.her?.username
    ? pc(locale, "confirmWho", { display: link.her.displayName ?? name, login: link.her.username })
    : pc(locale, "confirmWhoEmail", { display: link.her?.displayName ?? name });
  return (
    <div className="contents" data-testid={testId} data-link={link.id}>
      <div className="rpu-stack rph-confirm">
        <Timeline>
          <TimelineItem node="dau" who={name || undefined} meta={pc(locale, "confirmMeta")} title={pc(locale, "confirmAsk", { name })} note={who} />
        </Timeline>
        <Box variant="grey" title={pc(locale, "confirmWhyTitle")}>
          {pc(locale, "confirmWhyBody")}
        </Box>
        {helped !== null && (
          <BodyText variant="strong">
            <span data-testid="confirm-self">{helped ? pc(locale, "confirmSelf", { name: helped }) : pc(locale, "confirmSelfNoName")}</span>
          </BodyText>
        )}
      </div>
      <ConfirmHer linkId={link.id} locale={locale} />
    </div>
  );
}
