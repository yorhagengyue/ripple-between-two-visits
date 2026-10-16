/**
 * 「Wei Ling 绑定了你的账号」 (line bind): the card he answers when a family member bound his account by typing it and
 * he has not acknowledged the link yet (lib/care/ack.ts). On Today it is shown where and how 「是她吗？」 is (the notice
 * 「… 绑定了你的账号」 lands there); on her page under 「家人」 the same card stands above his switches for her, until he
 * has answered.
 *
 *   one entry of a line with the daughter's node: her name, the sentence (28), and under it her account and when
 *   what she can see now, in the owner's words: the four counts; a grey box: what she cannot see
 *   when someone is helping him on this phone: 「请陈先生本人点。」 (his 「知道了」 writes a consent record of his: real-app 3.11)
 *   「知道了」 and 「不认识这个人，解除」 (components/his-family/BoundAnswer)
 *
 * The name is the one on the link (lib/care/bind.ts keeps her own name only when it reads as one, else her account
 * name); without one the card says 「有人」. The wrapper draws nothing (display: contents), so on Today the buttons still
 * dock at the bottom of the screen that holds it.
 */
import { BodyText, Box, Timeline, TimelineItem } from "@/components/ui";
import { bc } from "@/lib/care/bind-copy";
import { dayWords } from "@/lib/care/copy";
import { pc } from "@/lib/care/his-copy";
import { dateIn, hmIn } from "@/lib/care/time";
import type { PatientLinkView } from "@/lib/care/types";
import type { Locale } from "@/lib/i18n";
import { BoundAnswer } from "./BoundAnswer";
import "./his-family.css";
import "./his-bind.css";

/** 「10月11日 21:15」 / "11 Oct 21:15", in his time zone. */
export function boundWhen(iso: string | null | undefined, tz: string, locale: Locale): string {
  if (!iso) return "";
  return `${dayWords(dateIn(iso, tz), locale)} ${hmIn(iso, tz)}`;
}

export function BoundCard({
  locale,
  link,
  helped,
  tz,
  dock = true,
  testId,
}: {
  locale: Locale;
  /** the link she bound */
  link: PatientLinkView;
  /** someone is helping him on this phone: his name ("" when there is none); null: nobody is */
  helped: string | null;
  /** his time zone, for when she bound it */
  tz: string;
  /** the buttons in the lower part of the screen (Today); false: in the page's flow (her page under 「家人」) */
  dock?: boolean;
  testId?: string;
}) {
  const name = link.familyLabel?.trim() || bc(locale, "boundSomeone");
  const when = boundWhen(link.confirmedAt ?? link.acceptedAt ?? link.invitedAt, tz, locale);
  const who = link.her?.username ? bc(locale, "boundWho", { login: link.her.username, when }) : bc(locale, "boundWhoEmail", { when });
  return (
    <div className="contents" data-testid={testId} data-link={link.id}>
      <div className={dock ? "rpu-stack rph-confirm rphb-bound" : "rpu-stack rph-confirm rphb-bound rphb-card"} data-testid="bound-card">
        <Timeline>
          <TimelineItem node="dau" who={name} title={bc(locale, "boundTitle", { name })} note={<span data-testid="bound-who">{who}</span>} />
        </Timeline>
        <BodyText>
          <span data-testid="bound-sees">{bc(locale, "boundSees")}</span>
        </BodyText>
        <Box variant="grey" title={bc(locale, "boundNot")} />
        {helped !== null && (
          <BodyText variant="strong">
            <span data-testid="bound-self">{helped ? pc(locale, "confirmSelf", { name: helped }) : pc(locale, "confirmSelfNoName")}</span>
          </BodyText>
        )}
        {!dock && <BoundAnswer linkId={link.id} locale={locale} dock={false} />}
      </div>
      {dock && <BoundAnswer linkId={link.id} locale={locale} />}
    </div>
  );
}
