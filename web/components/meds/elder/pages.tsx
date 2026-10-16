/**
 * The server halves of his medicine pages on a real account (C2 track F), laid out as the timeline draft's 06 and 08
 * screens: /p/meds (06-6), /p/meds/add (06-3 to 06-5, 08-1a to 08-2: AddFlow.tsx) and /p/meds/[id] (06-7 the card,
 * 06-8 the explain card at ?view=why, 06-9 the checklist at ?view=check, 08-3 the card of a box nobody identified).
 * The demo keeps its own pages unchanged. Every clinical line comes from lib/meds/card.ts and lib/explain/card.ts
 * (lib/safety's sources and three checks); the words here are lib/meds/account-copy.ts. Server-only.
 *
 * A section of the card is a line of entries (components/ui Timeline). The node of an entry is its source: the purple
 * ring for what the doctor, the counter or the pharmacist said (dashed while it is only Ripple's guess), the ink
 * square for the label and the leaflet, his own mark for what he changed. The head line next to it says so in words,
 * with the date and the time point the back end gives (lib/meds/chips.ts chipDetailText: nothing is re-worded here).
 */
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { Box, Button, Chevron, LabelOriginal, ListCard, ListItem, PageHeader, PlayPill, PrimaryButton, Said, Screen, SecondaryButton, SectionTitle, TabBar, Timeline, TimelineItem, TlControls, TlNote, type ListMarkKind } from "@/components/ui";
import { isCrewPage } from "@/lib/crew/gate";
import { shortDay } from "@/lib/daily/i18n";
import { aiConsent } from "@/lib/safety/consent";
import { samplesAllowed } from "@/lib/store/scope";
import { buildExplainCard } from "@/lib/explain/card";
import type { ExplainLine } from "@/lib/explain/types";
import { understandingView } from "@/lib/explain/understanding";
import { addFlowTargets } from "@/lib/meds/add-targets";
import { slotTimeQuestions } from "@/lib/meds/slot-times";
import { buildMedCardView } from "@/lib/meds/card";
import { chipDetailText } from "@/lib/meds/chips";
import { mt } from "@/lib/meds/i18n";
import { listMedGroups } from "@/lib/meds/list";
import { medsNow } from "@/lib/meds/on-day";
import { fieldWords, mx, patientStatusWords, slotWords, statusWords, type MedsLocale } from "@/lib/meds/account-copy";
import { MED_ORIGINS, type CardChip, type CardLine, type MedListItem, type StoredLabel } from "@/lib/meds/types";
import { medFullName } from "@/lib/meds/write";
import { questionList } from "@/lib/profile/questions";
import { slotTimes } from "@/lib/profile/reminder-times";
// owner 10-14: 「记录」 holds his medicines (app/p/records): the way back to it
import { RECORDS_HREF, rc } from "@/lib/records/copy";
import type { DaySlot, MedStatus } from "@/lib/store/types";
import type { PageSubject } from "@/lib/subject";
import { readAloudOffered } from "@/lib/tts";
import { uiCopy } from "@/lib/ui/copy";
import type { NodeKind } from "@/lib/ui/tokens";
import { OneAudio } from "@/components/visit/elder/OneAudio";
// owner 10-14: each medicine can be held for Ripple's read of it (components/explain/Explainable.tsx)
import { Explainable } from "@/components/explain/Explainable";
import { SayBarLinks } from "@/components/daily/elder/SayBarLinks";
import { pageZh } from "@/components/translate/DoctorZh";
import { TRANSLATION_LABEL } from "@/lib/translate/label";
import { AddFlow, type KnownMed } from "./AddFlow";
import { ScanBox } from "./ScanBox";
import { Checklist, ListenLine, ReadCardAloud, UnknownChoices } from "./CardParts";
import "./meds.css";

type Speaker = "doctor" | "dispenser" | "pharmacist";
const SPEAKERS = new Set(["doctor", "dispenser", "pharmacist"]);
const LABEL_OK: readonly MedStatus[] = ["label_confirmed", "pharmacist_checked"];

const langOf = (text: string): MedsLocale => (/\p{Script=Han}/u.test(text) ? "zh-Hans" : "en");

/** Who an entry comes from, in words: 「医生说」, 「好像是柜台说的」, 「药袋上写着」, 「单张写着」, 「你的记录」, 「录音」. */
function whoOf(chip: CardChip, locale: MedsLocale): string {
  const copy = uiCopy(locale);
  if (SPEAKERS.has(chip.kind)) {
    if (chip.inferred) return locale === "en" ? `Maybe the ${chip.kind === "dispenser" ? "clinic counter" : chip.kind}` : `好像是${chip.kind === "doctor" ? "医生" : chip.kind === "dispenser" ? "柜台" : "药剂师"}说的`;
    return copy.sources[chip.kind as Speaker];
  }
  if (chip.kind === "label") return copy.sources.label;
  if (chip.kind === "leaflet") return copy.sources.leaflet;
  if (chip.kind === "records") return mt(locale, "chip.records");
  if (chip.kind === "recording") return mt(locale, "chip.recording");
  return copy.sources.ripple;
}

/** The node an entry is drawn with (lib/ui/tokens.ts NODE_KINDS). */
function nodeOf(chip: CardChip): NodeKind {
  if (SPEAKERS.has(chip.kind)) return chip.inferred ? "unc" : "doc";
  if (chip.kind === "label" || chip.kind === "leaflet") return "lab";
  if (chip.kind === "records") return "me";
  if (chip.kind === "recording") return "dot";
  return "rip";
}

/**
 * Where and when, after the words that say who: the back end's own line (visit date and time point, label date,
 * leaflet site). A stand-in voice is said by the 「代录音」 tag next to the play pill when the entry has one, so the
 * words are not on the screen twice.
 */
function metaOf(chip: CardChip, locale: MedsLocale, opts: { listen?: boolean; extra?: string | null } = {}): string | undefined {
  const detail = chipDetailText(locale, opts.listen ? { ...chip, standInVoice: false } : chip);
  return [detail, opts.extra].filter(Boolean).join(" · ") || undefined;
}

interface Clip {
  url: string;
  standIn: boolean;
}

/**
 * The checked Chinese under a clinician's English words, as the timeline draws it: the Chinese in the serif face with
 * a rule on its left, then the line that says which one counts. The translation is track S's (its lookup for the page,
 * components/translate/DoctorZh.tsx pageZh: the Chinese page only, only with his consent to AI processing, only a
 * translation that passed both checks) and so is the label's wording; nothing is translated here.
 */
async function ZhLine({ text, locale }: { text: string | null; locale: MedsLocale }) {
  if (!text || locale !== "zh-Hans") return null;
  const zh = (await pageZh(locale))(text);
  if (!zh) return null;
  return (
    <>
      <p className="rpu-said-zh" data-rp="said-translation" data-testid="card-translation" lang="zh-Hans">
        {zh}
      </p>
      <p className="rpu-said-note">{TRANSLATION_LABEL["zh-Hans"]}</p>
    </>
  );
}

/**
 * One line of a card as an entry of its section: a clinician's words in the serif face with the checked Chinese under
 * English and the play pill; the label's line with its printed words in the dashed mono frame; the leaflet's line
 * with the way to its source; anything else in the sans face.
 */
function LineEntry({
  line,
  locale,
  testId,
  clip = null,
  sourceUrl = null,
  frame,
  metaExtra = null,
  attrs,
}: {
  line: Pick<CardLine, "text" | "chip" | "sourceId"> & Partial<Pick<CardLine, "secondLine" | "secondIsOriginal">>;
  locale: MedsLocale;
  testId: string;
  clip?: Clip | null;
  sourceUrl?: string | null;
  frame?: "card";
  metaExtra?: string | null;
  attrs?: Record<`data-${string}`, string | number | undefined>;
}) {
  const chip = line.chip;
  const speaker = SPEAKERS.has(chip.kind);
  const all = { "data-source": line.sourceId, "data-chip": chip.kind, ...attrs } as Record<`data-${string}`, string | number | undefined>;
  if (speaker) {
    const lang = langOf(line.text);
    return (
      <TimelineItem
        node={nodeOf(chip)}
        who={whoOf(chip, locale)}
        meta={metaOf(chip, locale, { listen: !!clip })}
        // a line he has not confirmed yet sits in the dashed frame, as in the review (the draft's 05-4)
        frame={frame ?? (chip.inferred ? "dash" : undefined)}
        testId={testId}
        attrs={all}
        actions={clip ? <ListenLine url={clip.url} kind={chip.kind as Speaker} standIn={clip.standIn} locale={locale} /> : undefined}
      >
        <Said lang={lang} source={{ kind: chip.kind as Speaker, ref: line.sourceId }}>
          {lang === "en" ? "“" : "「"}
          {line.text}
          {lang === "en" ? "”" : "」"}
        </Said>
        {/* C2 track S (round 2): the checked Chinese under a clinician's English words (real-app 12) */}
        <ZhLine text={lang === "en" ? line.text : null} locale={locale} />
      </TimelineItem>
    );
  }
  if (chip.kind === "label") {
    return (
      <TimelineItem node="lab" who={whoOf(chip, locale)} meta={metaOf(chip, locale, { extra: metaExtra })} frame={frame} testId={testId} attrs={all}>
        {line.secondIsOriginal ? (
          <p className="rpu-said" data-rp="label-line">
            {line.text}
          </p>
        ) : null}
        <LabelOriginal>{line.secondIsOriginal && line.secondLine ? line.secondLine : line.text}</LabelOriginal>
      </TimelineItem>
    );
  }
  if (chip.kind === "leaflet") {
    const url = sourceUrl ?? chip.url ?? null;
    return (
      <TimelineItem
        node="lab"
        who={whoOf(chip, locale)}
        meta={metaOf(chip, locale)}
        frame={frame}
        testId={testId}
        attrs={all}
        actions={
          url ? (
            <TlControls>
              <PlayPill href={url}>{mx(locale, "card.openSource")}</PlayPill>
            </TlControls>
          ) : undefined
        }
      >
        <p className="rpu-said" data-rp="leaflet-line">
          {line.text}
        </p>
        {line.secondLine ? <TlNote>{line.secondLine}</TlNote> : null}
      </TimelineItem>
    );
  }
  return (
    <TimelineItem node={nodeOf(chip)} who={whoOf(chip, locale)} meta={metaOf(chip, locale)} frame={frame} testId={testId} attrs={all} say={line.text} note={line.secondLine ?? undefined} />
  );
}

/**
 * The mark of a medicine's row: checked against its label, typed in by him, or still waiting (the draft's 06-6). Also
 * the mark of his medicines' rows on 「记录」 (app/p/records/page.tsx).
 */
export function markOf(m: Pick<MedListItem, "status">): ListMarkKind {
  if (LABEL_OK.includes(m.status)) return "ok";
  if (m.status === "unverified") return "me";
  return "miss";
}

// ------------------------------------------------------------------ /p/meds (06-6)

export async function AccountMedsPage({ ctx, locale }: { ctx: PageSubject; locale: MedsLocale }) {
  const groups = await listMedGroups(ctx.store, ctx.session.id, ctx.session.story_day, locale, ctx.session.story_time);
  const all = groups.flatMap((g) => g.items);
  const awaiting = all.filter((m) => m.status === "awaiting_label");
  const sep = locale === "en" ? "; " : "；";
  return (
    // owner 10-14: his medicines are a page under 「记录」 (/p/records): its tab in the bar, and the way back to it
    <Screen locale={locale} tabBar={<TabBar active="records" locale={locale} />} tabBarPlacement="fixed" sayBar={<SayBarLinks locale={locale} />}>
      <OneAudio />
      <PageHeader
        back={{ href: RECORDS_HREF, label: rc(locale, "title") }}
        title={mx(locale, "list.title")}
        subtitle={all.length ? mx(locale, "list.count", { n: all.length }) : undefined}
        locale={locale}
      />
      <div className="rpu-stack" data-testid="meds-list" data-count={all.length}>
        {all.length === 0 ? (
          <Box variant="dash" title={mx(locale, "list.empty")} testId="meds-empty" />
        ) : null}
        {/* scene 3 (owner 10-15): one of his boxes photographed -> how to take it, in a sheet over this page; first on it */}
        {all.length ? <ScanBox locale={locale} addHref="/p/meds/add" testId="meds-scan" /> : null}
        {/* a medicine the doctor prescribed waits for its label: said first, with the way to photograph it */}
        {awaiting.length ? (
          <div className="rpu-btns">
            <Box variant="acc" title={awaiting.map((m) => mx(locale, "list.awaiting", { name: m.name })).join(sep)} testId="meds-awaiting" />
            <PrimaryButton icon="camera" href={`/p/meds/add?med=${encodeURIComponent(awaiting[0].id)}`} nav="forward" data-testid="meds-photo-awaiting">
              {mx(locale, "add.forMed", { name: awaiting[0].name })}
            </PrimaryButton>
          </div>
        ) : null}
        {/* where each medicine came from: every group is there once he has a medicine, an empty one says 「还没有」 */}
        {all.length
          ? MED_ORIGINS.map((origin) => {
              const items = groups.find((g) => g.origin === origin)?.items ?? [];
              return (
                <ListCard key={origin} heading={mt(locale, `origin.${origin}`)} testId={`meds-group-${origin}`}>
                  {items.length ? (
                    items.map((m) => {
                      const when = m.slots?.length && m.status !== "unidentified" ? mx(locale, "list.slots", { slots: slotWords(locale, m.slots) }) : null;
                      const fullName = [m.name, m.strength].filter(Boolean).join(" ");
                      return (
                        <Explainable key={m.id} as="row" subject={{ type: "med", ref: m.id }} locale={locale} label={fullName}>
                          <ListItem
                            mark={markOf(m)}
                            title={<span translate="no">{fullName}</span>}
                            // the Chinese generic name, and under it when he takes it (two short lines: the row is narrow)
                            sub={[m.zhName, when].filter(Boolean).join("\n") || undefined}
                            // in its own span: the English words wrap at their spaces (meds.css), so the name keeps its room
                            right={<span className="rpu-meds-status">{m.patientStatus ? patientStatusWords(locale, m.patientStatus) : statusWords(locale, m.status)}</span>}
                            chevron
                            href={`/p/meds/${encodeURIComponent(m.id)}`}
                            testId={`med-row-${m.id}`}
                            attrs={{ "data-status": m.status, "data-typed": m.typed ? "true" : "false" }}
                          />
                        </Explainable>
                      );
                    })
                  ) : (
                    <ListItem title={mx(locale, "list.none")} dim />
                  )}
                </ListCard>
              );
            })
          : null}
        {/* one way in to adding a medicine: typing it in is offered on the camera screen, and is where this goes with
            AI processing off; a visit is the bottom bar's tab (owner's tidy of 10-13) */}
        <div className="rpu-btns">
          {all.length === 0 ? (
            <PrimaryButton icon="camera" href="/p/meds/add" nav="forward" data-testid="meds-photo">
              {mx(locale, "list.photo")}
            </PrimaryButton>
          ) : (
            <SecondaryButton icon="camera" href="/p/meds/add" nav="forward" data-testid="meds-photo">
              {mx(locale, "list.photo")}
            </SecondaryButton>
          )}
        </div>
      </div>
    </Screen>
  );
}

// ------------------------------------------------------------------ /p/meds/add (06-3 to 06-5, 08-1a to 08-2)

export async function AccountAddPage({
  ctx,
  locale,
  medParam,
  manual,
  next,
  fromOnboard = false,
}: {
  ctx: PageSubject;
  locale: MedsLocale;
  medParam: string | null;
  manual: boolean;
  next: string | null;
  /** opened from setting up his account (real-app 2.5 「去拍药袋」) */
  fromOnboard?: boolean;
}) {
  const med = medParam ? await ctx.store.getMed(ctx.session.id, medParam) : null;
  const forMed = med && med.drug_id ? { id: med.id, name: medFullName(med, locale), origin: med.origin, drugId: med.drug_id } : null;
  // 「以后再说」: back where he came from (setting up: the next screen; ?next=: that page), else his medicines
  const { laterHref, returnHref } = addFlowTargets({ next, fromOnboard, onboarding: ctx.session.onboarding });
  // C2 track J (filming): the sample labels for the example account, and for a filming account on a crew phone
  const samples = samplesAllowed(ctx.session, ctx.session.filming === true && (await isCrewPage()));
  // his consent to AI processing: off means no photo is read (POST /api/labels/read answers 403 ai_off); he types it
  const aiOff = !(await aiConsent(ctx.store, ctx.session));
  // the slots whose reminder time nothing says yet: asked once, when the medicine he adds uses one (real-app 2.16;
  // track C's reminder times: lib/meds/slot-times.ts is only the add flow's glue around lib/profile/reminder-times.ts)
  const askTimes = slotTimeQuestions(ctx.session, locale);
  // when each part of his day is reminded now, for 「→ 早上提醒（8:45）」 under the label's own time words (06-4a)
  const slotFirst = Object.fromEntries(slotTimes(ctx.session).map((t) => [t.slot, t.first])) as Partial<Record<DaySlot, string>>;
  // the medicines he has whose label is checked: the same bag photographed again is said so before anything is asked
  // (06-4b); a page opened for one medicine's label does not need them
  const known: KnownMed[] = forMed
    ? []
    : (await medsNow(ctx.store, ctx.session))
        .filter((m) => !!m.drug_id && LABEL_OK.includes(m.status))
        .map((m) => ({ id: m.id, drugId: m.drug_id!, origin: m.origin, dispensed: m.label?.dispensed ?? null, clinic: m.label?.clinic ?? null, name: medFullName(m, locale) }));
  return <AddFlow locale={locale} forMed={forMed} samples={samples} manual={manual} laterHref={laterHref} returnHref={returnHref} aiOff={aiOff} askTimes={askTimes} slotFirst={slotFirst} known={known} />;
}

// ------------------------------------------------------------------ /p/meds/[id] (06-7, 06-8, 06-9, 08-3)

/** The parts of one medicine's page: the card itself, the explain card, the checklist. */
export type MedCardView = "card" | "why" | "check";

/** The leaflet's points by what they are about (the draft's sections); a point of any other kind stays under 「单张上说」. */
const LEAFLET_SECTIONS = [
  { topic: "missed", key: "card.sec.missed" },
  { topic: "stopping", key: "card.sec.stopping" },
  { topic: "common_side_effects", key: "card.sec.side" },
  { topic: "grapefruit", key: "card.sec.grapefruit" },
] as const;
/** `<source>:<drug>.<topic>` -> the topic (web/kb/patient_text.json ids). */
const topicOf = (l: Pick<CardLine, "sourceId">) => l.sourceId.split(".").pop() ?? "";

/**
 * One part of a medicine's card under its own title. ux pass 10-12 (round 6): the card was one long page, so a part
 * opens and closes on a tap of its title (the browser's own <details>: no script, and a reader hears whether it is
 * open). Only 「怎么吃」 starts open. The way to the explain card is not in a part: it is a row between 「怎么吃」 and
 * 「为什么吃」 (owner's tidy of 10-13).
 */
function Section({ title, testId, open = false, children }: { title: string; testId?: string; open?: boolean; children: ReactNode }) {
  return (
    <details className="rp06-fold" data-testid={testId} open={open}>
      <summary className="rp06-fold-sum">
        <SectionTitle>{title}</SectionTitle>
        <span className="rp06-fold-mark" aria-hidden="true">
          <Chevron />
        </span>
      </summary>
      <div className="rpu-stack rp06-fold-body">{children}</div>
    </details>
  );
}

export async function AccountMedCardPage({ ctx, locale, medId, view = "card" }: { ctx: PageSubject; locale: MedsLocale; medId: string; view?: MedCardView }) {
  const store = ctx.store;
  const med = await store.getMed(ctx.session.id, medId);
  if (!med) notFound();
  const [card, explain] = await Promise.all([
    buildMedCardView(store, ctx.session.id, med, { day: ctx.session.story_day, locale }),
    buildExplainCard(store, ctx.session.id, med, { day: ctx.session.story_day, locale }),
  ]);
  const understanding = explain ? await understandingView(store, ctx.session.id, med.id) : null;
  const label = med.label as StoredLabel | null;
  const unknown = card.status === "unidentified" || !card.drugId;
  const here = `/p/meds/${encodeURIComponent(card.medId)}`;
  const fullName = [card.name, card.strength].filter(Boolean).join(" ");
  // owner 10-14: the card is under 「记录」 in the bar (its way back stays 「‹ 我的药物」, the list it belongs to)
  const tabs = <TabBar active="records" locale={locale} />;
  /** the clip of a line the explain card also holds (the doctor's reason), and the leaflet's page of a restatement */
  const clipOf = (sourceId: string): Clip | null => explain?.lines.find((l) => l.sourceId === sourceId)?.clip ?? null;
  const urlOf = new Map([...card.purpose, ...card.leaflet].filter((l) => l.chip.url).map((l) => [l.sourceId, l.chip.url!]));

  // ---- 06-8: the explain card 「为什么没感觉也要吃」, a screen of its own
  if (view === "why" && explain) {
    // 「读给我听」 only when a real voice can speak (real-app 2.17, 6.10; lib/tts: one rule for every read-aloud button)
    const readAloud = readAloudOffered("account");
    return (
      <Screen locale={locale} tabBar={tabs} tabBarPlacement="fixed">
        <OneAudio />
        <PageHeader back={{ href: here, label: fullName }} title={mx(locale, "card.explain")} locale={locale} />
        <div className="rpu-stack" data-testid="med-card" data-view="why" data-med={card.medId} data-status={card.status}>
          {/* 「读给我听」: this card's own sentences, read by a real voice (never the mock's tones) */}
          {readAloud ? <ReadCardAloud medId={card.medId} locale={locale} /> : null}
          <section data-testid="card-explain">
            <Timeline>
              {explain.lines.map((l: ExplainLine) => (
                <LineEntry key={l.sourceId} line={l} locale={locale} testId="explain-line" clip={l.clip} sourceUrl={urlOf.get(l.sourceId) ?? null} attrs={{ "data-kind": l.kind }} />
              ))}
            </Timeline>
          </section>
          {understanding ? (
            <Button variant="link" href={`${here}?view=check`} data-testid="card-check-open">
              {mx(locale, "card.checkOpen")}
              <Chevron />
            </Button>
          ) : null}
        </div>
      </Screen>
    );
  }

  // ---- 06-9: the understanding checklist, a screen of its own
  if (view === "check" && explain && understanding) {
    return (
      <Screen locale={locale} tabBar={tabs} tabBarPlacement="fixed">
        <OneAudio />
        <PageHeader back={{ href: here, label: fullName }} title={mx(locale, "card.check")} subtitle={mx(locale, "card.checkSub")} locale={locale} />
        <div className="rpu-stack" data-testid="med-card" data-view="check" data-med={card.medId} data-status={card.status}>
          <Checklist medId={card.medId} locale={locale} initial={understanding} />
        </div>
      </Screen>
    );
  }

  // ---- 06-7 (and 08-3): the card
  const slots = card.slots;
  const status = card.patientStatus ? patientStatusWords(locale, card.patientStatus) : statusWords(locale, card.status);
  const dispensed = !unknown && label?.dispensed ? mx(locale, "card.dispensed", { date: shortDay(locale, label.dispensed) }) : null;
  const food = card.leaflet.filter((l) => topicOf(l) === "food");
  const sectioned = LEAFLET_SECTIONS.map((s) => ({ ...s, lines: card.leaflet.filter((l) => topicOf(l) === s.topic) })).filter((s) => s.lines.length);
  const other = card.leaflet.filter((l) => topicOf(l) !== "food" && !LEAFLET_SECTIONS.some((s) => s.topic === topicOf(l)));
  const slotLine = slots?.slots.length ? mx(locale, slots.source === "label" ? "card.slots.label" : "card.slots.patient", { slots: slotWords(locale, slots.slots) }) : mx(locale, "card.slots.none");
  // a box nobody identified: its question for the pharmacist, the answer's clip (the question list's own reader), and
  // whether his question for the doctor is still on the list
  const q = unknown ? card.question : null;
  let answerClip: Clip | null = null;
  let doctorOnList = false;
  if (unknown) {
    const list = q?.answer || label?.doctor_question_id ? await questionList(store, ctx.session, locale).catch(() => null) : null;
    const listed = list ? [...list.open, ...list.answered, ...list.skipped] : [];
    const a = q?.answer ? listed.find((x) => x.id === q.id)?.answer : null;
    if (a?.clipUrl && q?.answer && a.text.trim() === q.answer.text.trim()) answerClip = { url: a.clipUrl, standIn: a.standIn };
    // the question he added with 「带去给医生看」: on the list unless he set it aside there
    doctorOnList = !!label?.doctor_question_id && (!list || listed.some((x) => x.id === label.doctor_question_id && x.status !== "skipped"));
  }

  return (
    <Screen locale={locale} tabBar={tabs} tabBarPlacement="fixed" sayBar={<SayBarLinks locale={locale} />}>
      <OneAudio />
      <PageHeader
        back={{ href: "/p/meds", label: mx(locale, "card.back") }}
        title={
          // the card's head: holding the medicine's name opens Ripple's read of it (owner 10-14)
          <Explainable as="inline" subject={{ type: "med", ref: card.medId }} locale={locale} label={fullName}>
            <span translate="no">{fullName}</span>
          </Explainable>
        }
        subtitle={
          <>
            {card.zhName ? (
              <>
                <span data-testid="med-zh-name" lang="zh-Hans">
                  {card.zhName}
                </span>
                {" · "}
              </>
            ) : null}
            {mt(locale, `origin.${card.origin}`)}
            <br />
            {[status, dispensed].filter(Boolean).join(" · ")}
          </>
        }
        locale={locale}
      />
      <div className="rpu-stack" data-testid="med-card" data-view="card" data-med={card.medId} data-status={card.status}>
        {card.awaitingLabel ? (
          <div className="rpu-btns">
            <Box variant="acc" title={mx(locale, "card.awaitingTitle")} testId="med-awaiting">
              {mx(locale, "card.awaitingBody")}
            </Box>
            <PrimaryButton icon="camera" href={`/p/meds/add?med=${encodeURIComponent(card.medId)}`} nav="forward" data-testid="med-photograph">
              {mx(locale, "add.forMed", { name: card.name })}
            </PrimaryButton>
          </div>
        ) : null}
        {card.typed ? <Box variant="dash" title={mx(locale, "card.typed")} testId="med-typed" /> : null}

        {unknown ? (
          <>
            {/* the fixed sentence, the answer once the pharmacist gave it, his question on the list; then what he does with
                it, his own choice, as two large buttons under what was said (ux pass 10-12, round 6; the canvas screen 08-3) */}
            <section data-testid="med-unknown">
              <Timeline>
                {card.unknown.map((l) => (
                  <TimelineItem
                    key={l.sourceId}
                    node="rip"
                    testId="med-unknown-sentence"
                    say={
                      <>
                        <span lang="en">{l.text}</span>
                        {l.secondLine ? (
                          <>
                            {"\n"}
                            {l.secondLine}
                          </>
                        ) : null}
                      </>
                    }
                  />
                ))}
                {q?.answer ? <LineEntry line={q.answer} locale={locale} testId="med-question-answer" clip={answerClip} frame="card" /> : null}
              </Timeline>
            </section>
            {q ? (
              <div data-testid="med-question" data-status={q.status}>
                <ListCard>
                  <ListItem
                    mark={q.status === "answered" ? "ok" : "todo"}
                    title={q.text}
                    sub={`${mt(locale, "card.questionFor")} · ${mt(locale, q.status === "answered" ? "card.questionAnswered" : "card.questionOpen")}`}
                    chevron
                    href="/p/questions"
                  />
                </ListCard>
              </div>
            ) : null}
            <UnknownChoices medId={card.medId} locale={locale} initial={card.patientStatus ?? null} onListInitially={doctorOnList} look="buttons" />
          </>
        ) : null}

        {!unknown ? (
          <Section title={mx(locale, "card.howToTake")} testId="card-how-to-take" open>
            <Timeline>
              <TimelineItem node="sch" title={slotLine} testId="med-slots" attrs={{ "data-slots": slots?.slots.join(",") ?? "", "data-source": slots?.source ?? "none" }} />
              {card.howToTake.map((l) => (
                <LineEntry key={l.sourceId} line={l} locale={locale} testId="card-line" metaExtra={label?.clinic ?? null} />
              ))}
              {food.map((l) => (
                <LineEntry key={l.sourceId} line={l} locale={locale} testId="card-line" />
              ))}
            </Timeline>
            {/* what he changed while checking the label: his words, never the label's */}
            {card.edited?.length ? (
              <div data-testid="med-edited">
                <Timeline>
                  {card.edited.map((e) => (
                    <TimelineItem key={e.field} node="me" who={mx(locale, "card.edited")} attrs={{ "data-field": e.field }} say={`${fieldWords(locale, e.field)}${locale === "en" ? ": " : "："}${e.value}`} />
                  ))}
                </Timeline>
              </div>
            ) : null}
          </Section>
        ) : null}

        {/* the explain card is a screen of its own (06-8), from the day the doctor said why. Its entry is a row of its
            own under 「怎么吃」, seen without opening anything (owner's tidy of 10-13: it was inside 「为什么吃」) */}
        {card.purpose.length && explain ? (
          <Button variant="link" href={`${here}?view=why`} data-testid="card-explain-open">
            {mx(locale, "card.explain")}
            <Chevron />
          </Button>
        ) : null}

        {/* 「为什么吃」 comes after 「怎么吃」 (ux pass 10-12, round 6) and starts closed */}
        {card.purpose.length ? (
          <Section title={mx(locale, "card.purpose")} testId="card-purpose">
            <Timeline>
              {card.purpose.map((l) => (
                <LineEntry key={l.sourceId} line={l} locale={locale} testId="card-line" clip={clipOf(l.sourceId)} />
              ))}
            </Timeline>
            {/* the checklist is a screen of its own (06-9), from the day the doctor said why */}
            {explain && understanding ? (
              <div className="rpu-btns">
                <Button variant="link" href={`${here}?view=check`} data-testid="card-check-open">
                  {mx(locale, "card.checkOpen")}
                  <Chevron />
                </Button>
              </div>
            ) : null}
          </Section>
        ) : null}

        {sectioned.length || other.length ? (
          <div className="rpu-stack" data-testid="card-leaflet">
            {sectioned.map((s) => (
              <Section key={s.topic} title={mx(locale, s.key)}>
                <Timeline>
                  {s.lines.map((l) => (
                    <LineEntry key={l.sourceId} line={l} locale={locale} testId="card-line" />
                  ))}
                </Timeline>
              </Section>
            ))}
            {other.length ? (
              <Section title={mx(locale, "card.leaflet")}>
                <Timeline>
                  {other.map((l) => (
                    <LineEntry key={l.sourceId} line={l} locale={locale} testId="card-line" />
                  ))}
                </Timeline>
              </Section>
            ) : null}
          </div>
        ) : null}

        {/* 「问这个」: his own question about this medicine goes on the list (the question list's own screen) */}
        {!unknown ? (
          <Button variant="outline" href="/p/questions/add" nav="forward" data-testid="card-ask">
            {mx(locale, "card.ask")}
          </Button>
        ) : null}
      </div>
    </Screen>
  );
}
