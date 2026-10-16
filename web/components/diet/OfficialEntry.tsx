/**
 * One line of the knowledge base's diet lines (kb/diet.json through lib/diet/view.ts) as an entry of a timeline (design
 * 13-1, 13-2): the node of a written source (the ink square), 「保健促进局写着」, the line as the knowledge base words
 * it (serif, as every line relayed from a written source), then where it is from (the page's title, the page's own date,
 * the day it was checked against the page) and the pill that opens the official page. Nothing is added to the line.
 *
 * Test hooks: diet-line (data-line, data-url).
 */
import { PlayPill, TimelineItem, TlControls, TlNote } from "@/components/ui";
import { longDay } from "@/lib/daily/i18n";
import type { OfficialLineView } from "@/lib/diet/view";
import type { Locale } from "@/lib/i18n";
import { DIET_WORDS } from "./copy";
import { SourceHead } from "./DoctorWords";

/** The publisher as his language names it (the kb keeps the English name). */
const PUBLISHER: Record<string, string> = { "Health Promotion Board": "保健促进局", "Ministry of Health": "卫生部", HealthHub: "HealthHub" };
const MONTHS: Record<string, number> = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };

/** The page's own date as the kb noted it ("Article last reviewed 04 July 2025") in his language, or null. */
export function pageDateWords(raw: string | null, locale: Locale): string | null {
  const m = /(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/.exec(raw ?? "");
  const mo = m ? MONTHS[m[2].toLowerCase()] : undefined;
  if (!m || !mo) return null;
  return longDay(locale, `${m[3]}-${String(mo).padStart(2, "0")}-${m[1].padStart(2, "0")}`);
}

export function OfficialEntry({ line, locale }: { line: OfficialLineView; locale: Locale }) {
  const w = DIET_WORDS[locale];
  const publisher = locale === "zh-Hans" ? (PUBLISHER[line.source.publisher] ?? line.source.publisher) : line.source.publisher;
  return (
    <TimelineItem node="lab" testId="diet-line" attrs={{ "data-line": line.id, "data-url": line.source.url }}>
      <SourceHead kind="leaflet" node="lab" who={w.says(publisher)} />
      <p className="rpu-said" data-rp="official-line" lang={locale}>
        {line.text}
      </p>
      <TlNote>{w.page({ title: line.source.title, pageDate: pageDateWords(line.source.pageDate, locale) }, longDay(locale, line.source.reviewed))}</TlNote>
      <TlControls>
        <PlayPill href={line.source.url}>{w.open}</PlayPill>
      </TlControls>
    </TimelineItem>
  );
}
