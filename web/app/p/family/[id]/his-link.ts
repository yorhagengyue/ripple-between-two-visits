/**
 * What the three screens of one family member share (/p/family/[id], its /seen and its /stop; front-end line fe-fam):
 * he is on his own account, the link is his, and the same few words about it (her name, 「女儿 Wei Ling」, the short
 * times of his own day). Server-only; reads through the existing reader (lib/care/links patientLinks) and nothing else.
 * A link that is not his is a 404, as before.
 */
import { notFound } from "next/navigation";
import { dayWords, whoWords } from "@/lib/care/copy";
import { pc } from "@/lib/care/his-copy";
import { patientLinks } from "@/lib/care/links";
import { dateIn, whenWords } from "@/lib/care/time";
import type { PatientLinkView } from "@/lib/care/types";
import type { Locale } from "@/lib/i18n";
import { getPatientLocale } from "@/lib/session/server";
import { scopeTz } from "@/lib/store/scope";
import { getPageSubject, type PageSubject } from "@/lib/subject";
import { careEntryStore } from "@/lib/subject/care";
import { nowMs } from "@/lib/time/now";

export interface HisLink {
  ctx: PageSubject;
  locale: Locale;
  link: PatientLinkView;
  /** the id as it is in the address, and this member's own page */
  id: string;
  href: string;
  /** 「Wei Ling」: how he named her, else the name she gave, else 「家人」 */
  name: string;
  /** 「女儿 Wei Ling」 */
  who: string;
  /** 「‹ 家人」: the way back to the list */
  backToList: { href: string; label: string };
  /** 「‹ Wei Ling」: the way back to this member's page */
  backToLink: { href: string; label: string };
  /** 「今天 8:20」「昨晚 9:12」「10月12日 8:20」: short enough to stay on one line next to a name */
  when: (iso: string) => string;
  /** 「10月19日」 in his time zone */
  day: (iso: string | null | undefined) => string | null;
}

export async function hisLink(raw: string): Promise<HisLink> {
  const id = decodeURIComponent(raw);
  const [ctx, locale] = await Promise.all([getPageSubject(), getPatientLocale()]);
  if (!ctx || ctx.subject.kind !== "account" || ctx.subject.relation !== "self" || !ctx.subject.userId) notFound();
  const link = (await patientLinks(ctx.store, careEntryStore(), ctx.session, ctx.subject.userId, nowMs())).find((l) => l.id === id);
  if (!link) notFound();
  const tz = scopeTz(ctx.session);
  const name = link.familyLabel ?? link.her?.displayName ?? (locale === "zh-Hans" ? "家人" : "Family member");
  const href = `/p/family/${encodeURIComponent(id)}`;
  const today = dateIn(new Date(nowMs()).toISOString(), tz);
  return {
    ctx,
    locale,
    link,
    id,
    href,
    name,
    who: whoWords(name, link.relation, locale),
    backToList: { href: "/p/family", label: pc(locale, "familyTitle") },
    backToLink: { href, label: name },
    when: (iso) => whenWords(iso, today, tz, locale),
    day: (iso) => (iso ? dayWords(dateIn(iso, tz), locale) : null),
  };
}
