/**
 * 「拍药盒，看怎么吃」 / "Scan a medicine box" (scene 3 of the owner's film, 10-15: an elder with three or four
 * medicines has forgotten how much of each to take; he photographs one box and Ripple says how to take it and what it
 * is for, then shows what his doctor said about it as words he can choose to play). Server-only.
 *
 *   read     the photo goes through the label reader of the add flow (lib/meds/write.ts readLabel: lib/vision, the
 *            parser, the two-reads check, his consent to AI processing, the event log); the transcription never leaves
 *            the server. Nothing is written to his medicines.
 *   match    matchScan (pure): the medicine the label names (the kb's matcher) among HIS medicines now
 *            (lib/meds/on-day.ts medsNow), a checked label first. Never by the printed date.
 *              his        the same medicine; the same strength and directions that say the same (or were not read)
 *              differs    the same medicine with another strength, or directions that say something else than the label
 *                         he checked: said plainly, and nothing of how to take either label is shown
 *              not_his    a medicine Ripple knows that is not on his list: said plainly; he may add it or ask the pharmacist
 *              unknown    nobody can tell which medicine it is: lib/safety's fixed sentence; add it, or ask the pharmacist
 *   the sheet (his) only lines the medicine's own card shows (lib/meds/card.ts builds them from lib/safety's sources and
 *            puts each through its three checks), so nothing goes beyond the label, the leaflet and the doctor's words:
 *              how        the directions of the label he checked. In English its own words with ordinary capitals and the
 *                         words the label printed in capitals in bold ("Take ONE tablet every MORNING" -> "Take **one**
 *                         tablet every **morning**": lib/safety counts that the same quote, it ignores only case); in
 *                         华语 lib/safety's slot template with the label's own words under it, or the label's words where
 *                         there is no template. Then when he takes it (its slots, the words of his medicine list) and
 *                         where it comes from (his pharmacy label, its clinic)
 *              purpose    the leaflet's line of what it is for, with its source (kb/patient_text.json `<drug>.purpose`);
 *                         none where the knowledge base has none (nothing is written here)
 *              doctor     what his doctor said about why he takes it, at a visit (the card's doctor lines: R3 for his
 *                         amlodipine), the visit's date, and the recorded line's clip (lib/explain/card.ts, as the
 *                         medicine's page plays it): words on the screen; the sound only when he taps it
 * No dose advice of the app's own: a box that is not his, or not the same as his label, gets no directions at all.
 */
import type { Locale } from "@/lib/i18n";
import { doseSlotsOf } from "@/lib/daily/slots";
import { buildExplainCard } from "@/lib/explain/card";
import { getDrug } from "@/lib/kb/load";
import { TEMPLATES } from "@/lib/safety";
import { attributionPrefixZh } from "@/lib/safety/zh";
import { sameQuote } from "@/lib/safety/text";
import type { DaySlot, MedicationRow } from "@/lib/store/types";
import { mx, slotWords } from "./account-copy";
import { buildMedCardView } from "./card";
import { chipDetailText } from "./chips";
import { mt } from "./i18n";
import { medsNow } from "./on-day";
import { labelSlots, parseStrength } from "./parse-label";
import type { CardLine, LabelFields, LabelSlots } from "./types";
import { medDisplayName, readLabel, type MedsDeps } from "./write";
import { zhGenericName } from "./zh-names";

export type ScanOutcome = "his" | "differs" | "not_his" | "unknown";

const LABEL_OK: readonly MedicationRow["status"][] = ["label_confirmed", "pharmacist_checked"];
const SPEAKERS = new Set(["doctor", "dispenser", "pharmacist"]);

// ---------------------------------------------------------------- match (pure)

export interface ScanMatch {
  outcome: ScanOutcome;
  /** his medicine the box is (his, differs), else null */
  med: MedicationRow | null;
  /** what is not the same as on his label (differs only) */
  differs: "strength" | "directions" | null;
}

/** "5 mg", "5MG", "5.0 mg" -> "5mg"; null when there is no strength. */
function strengthKey(s: string | null | undefined): string | null {
  const p = parseStrength(s ?? null);
  return p ? p.replace(/\s+/g, "").toLowerCase() : null;
}

const slotKey = (s: LabelSlots) => [s.quantity ?? "", s.unit ?? "", s.time ?? "", s.frequency ?? ""].join("|");

/**
 * Two directions lines that say the same: the same words (case, spacing and the final mark aside), or the same
 * quantity, unit, time and frequency (lib/safety's closed vocabulary) where both have all of the first two.
 */
export function sameDirections(a: string, b: string): boolean {
  if (sameQuote(a, b)) return true;
  const x = labelSlots(a);
  const y = labelSlots(b);
  return !!(x.quantity && x.unit && y.quantity && y.unit) && slotKey(x) === slotKey(y);
}

/** Which of his medicines the box is, if any (see the header). `meds`: his medicines now. */
export function matchScan(fields: Pick<LabelFields, "drug_id" | "strength" | "directions">, meds: readonly MedicationRow[]): ScanMatch {
  if (!fields.drug_id) return { outcome: "unknown", med: null, differs: null };
  const same = meds.filter((m) => m.drug_id === fields.drug_id && m.status !== "unidentified");
  if (!same.length) return { outcome: "not_his", med: null, differs: null };
  const read = strengthKey(fields.strength);
  const score = (m: MedicationRow) =>
    (read && strengthKey(m.label?.strength) === read ? 4 : 0) + (LABEL_OK.includes(m.status) ? 2 : 0) + (m.origin === "prescription" ? 1 : 0);
  const med = [...same].sort((a, b) => score(b) - score(a))[0];
  const mine = strengthKey(med.label?.strength);
  if (read && mine && read !== mine) return { outcome: "differs", med, differs: "strength" };
  const directions = med.label?.directions?.trim();
  if (fields.directions && directions && !sameDirections(fields.directions, directions)) return { outcome: "differs", med, differs: "directions" };
  return { outcome: "his", med, differs: null };
}

// ---------------------------------------------------------------- the words (pure)

/** A run of the big sentence: the label's own words, `strong` where the label printed them in capitals. */
export interface ScanRun {
  text: string;
  strong: boolean;
}

/**
 * The label's directions as plain words: each word printed in capitals ("ONE", "MORNING", "AFTER") in ordinary letters
 * and marked strong, the first letter of the line a capital; nothing else changes (lib/safety's same-quote test ignores
 * only case, so the line is still the label's own words). Shorthand in capitals (OM, BD, PRN ...) is left as printed.
 */
export function plainLabelRuns(directions: string): ScanRun[] {
  const KEEP = /^(?:OM|ON|BD|BID|TDS|TID|QID|OD|PRN|HS|AC|PC|STAT|NSAIDS?|LDL|HDL)$/;
  const runs: ScanRun[] = [];
  const push = (text: string, strong: boolean) => {
    const last = runs.at(-1);
    if (last && last.strong === strong) last.text += text;
    else runs.push({ text, strong });
  };
  for (const piece of directions.trim().split(/(\s+)/)) {
    if (!piece) continue;
    const word = /^([A-Za-z]{2,})(.*)$/.exec(piece);
    if (word && word[1] === word[1].toUpperCase() && !KEEP.test(word[1])) {
      push(word[1].toLowerCase(), true);
      if (word[2]) push(word[2], false);
    } else push(piece, false);
  }
  const first = runs[0];
  if (first) first.text = first.text.charAt(0).toUpperCase() + first.text.slice(1);
  return runs;
}

// ---------------------------------------------------------------- the sheet

export interface ScanHow {
  /** the big sentence, in runs (see plainLabelRuns); in 华语 the template is one run */
  runs: ScanRun[];
  lang: "en" | "zh-Hans";
  /** the label's own words under a Mandarin template (null when the big sentence is those words) */
  printed: string | null;
  /** when he takes it, in the words of his medicine list ("Morning · as the label says") */
  when: string;
  slots: DaySlot[];
  /** the clinic on his label */
  clinic: string | null;
  /** lib/safety's source id of the label line (label:<medId>) */
  sourceId: string;
}

export interface ScanPurpose {
  text: string;
  sourceId: string;
  /** the leaflet's page, and its site and status in words ("healthhub.sg · draft wording") */
  url: string | null;
  meta: string;
}

export interface ScanDoctorLine {
  text: string;
  /** the language the words were said in */
  lang: "en" | "zh-Hans";
  sourceId: string;
  /** the visit's date (YYYY-MM-DD) */
  date: string | null;
  /** the visit's date and the point in the recording, in words ("1 Sep · at 0:20") */
  meta: string;
  /** Ripple's guess of who said it, not confirmed by him */
  inferred: boolean;
  /** the recorded line: played only when he taps it */
  clip: { url: string; standIn: boolean } | null;
}

export interface ScanView {
  outcome: ScanOutcome;
  /**
   * what the photo names: the kb's name, the printed medicine line, and the fields the reader returned as the add flow
   * gets them from POST /api/labels/read (directions only for a medicine the kb knows; never the raw transcription). The
   * sheet shows the name; the rest is for checking the reader (directions of a box that is not his are never shown)
   */
  read: { name: string | null; strength: string | null; printed: string | null; directions: string | null; dispensed: string | null; clinic: string | null; warnings: string[] };
  /** his medicine (his, differs) */
  med: { id: string; name: string; strength: string | null; zhName: string | null } | null;
  differs: "strength" | "directions" | null;
  /** one plain sentence for differs, not_his and unknown (lib/safety's fixed sentence for unknown) */
  say: string | null;
  how: ScanHow | null;
  /** his label has no directions (a box he bought himself): said so instead of `how` */
  noDirections: boolean;
  purpose: ScanPurpose | null;
  doctor: ScanDoctorLine[];
  /** the question for the pharmacist he may put on his list (not_his, unknown): his words in a fixed frame */
  question: string | null;
  /** which reader read the photo ("deepseek", "mock:vision-cassette"; never a key) */
  provider: string;
}

const hasHan = (t: string) => /\p{Script=Han}/u.test(t);

/** The card's label line as the big sentence (it passed lib/safety's checks on the card). */
function howFrom(line: CardLine, med: MedicationRow, slots: { slots: DaySlot[]; source: string | null }, locale: Locale): ScanHow | null {
  const directions = med.label?.directions?.trim();
  if (!directions) return null;
  const when = slots.slots.length
    ? mx(locale, slots.source === "patient" ? "card.slots.patient" : "card.slots.label", { slots: slotWords(locale, slots.slots) })
    : mx(locale, "card.slots.none");
  const base = { when, slots: slots.slots, clinic: med.label?.clinic ?? null, sourceId: line.sourceId };
  // 华语 with lib/safety's slot template: the template (its lead-in off: the section says it is the label), the label's words under it
  if (line.secondIsOriginal && hasHan(line.text)) {
    const prefix = attributionPrefixZh("label");
    const text = line.text.startsWith(prefix) ? line.text.slice(prefix.length) : line.text;
    return { ...base, runs: [{ text, strong: false }], lang: "zh-Hans", printed: line.secondLine ?? directions };
  }
  // the label's own words (English, or 华语 without a template): only when the checked line is them
  if (!sameQuote(line.text, directions)) return null;
  return { ...base, runs: plainLabelRuns(directions), lang: "en", printed: null };
}

/** The sheet for his medicine: the card's own lines (see the header). */
async function hisSheet(deps: MedsDeps, sessionId: string, med: MedicationRow, locale: Locale, day: number): Promise<Pick<ScanView, "how" | "noDirections" | "purpose" | "doctor">> {
  const store = deps.store;
  const [card, explain, scope] = await Promise.all([
    buildMedCardView(store, sessionId, med, { day, locale }),
    buildExplainCard(store, sessionId, med, { day, locale }),
    store.getSession(sessionId),
  ]);
  const slots = scope ? doseSlotsOf(scope, med) : { slots: [] as DaySlot[], source: null };
  const line = card.howToTake[0];
  const how = line ? howFrom(line, med, slots, locale) : null;
  const leaflet = card.purpose.find((l) => l.chip.kind === "leaflet") ?? null;
  const clips = new Map((explain?.lines ?? []).filter((l) => l.clip).map((l) => [l.sourceId, l.clip!]));
  const doctor: ScanDoctorLine[] = card.purpose
    .filter((l) => SPEAKERS.has(l.chip.kind))
    .map((l) => {
      const clip = clips.get(l.sourceId) ?? null;
      return {
        text: l.text,
        lang: hasHan(l.text) ? "zh-Hans" : "en",
        sourceId: l.sourceId,
        date: l.chip.date ?? null,
        // a stand-in voice is said next to the play button, so not here as well
        meta: chipDetailText(locale, clip ? { ...l.chip, standInVoice: false } : l.chip),
        inferred: !!l.chip.inferred,
        clip: clip ? { url: clip.url, standIn: clip.standIn } : null,
      };
    });
  return {
    how,
    noDirections: !med.label?.directions?.trim(),
    purpose: leaflet ? { text: leaflet.text, sourceId: leaflet.sourceId, url: leaflet.chip.url ?? null, meta: chipDetailText(locale, leaflet.chip) } : null,
    doctor,
  };
}

/**
 * Read the photo at `path` (uploaded through POST /api/upload-url, kind label), match it to his medicines, and build the
 * sheet. Throws what readLabel throws (MedsError label_unreadable, ai_off, photo_not_found, photo_not_in_session).
 */
export async function scanBox(input: { sessionId: string; path: string; locale: Locale }, deps: MedsDeps): Promise<ScanView> {
  const { sessionId, locale } = input;
  const read = await readLabel({ sessionId, path: input.path }, deps);
  const session = (await deps.store.getSession(sessionId))!;
  const meds = await medsNow(deps.store, session);
  const m = matchScan(read.fields, meds);
  const drug = read.fields.drug_id ? getDrug(read.fields.drug_id) : null;
  const readName = drug ? medDisplayName({ drug_id: drug.id, label: null }, locale) : null;
  const view: ScanView = {
    outcome: m.outcome,
    read: {
      name: readName,
      strength: read.fields.strength,
      printed: read.fields.drug_text,
      directions: read.fields.directions,
      dispensed: read.fields.dispensed,
      clinic: read.fields.clinic,
      warnings: read.warnings ?? [],
    },
    med: m.med ? { id: m.med.id, name: medDisplayName(m.med, locale), strength: m.med.label?.strength ?? null, zhName: zhGenericName(m.med.drug_id) } : null,
    differs: m.differs,
    say: null,
    how: null,
    noDirections: false,
    purpose: null,
    doctor: [],
    question: null,
    provider: read.provider,
  };
  const full = (name: string | null, strength: string | null) => [name, strength].filter(Boolean).join(" ");
  if (m.outcome === "his" && m.med) {
    Object.assign(view, await hisSheet(deps, sessionId, m.med, locale, session.story_day));
  } else if (m.outcome === "differs" && m.med) {
    const name = medDisplayName(m.med, locale);
    view.say =
      m.differs === "strength"
        ? mx(locale, "scan.differsStrength", { read: full(readName, read.fields.strength), name, mine: m.med.label?.strength ?? "" })
        : mx(locale, "scan.differsDirections", { name });
  } else if (m.outcome === "not_his") {
    const name = full(readName, read.fields.strength);
    view.say = mx(locale, "scan.notHis", { name });
    view.question = mx(locale, "scan.questionNotHis", { name });
  } else {
    const t = TEMPLATES.unknown_med;
    view.say = locale === "zh-Hans" ? t.zh : t.en;
    // the add flow's own question for a box nobody identified (lib/meds/write.ts), with the name as printed
    view.question = mt(locale, "question.unknown", { name: read.fields.drug_text?.trim() || mt(locale, "name.unknown") });
  }
  return view;
}

