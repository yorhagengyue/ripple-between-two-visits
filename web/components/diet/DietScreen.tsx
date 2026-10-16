/**
 * 饮食 (journey 13; 老人端提示词 13; M16), drawn as the timeline draft's 13-1 (web/progress/fe-1113.md): every block is a
 * section title and a line of nodes, and the node says where each sentence is from. The server page hands it the screen
 * (lib/diet/view.ts) and draws the header. Nothing on this screen holds state of its own but the day's question
 * (DietCheck, a client component: after his answer the page's server data is read again).
 *
 *   the doctor's words   first: each line word for word on the doctor's node (「医生说 · 8月31日 · 0:42」, serif, the
 *                        checked Chinese under English words, 「听原声」 when there is a recording); on the same line
 *                        the day's question (DietCheck, mode "screen": only while there is such a line) and the last 7
 *                        days' answers in words. No line of the doctor's about food yet: one dashed entry says so
 *   a special diet       kidney disease or heart failure recorded: the back end's fixed referral to his doctor or a
 *                        dietitian comes first, in the box with the accent border; otherwise it is the last block
 *   official lines       for each condition recorded about him: a section 「官方的饮食条目：高血压」, each line on the
 *                        node of a written source with its publisher, the page's title and date, the day it was checked
 *                        and the pill that opens the official page (OfficialEntry). Nothing recorded the knowledge base
 *                        has lines for: a dashed box says why nothing is listed
 *   grapefruit           only the leaflet's line, only while amlodipine is on his list
 *   his hawker dishes    a button to the screen where he picks them (13-2: components/diet/DietFoods; an account only)
 *   「问医生」           under the referral, on an account: the way to add a question in his own words (the question
 *                        list knows a doctor and a pharmacist; it has no dietitian to file a question under)
 * Ripple writes none of these sentences (the referral is the back end's fixed one); nothing here says what he must eat.
 *
 * Test hooks: diet-screen, diet-doctor-line, diet-nodoctor, diet-week, diet-special (data-first), diet-ask-doctor,
 * diet-condition (data-condition), diet-line (data-line, data-url), diet-grapefruit, diet-nocondition, diet-foods-open;
 * the dishes' own (diet-food, diet-picked, diet-error) are on the dishes' screen.
 */
import { BodyText, Box, Chevron, PlayPill, SecondaryButton, SectionTitle, Timeline, TimelineItem, TlControls } from "@/components/ui";
import { askCopy } from "@/components/daily/ask-copy";
import type { DietView } from "@/lib/diet/view";
import type { Locale } from "@/lib/i18n";
import { DIET_WORDS } from "./copy";
import { DietCheck } from "./DietCheck";
import { DoctorWords, SourceHead } from "./DoctorWords";
import { OfficialEntry, pageDateWords } from "./OfficialEntry";
import "./diet.css";

/** Where the diet screen's button to his own dishes goes (the same route, its second screen). */
export const DIET_FOODS_HREF = "/p/diet?view=foods";

export function DietScreen({
  view,
  locale,
  askHref,
}: {
  view: DietView;
  locale: Locale;
  /** where 「问医生」 goes (an account's 「加一个问题」); none: no such button (a demo session has no such screen) */
  askHref?: string;
}) {
  const w = DIET_WORDS[locale];
  const copy = askCopy(locale);

  const special = (
    <div className="fe13-pair" data-testid="diet-special" data-first={view.special.first ? "true" : "false"}>
      {view.special.first ? <Box variant="acc" title={view.special.text} /> : <Box variant="line">{view.special.text}</Box>}
      {askHref ? (
        <SecondaryButton href={askHref} data-testid="diet-ask-doctor">
          {w.askDoctor}
        </SecondaryButton>
      ) : null}
    </div>
  );

  // the doctor's other lines about food (older visits), entries of the same line
  const others = view.doctor.slice(1).map((d) => (
    <TimelineItem key={`${d.visitId}:${d.utteranceId}`} node="doc" testId="diet-doctor-line">
      <SourceHead kind="doctor" node="doc" who={copy.doctorSaid} when={`${d.date} · ${d.at}`} />
      <DoctorWords line={d} locale={locale} translationTestId="diet-doctor-translation" />
    </TimelineItem>
  ));
  // the last 7 days' answers, counts only (the same line the brief carries)
  const week = view.week ? (
    <TimelineItem node="dot" who={w.week} testId="diet-week">
      <BodyText>{view.week}</BodyText>
    </TimelineItem>
  ) : null;
  const leafletDate = view.grapefruit ? pageDateWords(view.grapefruit.source.pageDate, locale) : null;

  return (
    <div className="rpu-stack" data-testid="diet-screen">
      {view.special.first && special}

      <div className="fe13-section">
        <SectionTitle>{w.doctor}</SectionTitle>
        {view.check ? (
          <DietCheck data={view.check} locale={locale} mode="screen" more={others} after={week} />
        ) : (
          <Timeline>
            <TimelineItem node="miss" title={w.noDoctor} testId="diet-nodoctor" />
          </Timeline>
        )}
      </div>

      {view.conditions.map((c) => (
        <div key={c.id} className="fe13-section" data-testid="diet-condition" data-condition={c.id}>
          <SectionTitle>{w.official(c.name)}</SectionTitle>
          <Timeline>{c.lines.length ? c.lines.map((l) => <OfficialEntry key={l.id} line={l} locale={locale} />) : <TimelineItem node="miss" title={w.noLines} />}</Timeline>
        </div>
      ))}
      {view.noCondition && !view.special.first && (
        <Box variant="dash" testId="diet-nocondition">
          {w.noCondition}
        </Box>
      )}

      {view.grapefruit && (
        <div className="fe13-section" data-testid="diet-grapefruit">
          <SectionTitle>{w.grapefruit}</SectionTitle>
          <Timeline>
            <TimelineItem node="lab">
              <SourceHead kind="leaflet" node="lab" who={w.leaflet} tail={w.leafletTitle(view.grapefruit.source.title)} when={leafletDate ? w.leafletDate(leafletDate) : undefined} />
              <p className="rpu-said" data-rp="leaflet-line" lang={locale}>
                {view.grapefruit.text}
              </p>
              <TlControls>
                <PlayPill href={view.grapefruit.source.url}>{w.open}</PlayPill>
              </TlControls>
            </TimelineItem>
          </Timeline>
        </div>
      )}

      {!view.special.first && view.foods.canPick && (
        <SecondaryButton href={DIET_FOODS_HREF} data-testid="diet-foods-open">
          {w.foodsOpen}
          <Chevron />
        </SecondaryButton>
      )}

      {!view.special.first && special}
    </div>
  );
}
