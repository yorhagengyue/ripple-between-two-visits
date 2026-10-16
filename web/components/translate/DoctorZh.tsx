/**
 * <DoctorZh text={english} locale={locale} />: the checked Chinese of one doctor's or pharmacist's English line, under
 * that line, on a server-rendered page (C2 track S, round 2; real-app 12; audit au4 row 29). A server component: it looks
 * the line up for the subject the page was opened by (lib/translate/shown.ts zhLookup: the Chinese page only, only with
 * his consent to AI processing, only a translation that passed both checks) and draws <ZhUnder>. The scope's kept
 * translations are read once per request (React cache), however many lines a page shows. Never calls a model.
 *
 * A page adds one line after the quoted words:
 *   <Said lang="en" ...>“{line.text}”</Said>
 *   <DoctorZh text={line.text} locale={locale} />
 * Inside a client component use <ZhUnder> with a translation the server put into the data (the relay block does).
 */
import { cache } from "react";
import { getPageSubject } from "@/lib/subject";
import { zhLookup, type ZhLookup } from "@/lib/translate/shown";
import { ZhUnder } from "./ZhUnder";

const NONE: ZhLookup = () => null;

/** The page's lookup, read once per request for the subject the page was opened by (an account's own pages). */
export const pageZh = cache(async (locale: string): Promise<ZhLookup> => {
  if (locale !== "zh-Hans") return NONE;
  const ctx = await getPageSubject().catch(() => null);
  if (!ctx || ctx.subject.kind !== "account") return NONE;
  return zhLookup(ctx.store, ctx.session, { locale });
});

export async function DoctorZh({ text, locale, testId }: { text: string | null | undefined; locale: string; testId?: string }) {
  if (!text || locale !== "zh-Hans") return null;
  const zh = (await pageZh(locale))(text);
  return <ZhUnder text={zh} locale={locale} testId={testId} />;
}
