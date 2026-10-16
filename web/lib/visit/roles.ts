/**
 * Mock role inference (deterministic; spec section 4, web-app.md section 8 "谁在说话").
 *
 * Who is speaking is decided per speaker cluster from what the lines say, never from the cluster number
 * (cluster 0 is the patient in one visit and the doctor in the next):
 *   - a line that is one of the session's required doctor lines (R1-R4, same words) -> that speaker (doctor)
 *   - patient cues: opens with "Doctor," / 医生，, Singlish particles (lah, leh), "can I record", "my daughter",
 *     我 + his own things, teach-back (对吗？)
 *   - clinician cues: addresses Mr Tan / 陈先生, instructions to "you", prescribing words, glossary drug + dose
 *   - a second clinician-like cluster in a clinic visit is the counter (dispenser); in a pharmacy visit the
 *     clinician is the pharmacist
 *   - with two clusters, once one side is known the other is the other side (elimination)
 * Roles from earlier chunks (priors) are kept unless the new lines contradict them strongly, so doctor and
 * patient do not swap half way through. Every result is "inferred" (or "unknown"); only the patient's own
 * confirmation in the after-visit review makes a role "confirmed".
 *
 * A transcript with no speaker labels at all (the real transcription service: lib/asr/whisper.ts) has no clusters to
 * tally: after the cues, the order and the form of the lines decide what is still open (a question and the reply to
 * it are two people; turnsWithoutSpeakers below). Still only ever "inferred".
 *
 * Pure; client-safe.
 */
import type { RoleState, UtteranceRole } from "@/lib/store/types";
import { hasHan, isAffirmative, isFollowUpCue, isQuestionInvite, isTeachBack, looksLikeQuestion, sameWords } from "./text";

export interface RoleLine {
  id: string;
  speaker_cluster: number | null;
  text: string;
}

export interface RequiredLineRef {
  text: string;
  speaker: UtteranceRole | null;
}

export interface RoleContext {
  /** visit.kind: "pharmacy" makes the clinician a pharmacist */
  visitKind: string;
  requiredLines: RequiredLineRef[];
  /** cluster -> role decided in earlier chunks */
  priors?: Map<number, UtteranceRole>;
}

export interface RoleResult {
  byLine: Map<string, { role: UtteranceRole; state: RoleState }>;
  clusters: Map<number, UtteranceRole>;
}

const PATIENT_CUES: { re: RegExp; w: number }[] = [
  { re: /^\s*(?:doctor|doc|dr)\b\s*[,，]/i, w: 3 },
  { re: /^\s*(?:医生|大夫|医师)[，,]/, w: 3 },
  { re: /\b(?:lah|leh|lor|meh|hor|liao)\b/i, w: 2 },
  { re: /\b(?:can|may) i record\b|\bmy (?:daughter|son|wife|knee|knees)\b|\bi feel\b|\bi forget\b|\bi think\b|\bi want to ask\b|\bthe app\b/i, w: 2 },
  { re: /我(?:家|的膝盖|膝盖|亲戚|常常|女儿|老婆|太太)|我想问/, w: 2 },
];

const CLINICIAN_CUES: { re: RegExp; w: number }[] = [
  { re: /\bmr\.?\s*tan\b|\bmrs\.?\s*tan\b|陈先生|陈太/i, w: 2 },
  {
    re: /\b(?:i want you to|we want it|we'll start|we will start|we keep|i'll add|i will add|come back|see me|take two readings|sit down|cut down|please don't|keep measuring|bring it|try not to|no need to|if you notice|tell me|these confirm|let me see|i took it)\b/i,
    w: 2,
  },
  { re: /\byour (?:blood pressure|reading|readings|medicine|tablet|dose|heart|kidneys)\b/i, w: 1 },
  { re: /每天早上吃|想起来就吃|不要一次吃|你拿去问|拿去问药剂师|饭前饭后都可以|买一个/, w: 2 },
];

const CLINICIANS: UtteranceRole[] = ["doctor", "dispenser", "pharmacist"];

export interface LineScore {
  patient: number;
  clinician: number;
  /** the line is a required doctor line (R1-R4) */
  required: UtteranceRole | null;
}

export function scoreLine(text: string, ctx: Pick<RoleContext, "requiredLines">): LineScore {
  let patient = 0;
  let clinician = 0;
  for (const c of PATIENT_CUES) if (c.re.test(text)) patient += c.w;
  for (const c of CLINICIAN_CUES) if (c.re.test(text)) clinician += c.w;
  if (isTeachBack(text)) patient += 2;
  const req = ctx.requiredLines.find((r) => sameWords(r.text, text));
  return { patient, clinician, required: req ? (req.speaker ?? "doctor") : null };
}

interface ClusterTally {
  cluster: number;
  firstIndex: number;
  patient: number;
  clinician: number;
  required: number;
  han: number;
  lines: number;
}

function clinicianRoleFor(visitKind: string, assigned: Map<number, UtteranceRole>): UtteranceRole {
  if (visitKind === "pharmacy") return "pharmacist";
  const roles = new Set(assigned.values());
  return roles.has("doctor") ? "dispenser" : "doctor";
}

/** Roles for every line (all lines of the chunk plus the recent context lines you pass in). */
export function inferRoles(lines: RoleLine[], ctx: RoleContext): RoleResult {
  const tallies = new Map<number, ClusterTally>();
  const scores = new Map<string, LineScore>();
  lines.forEach((l, i) => {
    const s = scoreLine(l.text, ctx);
    scores.set(l.id, s);
    if (l.speaker_cluster === null || l.speaker_cluster === undefined) return;
    const t =
      tallies.get(l.speaker_cluster) ??
      ({ cluster: l.speaker_cluster, firstIndex: i, patient: 0, clinician: 0, required: 0, han: 0, lines: 0 } as ClusterTally);
    t.patient += s.patient;
    t.clinician += s.clinician;
    if (s.required) t.required += 1;
    if (hasHan(l.text)) t.han += 1;
    t.lines += 1;
    tallies.set(l.speaker_cluster, t);
  });

  const assigned = new Map<number, UtteranceRole>();
  // 1. priors, unless contradicted strongly
  for (const [cluster, role] of ctx.priors ?? []) {
    const t = tallies.get(cluster);
    if (t) {
      if (role === "patient" && t.required > 0) continue;
      if (role !== "patient" && t.patient >= t.clinician + 4 + 3 * t.required) continue;
    }
    if (role !== "unknown") assigned.set(cluster, role);
  }

  // 2. clusters in order of first appearance
  const order = [...tallies.values()].sort((a, b) => a.firstIndex - b.firstIndex);
  const hasPatient = () => [...assigned.values()].includes("patient");
  for (const t of order) {
    if (assigned.has(t.cluster)) continue;
    const clinicianScore = t.clinician + 4 * t.required;
    if (t.patient > clinicianScore && !hasPatient()) {
      assigned.set(t.cluster, "patient");
    } else if (clinicianScore > t.patient) {
      assigned.set(t.cluster, t.required > 0 && ctx.visitKind !== "pharmacy" ? "doctor" : clinicianRoleFor(ctx.visitKind, assigned));
    }
  }

  // 3. elimination: two parties, one side known
  const seen = [...new Set([...tallies.keys(), ...(ctx.priors?.keys() ?? [])])];
  if (seen.length === 2) {
    const unknown = seen.filter((c) => !assigned.has(c));
    const known = seen.filter((c) => assigned.has(c));
    if (unknown.length === 1 && known.length === 1) {
      const other = assigned.get(known[0])!;
      assigned.set(unknown[0], other === "patient" ? clinicianRoleFor(ctx.visitKind, assigned) : "patient");
    }
  }

  // 4. per line
  const byLine = new Map<string, { role: UtteranceRole; state: RoleState }>();
  for (const l of lines) {
    const s = scores.get(l.id)!;
    let role: UtteranceRole = "unknown";
    if (l.speaker_cluster !== null && l.speaker_cluster !== undefined && assigned.has(l.speaker_cluster)) {
      role = assigned.get(l.speaker_cluster)!;
    } else if (s.required) {
      role = s.required;
    } else if (s.patient > s.clinician) {
      role = "patient";
    } else if (s.clinician > s.patient) {
      role = ctx.visitKind === "pharmacy" ? "pharmacist" : "doctor";
    }
    byLine.set(l.id, { role, state: role === "unknown" ? "unknown" : "inferred" });
  }

  // 5. a transcript with no speaker labels at all: who took which turn (below)
  if (lines.length > 0 && lines.every((l) => l.speaker_cluster === null || l.speaker_cluster === undefined)) turnsWithoutSpeakers(lines, scores, byLine, ctx);
  return { byLine, clusters: assigned };
}

// ------------------------------------------------------------------ no speaker labels: turns

/** He speaks of himself, or to the doctor by name. */
const FIRST_PERSON = /\b(?:i|i'm|i've|i'll|my|me)\b|我/i;
const SECOND_PERSON = /\b(?:you|your|you're|you've|you'll)\b|你|您/i;
const TO_THE_DOCTOR = /(?:^|[,，.。!！?？]\s*)(?:doctor|doc)\b\s*[,，.。!！?？]|(?:^|[，,。！？\s])(?:医生|大夫)[，,。！？]/i;
/** A sentence that names a dose or a tablet: said by the person who prescribes or hands it over, when nothing says "I". */
const DOSE_WORDS = /\b\d+(?:\.\d+)?\s*(?:mg|milligrams?)\b|\b(?:tablets?|pills?|capsules?)\b|毫克|粒/i;
/** How the clinic counter talks when it hands a medicine over (Mandarin, after the doctor has closed the visit). */
const COUNTER_CUES = /每天早上吃|想起来就吃|不要一次吃|拿去问药剂师|饭前饭后都可以|这是\s*[A-Za-z]/;
/** A question put to the other person (by its form); a teach-back (「……，对吗？」) is his own summary asking for a yes. */
const isQuestion = (text: string): boolean => looksLikeQuestion(text) && !isTeachBack(text);

/**
 * The real transcription service gives no speaker labels (lib/asr/whisper.ts: every line's speaker is null), so the
 * cues above decide line by line, and a line without a cue was nobody's: 「Yes, both together after breakfast is
 * fine.」 has no cue, so his 「Doctor, the two pills, can eat together?」 never met its answer (the sample third visit
 * without speakers paired none of its five questions and answers; web/progress/g.md).
 *
 * What such a transcript still has is the order of the lines and their form. For the lines the cues left unknown, in
 * order, each using what was decided for the line before it:
 *   - the clinician invites questions (「Anything else you want to ask?」): the clinician; from then on a question that
 *     is not put to "you" is his;
 *   - a question that says "I" / "my" / 「我」 or speaks to the doctor by name is his; one put to "you" is the
 *     clinician's; one right after he spoke, or right before a line that is his by its own cues, is the clinician's;
 *     one right before a line that is the clinician's by its own cues is his;
 *   - the line after a question is the other person's reply: after his question the clinician's (never when the line
 *     has a cue of his own), after the clinician's question his;
 *   - the short yes after his teach-back (「……，对吗？」 「对。」) is the clinician's;
 *   - the clinician goes on: after a clinician's statement, a line that names a dose or a tablet and does not say "I";
 *   - at a clinic, once the doctor has said when to come back, a clinician's Mandarin line in the counter's words is
 *     the counter's, and so are the clinician's lines after it (the cluster rule's "second clinician" has no cluster
 *     to go by here).
 * Every role found this way is "inferred", like every other guess: the review still asks him about each line, a
 * medicine line still never reads 「医生说」 before he says so, and an answer is only ever the transcript's own next
 * line, word for word (lib/visit/extract.ts answeredQuestion, lib/visit/questions.ts): a question nobody replied to
 * stays without one. A line that fits none of these stays unknown and is his to claim in the review.
 *
 * Only for a transcript in which no line has a speaker: with speaker labels nothing here runs.
 */
function turnsWithoutSpeakers(lines: RoleLine[], scores: Map<string, LineScore>, byLine: Map<string, { role: UtteranceRole; state: RoleState }>, ctx: RoleContext): void {
  const pharmacy = ctx.visitKind === "pharmacy";
  let clinician: UtteranceRole = pharmacy ? "pharmacist" : "doctor";
  /** the role a line has by its own words alone (steps 1-4) */
  const byCues = (i: number): UtteranceRole => byLine.get(lines[i].id)!.role;
  const cued = lines.map((_, i) => byCues(i));
  let asking = false;
  let closed = false;
  let prev: { role: UtteranceRole; question: boolean; teachBack: boolean } | null = null;
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].text;
    const s = scores.get(lines[i].id)!;
    const question = isQuestion(text);
    let role = cued[i];
    if (role === "unknown") {
      if (isQuestionInvite(text)) role = clinician;
      // the yes to his teach-back (「每天早上一粒，没感觉也要吃，对吗？」 「对。」)
      else if (prev?.teachBack && prev.role === "patient" && isAffirmative(text) && s.patient === 0) role = clinician;
      else if (question) {
        const first = FIRST_PERSON.test(text) || TO_THE_DOCTOR.test(text);
        const second = SECOND_PERSON.test(text);
        const next = i + 1 < lines.length ? cued[i + 1] : "unknown";
        if (first && !second) role = "patient";
        else if (second && !first) role = clinician;
        else if (asking) role = "patient";
        else if (next === "patient" || prev?.role === "patient") role = clinician;
        else if (isClinician(next)) role = "patient";
      } else if (prev?.question && prev.role === "patient" && s.patient === 0) role = clinician;
      else if (prev?.question && isClinician(prev.role) && s.clinician === 0) role = "patient";
      else if (prev && isClinician(prev.role) && !prev.question && s.patient === 0 && DOSE_WORDS.test(text) && !FIRST_PERSON.test(text)) role = clinician;
    }
    // the counter, after the doctor closed the visit (a clinic visit; the pharmacist is the pharmacy's only clinician)
    if (!pharmacy && clinician === "doctor" && closed && isClinician(role) && hasHan(text) && COUNTER_CUES.test(text)) clinician = "dispenser";
    if (isClinician(role)) {
      // (a required line keeps the speaker the session gave it)
      if (!s.required) role = clinician;
      if (isQuestionInvite(text)) asking = true;
      if (isFollowUpCue(text) && !question) closed = true;
    }
    if (role !== cued[i]) byLine.set(lines[i].id, { role, state: role === "unknown" ? "unknown" : "inferred" });
    prev = role === "unknown" ? null : { role, question, teachBack: isTeachBack(text) };
  }
}

export const isClinician = (role: UtteranceRole | null | undefined): boolean => !!role && CLINICIANS.includes(role);
