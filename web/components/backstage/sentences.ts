/**
 * One plain English sentence per backstage event (task M8 item 1), written from the event's own data, plus what the
 * view highlights: sentences the safety layer blocked (which layer and why), role-state changes, and scripted
 * fallback. Every event type published anywhere in web/lib and web/app has its own renderer here
 * (tests/unit/backstage/sentences.test.ts greps the publish calls and fails when a type has none); an unknown type
 * still shows the event's own `say`. Pure and client-safe.
 *
 * C2 (real-status "导演台和评委页"; judges read these on /demo): plain words only. No program names or codes in a
 * sentence (no rule:…, no utterance ids such as v3-u06, no visit ids: "the third visit"); a scene by its plain title,
 * never the director's stage direction ("Hero shot"); counts with the right plural. Codes stay in the raw data.
 */
import { DRILL_SENTENCE } from "@/lib/crew/drill-words";
import type { BusEvent } from "@/lib/bus";
import { plainBeat } from "@/lib/crew/story";

export type EventTone = "blocked" | "role" | "fallback" | "plain";

export interface EventLine {
  sentence: string;
  tone: EventTone;
  /** short badge text for highlighted rows ("Blocked · layer 2", "Who said it", "Scripted fallback") */
  badge?: string;
  /** the plain-words reasons of a block */
  why?: string[];
}

type Data = Record<string, unknown>;
type Renderer = (e: BusEvent, d: Data) => EventLine;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Data => (v && typeof v === "object" && !Array.isArray(v) ? (v as Data) : {});

function clip(text: string, n = 90): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}
const quote = (text: string | null, n = 90) => (text ? `“${clip(text, n)}”` : "");

/** Safety-layer reason codes in plain words (lib/safety/verify.ts, classify.ts). */
export const REASON_WORDS: Record<string, string> = {
  unknown_source: "it cites no source Ripple was given",
  span_not_in_source: "the quoted part is not in the source",
  quote_not_verbatim: "it is not the source's own words",
  chinese_not_from_source: "its Chinese is not from the source",
  zh_not_from_template: "its Mandarin is not a reviewed template",
  template_mismatch: "it claims to be a template but is not",
  do_not_display_number: "it has a phone number that is never shown",
  drug_not_in_span: "it names a medicine the source does not",
  number_not_in_span: "it has a number the source does not",
  unit_not_in_span: "it has a unit the source does not",
  frequency_not_in_span: "it has a frequency the source does not",
  time_not_in_span: "it has a time the source does not",
  declared_slot_not_in_glossary: "it uses a word outside the glossary",
  directive_not_restate: "it is an instruction, not a restatement",
  directive_without_attribution: "it is an instruction with nobody named",
  attribution_mismatch: "it names the wrong speaker",
  directive_span_not_instruction: "it turns a non-instruction into an instruction",
  directive_not_verbatim: "it is an instruction in Ripple's own words",
  judgement_word: "it has a judgement word (high, normal, fine…)",
  // layer 3 (lib/safety/verify.ts layer3): the checker is a different model from the same vendor as the main model
  // (hy4-preview next to hy3, 10-16), never a second vendor; see checkerName below
  no_checker: "it needs the checker model and none is configured",
  checker_not_supported: "the checker model said its source does not support it",
  checker_error: "the checker model failed or timed out",
};

/**
 * What the checker model behind lib/llm's default Hunyuan checker (HUNYUAN_CHECKER_MODEL, hy4-preview) is called
 * here. This module is client-safe and cannot import lib/llm; tests/unit/backstage/sentences.test.ts ties the two.
 */
export const HUNYUAN_CHECKER_NAME = "Hy4 preview";

/**
 * The layer-3 checker as the crew reads it, from the event's own `checker` (the checker client's provider, published
 * with verify.layer3 by lib/safety/pipeline.ts): "the checker model (Hy4 preview)" on the judge link (10-16:
 * hy4-preview checks hy3, same vendor, different model; /how says so), the replayed or offline
 * stand-in in rehearsal and tests, the provider's own name for any other checker, and no name when none is configured. A
 * Hunyuan checker is named after the default model; CHECKER_MODEL can point it elsewhere, which the event does not say.
 */
export function checkerName(provider: unknown): string {
  const p = str(provider);
  if (!p) return "the checker model";
  const replayed = p.startsWith("replay:");
  const base = replayed ? p.slice("replay:".length) : p;
  const name = base === "hunyuan" ? HUNYUAN_CHECKER_NAME : base === "mock" ? "offline stand-in" : base;
  return `the checker model (${name}${replayed ? ", replayed" : ""})`;
}

/** "rule:dose_change" and topic tags of a refused request, in plain words. */
function ruleWords(code: string): string {
  const c = code.replace(/^rule:/, "");
  const known: Record<string, string> = {
    dose_change: "asks to change the dose",
    stop: "asks to stop a medicine",
    stopping: "asks to stop a medicine",
    combination: "asks about taking medicines together",
    injection: "tries to give Ripple instructions",
    prompt_injection: "tries to give Ripple instructions",
    // track S's newer rules
    special_diet: "asks what to eat with a long-term condition (for his doctor or a dietitian)",
    off_topic: "small talk Ripple has nothing for",
    // read from his own question list before any model is asked (lib/safety/pipeline.ts ownListRule)
    answered_before: "repeats a question of his that a clinician answered at a visit",
    asked_before: "repeats a question that is already waiting on his list",
  };
  return known[c] ?? c.replace(/_/g, " ");
}

/** Plain words for reason codes, each said once ("rule:dose_change" and the topic "dose_change" read the same). */
export function reasonWords(codes: unknown[]): string[] {
  return [...new Set(codes.filter((c): c is string => typeof c === "string").map((c) => REASON_WORDS[c] ?? ruleWords(c)))];
}

const ROLE_WORDS: Record<string, string> = {
  doctor: "doctor",
  dispenser: "clinic counter",
  pharmacist: "pharmacist",
  patient: "Mr Tan",
  family: "Wei Ling",
  unknown: "nobody known",
};

/** A visit as the backstage reads it: the story's visits by their place in the story, any other one as "the visit". */
const VISIT_NAMES: Record<string, string> = { v1: "the first visit", v2: "the second visit", p1: "the pharmacy visit", v3: "the third visit" };
export function visitName(id: unknown): string {
  if (typeof id !== "string") return "the visit";
  if (VISIT_NAMES[id]) return VISIT_NAMES[id];
  // C2: a visit of the story watched again on the demo (a replay copy, "<visit>-again-<n>": lib/visit/pipeline.ts)
  const again = /^([a-z0-9]+)-again-[a-z0-9]+$/.exec(id);
  return again && VISIT_NAMES[again[1]] ? `${VISIT_NAMES[again[1]]} (watched again)` : "the visit";
}

/** What the safety layer sorted a message as (lib/safety/types.ts Route), in plain words. */
const ROUTE_WORDS: Record<string, string> = {
  explain: "a question Ripple can answer from its sources",
  refuse_route: "a request that is not Ripple's to answer",
  unknown_med: "a medicine Ripple cannot identify",
  emergency: "an emergency",
  self_harm: "words about self-harm",
  log_only: "something to note, not a question",
  logistics: "a practical question",
  // track S (10-10): off-topic small talk (weather, lottery, news, sports, markets, jokes) gets a fixed sentence
  cant_help: "small talk Ripple does not take up",
  uncertain: "unclear",
};
const routeWords = (route: unknown): string => {
  const r = str(route);
  return r ? (ROUTE_WORDS[r] ?? r.replace(/_/g, " ")) : "unclear";
};

/**
 * Who sorted it, from the route's reason ("rule:dose_change", "model:…", a crisis screen's raise, the notes the pipeline
 * appends), in plain words. "rules only" stays in the words when the rules answered alone.
 */
function sortedBy(reason: unknown): string {
  const r = str(reason) ?? "";
  let who: string;
  if (/by the crisis screen/.test(r) || /model_crisis:[^;]*:(emergency|self_harm)/.test(r)) who = "raised by the crisis check";
  else if (/by crisis words/.test(r)) who = "raised by its crisis words (no crisis check ran)";
  else if (r.startsWith("rule:")) {
    const code = r.slice(5).split(/[;\s(]/)[0];
    const words = ruleWords(code);
    who = words === code.replace(/_/g, " ") ? "by a fixed rule" : `by a fixed rule (it ${words})`;
  } else if (r.startsWith("model")) who = "by the main model";
  else who = "by the rules";
  if (/cost guard[^;]*rules only/.test(r)) return `${who}; rules only: the question limit was reached`;
  if (/rules only/.test(r)) return `${who}; rules only: the crisis check could not run`;
  return who;
}

const VISIT_CHECK_WORDS: Record<string, string> = { bp: "blood pressure", doses: "medicine days", dose: "medicine days", ankle: "ankle", meds: "medicines" };

function layerCounts(e: BusEvent, d: Data, name: string): EventLine {
  const rows = arr(d.sentences).map(obj);
  const ran = rows.filter((r) => r.ran === true);
  const passed = ran.filter((r) => r.pass === true).length;
  const blocked = ran.filter((r) => r.pass === false);
  if (e.type === "verify.layer3" && ran.length > 0 && ran.every((r) => r.needed === false)) {
    return { sentence: `${name}: not needed, every sentence is a quote, a leaflet line or a template.`, tone: "plain" };
  }
  if (ran.length === 0) return { sentence: `${name}: nothing to check.`, tone: "plain" };
  const why = [...new Set(blocked.flatMap((r) => reasonWords(arr(r.reasons))))];
  return {
    sentence: `${name}: ${passed} of ${ran.length} sentences passed${blocked.length ? `, ${blocked.length} stopped` : ""}.`,
    tone: blocked.length ? "blocked" : "plain",
    // only the first letter lowered: "Stopped at layer 3, the checker model (Hy4 preview)" keeps the model's name
    ...(blocked.length ? { badge: `Stopped at ${name.charAt(0).toLowerCase()}${name.slice(1)}`, why } : {}),
  };
}

function personOf(d: Data): string {
  const role = str(d.role) ?? str(obj(d.member).role) ?? "patient";
  return role === "patient" ? "Mr Tan" : role === "family" ? "Wei Ling" : role === "judge" ? "A judge" : `The ${role}`;
}

function questionLine(d: Data, verb: string): EventLine {
  const q = obj(d.question);
  const text = str(q.text);
  const who = str(q.for) === "pharmacist" ? "the pharmacist" : "the doctor";
  const und = obj(d.understanding);
  if (str(und.item)) {
    const label = str(und.label) ?? str(und.item)!.replace(/_/g, " ");
    return { sentence: `Understanding check: he is not sure about “${label}”, so ${quote(text)} is on his questions for ${who}.`, tone: "plain" };
  }
  if (d.reused === true) return { sentence: `Already on today's questions for ${who}${text ? `: ${quote(text)}` : ""}.`, tone: "plain" };
  if (str(d.pattern)) return { sentence: `${verb} a question from a pattern in his log${text ? `: ${quote(text)}` : ""}.`, tone: "plain" };
  return { sentence: `${verb} a question for ${who}${text ? `: ${quote(text)}` : ""}.`, tone: "plain" };
}

const cap = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;
/** A sentence's full stop, unless it already ends with one ("…one more tablet?" stays as it is). */
const stop = (s: string) => (/[.?!。？！]$/.test(s) ? s : `${s}.`);

/** A medicine as the crew reads it: its name and strength, never the row id; an unidentified one says so. */
function medName(m: Data): string {
  const drug = str(m.drug_id);
  if (drug) {
    const strength = str(obj(m.label).strength);
    return `${cap(drug)}${strength ? ` ${strength}` : ""}`;
  }
  if (str(m.origin) === "relative") return "the relative's box (not identified)";
  return Object.keys(m).length ? "a medicine Ripple cannot identify" : "a medicine";
}

/**
 * med.changed, by its `kind` (lib/meds/write.ts, lib/meds/answers.ts). A label read shows only what the publisher's
 * own line shows (the printed name, the match): the rest of the label stays on the server.
 */
function medChanged(d: Data): EventLine {
  const med = obj(d.med);
  const fields = obj(d.fields);
  switch (str(d.kind)) {
    case "label.read_failed":
      return { sentence: `A label photo could not be read${str(d.code) ? ` (${str(d.code)!.replace(/_/g, " ")})` : ""}; his medicine list did not change.`, tone: "plain" };
    case "label.read": {
      const printed = str(fields.drug_text) ? quote(str(fields.drug_text), 60) : "the printed name";
      const drug = str(fields.drug_id);
      return {
        sentence: drug
          ? `Label photo read: ${printed} matches ${cap(drug)}${str(fields.match) ? ` (${str(fields.match)} match)` : ""}; waiting for him to confirm.`
          : `Label photo read: ${printed} is not a medicine Ripple can identify; waiting for him to confirm.`,
        tone: "plain",
      };
    }
    case "label.confirmed":
      return {
        sentence:
          str(d.outcome) === "label_confirmed"
            ? `He confirmed the label: ${medName(med)} is ${d.created === true ? "now on" : "updated in"} his medicine list.`
            : str(d.outcome) === "unidentified"
              ? "He confirmed the label photo: Ripple cannot identify this medicine, so it is saved as unidentified."
              : "He confirmed a label photo.",
        tone: "plain",
      };
    case "label.relabel":
      return { sentence: `${cap(medName(med))}: a new box, so its label is to be photographed again.`, tone: "plain" };
    // C2 track F, round three (only add): he changed his answer in the visit's review, the prescription leaves his list
    case "prescription_withdrawn":
      return { sentence: `He took back that the doctor prescribed ${medName(med)}: it is off his medicine list (it was still waiting for its label).`, tone: "plain" };
    case "answer.linked": {
      const visit = str(obj(med.pharmacist_answer).visit_id);
      return {
        sentence: visit ? `The pharmacist's answer from ${visitName(visit)} is saved with ${medName(med)}.` : `An answer from a visit is linked to the question about ${medName(med)}.`,
        tone: "plain",
      };
    }
    default:
      return { sentence: `His medicine list changed${str(med.drug_id) || str(med.origin) ? `: ${medName(med)}` : ""}.`, tone: "plain" };
  }
}

const VISIT_STATUS_WORDS: Record<string, string> = {
  recording: "recording",
  transcribing: "making the full transcript",
  review: "the full record is ready, waiting for his check",
  confirmed: "he confirmed the record",
  awaiting_transcript: "the recording is saved, waiting for the transcription service",
  planned: "a planned visit, not happened yet",
};

// ---- the real app's events (C2 foundation F1): content-free sentences, written from ids, kinds and counts only

/** Who a family link is to him, in plain words ("his daughter"), from the link's relation; never her name or id. */
function linkWho(d: Data): string {
  const rel = str(obj(d.link).relation) ?? str(d.relation);
  return rel ? `his ${rel.replace(/_/g, " ")}` : "a family member";
}

const CARE_LINK_WORDS: Record<string, (who: string) => string> = {
  "care_link.invited": (who) => `He invited ${who} to see what he shares; the invitation waits for them to accept.`,
  "care_link.accepted": (who) => `${cap(who)} accepted his invitation; nothing is shared until he confirms it is them.`,
  "care_link.confirmed": (who) => `He confirmed ${who}: sharing starts with the switches he chose.`,
  "care_link.declined": (who) => `He said the person who accepted is not ${who}; the invitation is void.`,
  "care_link.revoked": (who) => `He stopped sharing with ${who}; their page no longer shows anything of his.`,
  "care_link.left": (who) => `${cap(who)} left: they no longer see what he shares.`,
};

const CONSENT_WORDS: Record<string, string> = {
  terms_privacy: "the terms and privacy notice",
  ai_processing: "AI processing of what he says",
  visit_recording: "recording this visit",
  family_share: "sharing with family",
  family_accept: "seeing a family member's summary",
  family_reset_helper: "family help with a forgotten password",
  retention_keep_forever: "keeping a visit recording",
  example_data: "the example data",
};

function consentLine(d: Data): EventLine {
  const kind = str(d.kind);
  const what = kind ? (CONSENT_WORDS[kind] ?? kind.replace(/_/g, " ")) : "a consent";
  const decision = str(d.decision);
  const verb = decision === "withdrawn" ? "withdrew consent to" : decision === "declined" ? "declined" : decision === "granted" ? "gave consent to" : "answered about";
  return { sentence: `${decision ? `He ${verb}` : "A consent was recorded for"} ${what}${str(d.version) ? ` (text ${str(d.version)})` : ""}.`, tone: "plain" };
}

function countOf(d: Data, key: string): number | null {
  const n = num(d[key]);
  return n !== null ? n : Array.isArray(d[key]) ? (d[key] as unknown[]).length : null;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function pushLine(e: BusEvent, d: Data): EventLine {
  const kind = str(d.kind);
  const what = kind ? kind.replace(/_/g, " ") : "a reminder";
  switch (e.type) {
    case "push.subscribed":
      return { sentence: "This phone can now receive Ripple's reminders as notifications.", tone: "plain" };
    case "push.unsubscribed":
      return { sentence: "This phone no longer receives Ripple's notifications.", tone: "plain" };
    case "push.opened":
      return { sentence: `A notification (${what}) was opened on the phone.`, tone: "plain" };
    default: {
      const n = countOf(d, "count");
      return { sentence: `Notification sent (${what})${n !== null ? ` to ${plural(n, "device")}` : ""}; the lock screen shows no medicine name.`, tone: "plain" };
    }
  }
}

function factLine(e: BusEvent, d: Data): EventLine {
  const f = obj(d.fact);
  const kind = str(f.kind) ?? str(d.kind);
  const what = kind ? `a ${kind.replace(/_/g, " ")} fact` : "a fact";
  const byFamily = str(f.source) === "family";
  if (e.type === "profile.fact_confirmed") return { sentence: `He confirmed ${what} in his profile${byFamily ? " that his family wrote" : ""}.`, tone: "plain" };
  if (e.type === "profile.fact_changed") return { sentence: `He changed ${what} in his profile.`, tone: "plain" };
  return {
    sentence: byFamily ? `His family proposed ${what} for his profile; it waits for him to confirm.` : `He added ${what} to his profile.`,
    tone: "plain",
  };
}

function jobLine(e: BusEvent, d: Data): EventLine {
  const job = str(d.job) ?? "a scheduled job";
  if (e.type === "job.failed") return { sentence: `The scheduled job ${job} failed${str(d.code) ? ` (${str(d.code)!.replace(/_/g, " ")})` : ""}; it runs again next time.`, tone: "plain" };
  const n = countOf(d, "written");
  return { sentence: `The scheduled job ${job} ran${n !== null ? ` and wrote ${plural(n, "record")}` : ""}.`, tone: "plain" };
}

function visitChanged(d: Data): EventLine {
  const v = obj(d.visit);
  const name = cap(visitName(str(v.id) ?? str(d.visit_id)));
  if (d.fallback_unlocked === true) return { sentence: `${name}: the film crew signed in, so the scripted fallback can be switched on in this filming session.`, tone: "plain" };
  // C2 track F, round three (only add): he changed his answer in the visit's review, the follow-up is no longer planned
  if (d.withdrawn === true) return { sentence: "A planned follow-up is no longer planned: he took back the line it came from.", tone: "plain" };
  const mode = str(d.mode);
  // C2 track F (only add; real-app 4.6): the example account's sample visit is said to be one in every sentence about it
  if (d.sample === true) {
    const status = str(v.status);
    const what = mode ? "the example's visit is being replayed, not his own visit" : status ? (VISIT_STATUS_WORDS[status] ?? status.replace(/_/g, " ")) : "updated";
    return { sentence: `Sample recording: ${what}.`, tone: "plain" };
  }
  if (mode) return { sentence: `${name}${num(v.day) !== null ? ` (Day ${num(v.day)})` : ""}: ${mode === "replay" ? "replay started" : "recording started"}.`, tone: "plain" };
  const status = str(v.status);
  return { sentence: `${name}: ${status ? (VISIT_STATUS_WORDS[status] ?? status.replace(/_/g, " ")) : "updated"}.`, tone: "plain" };
}

export const RENDERERS: Record<string, Renderer> = {
  // ---- visit recording (M2)
  "asr.partial": (e, d) => ({ sentence: `Hearing at ${visitName(d.visit_id)}: ${quote(str(obj(d.utterance).text), 70)}`, tone: "plain" }),
  "asr.final": (e, d) => {
    const us = arr(d.utterances).map(obj);
    if (us.length === 1) {
      const u = us[0];
      const role = ROLE_WORDS[str(u.role) ?? "unknown"] ?? "nobody known";
      const state = str(u.role_state) === "confirmed" ? "confirmed" : str(u.role_state) === "inferred" ? "Ripple's guess" : "not known";
      return { sentence: `Heard at ${visitName(d.visit_id)} (${role}, ${state}): ${quote(str(u.text))}`, tone: "plain" };
    }
    return { sentence: `Heard ${plural(us.length, "sentence")} at ${visitName(d.visit_id)}.`, tone: "plain" };
  },
  "asr.fallback": (e, d) => {
    // M14: data { visit_id, reason, during: start | live | file, replay, used?, provider? } (provider: tencent, else Whisper)
    const reason = str(d.reason) ?? "";
    const tencent = str(d.provider) === "tencent";
    const service = tencent ? "Tencent speech recognition" : "The Whisper service";
    const why = reason ? ` (${reason})` : "";
    const visit = visitName(d.visit_id);
    // a wrong or missing token is a configuration problem, not a crash: say so
    const config = reason === "unauthorized" || reason.startsWith("not_configured");
    const configWords = "a configuration problem, not a crash: the app's speech service settings do not match the service";
    if (str(d.during) === "file") {
      const used = str(d.used);
      const then =
        used === "live"
          ? `so the record keeps the live ${tencent ? "" : "Whisper "}captions`
          : used === "fixture"
            ? "so the record uses the recorded replay"
            : d.audio_saved === true
              ? "and there was nothing to fall back to: the recording is saved, and End visit again makes the record once the service answers"
              : "and there was nothing to fall back to: the record could not be made yet";
      const what =
        reason === "no_audio" || reason === "upload_failed"
          ? `The recording of ${visit} did not reach the server`
          : reason === "too_large"
            ? `The recording of ${visit} is too long to send in full (over the store's or the speech service's limit)`
            : reason === "skipped" || reason === "cancelled"
              ? `The full transcript of ${visit} was not waited for (he chose to keep the live captions)`
              : config
                ? `${service} refused the web app for the full transcript of ${visit} (${configWords})`
                : `${service} did not finish the full transcript of ${visit}`;
      return { sentence: `${what}, ${then}${why}.`, tone: "fallback", badge: "Replay fallback" };
    }
    const instead = d.replay === null ? `${visit} shows no replay: live captions stop, the recording goes on` : "the visit screen uses the recorded replay";
    if (config) return { sentence: `${service} refused the web app (${configWords}), so ${instead}${why}.`, tone: "fallback", badge: "Replay fallback" };
    const when =
      reason === "busy"
        ? "stayed busy (its live queue was full)"
        : reason === "stuck"
          ? "is stuck (a transcription worker stopped answering; it restarts itself)"
          : str(d.during) === "live"
            ? "stopped answering during the visit"
            : "did not answer";
    return { sentence: `${service} ${when}, so ${instead}${why}.`, tone: "fallback", badge: "Replay fallback" };
  },
  "utterance.role": (e, d) => {
    // counted by who and how sure, never by sentence id (real-status: "v3-u06" on the judges' screen)
    const groups = new Map<string, number>();
    for (const c of arr(d.changes).map(obj)) {
      const who = ROLE_WORDS[str(c.role) ?? "unknown"] ?? (str(c.role) ?? "nobody known").replace(/_/g, " ");
      const sure = str(c.state) === "confirmed" ? "confirmed" : str(c.state) === "inferred" ? "Ripple's guess" : "not known";
      const k = `${who}|${sure}`;
      groups.set(k, (groups.get(k) ?? 0) + 1);
    }
    const parts = [...groups].map(([k, n]) => {
      const [who, sure] = k.split("|");
      const owner = who === "Mr Tan" || who === "Wei Ling" ? `${who}'s` : who === "nobody known" ? "not known" : `the ${who}'s`;
      return `${plural(n, "sentence")} ${n === 1 ? "is" : "are"} ${owner} (${sure})`;
    });
    return { sentence: `Who said it at ${visitName(d.visit_id)}: ${parts.length ? parts.join(", ") : "nothing changed"}.`, tone: "role", badge: "Who said it" };
  },
  "card.created": (e, d) => {
    const card = obj(d.card);
    const check = str(card.check);
    const kind = str(card.kind) === "doc" ? "doctor's note card" : str(card.kind) === "chk" ? `check card${check ? ` (${VISIT_CHECK_WORDS[check] ?? check.replace(/_/g, " ")})` : ""}` : "card";
    const q = str(card.quote);
    return { sentence: `New ${kind} on the visit screen${q ? `: ${quote(q, 70)}` : ""}.`, tone: "plain" };
  },
  scripted_fallback: (e, d) => ({
    sentence: `Scripted fallback: heard ${quote(str(d.heard), 60)}, showed the script line ${quote(str(d.script), 60)} instead.`,
    tone: "fallback",
    badge: "Scripted fallback",
  }),
  "visit.changed": (e, d) => visitChanged(d),

  // ---- /api/ask and the three checks (M1, M4)
  "ask.received": (e, d) => ({ sentence: `${personOf(d)} asked${num(d.day) !== null ? ` on Day ${num(d.day)}` : ""}: ${quote(str(d.text))}`, tone: "plain" }),
  "ask.route": (e, d) => ({ sentence: `Sorted as ${routeWords(d.route)}, ${sortedBy(d.reason)}.`, tone: "plain" }),
  "verify.layer1": (e, d) => layerCounts(e, d, "Layer 1, sources, numbers and names"),
  "verify.layer2": (e, d) => layerCounts(e, d, "Layer 2, instructions and judgements"),
  "verify.layer3": (e, d) => layerCounts(e, d, `Layer 3, ${checkerName(d.checker)}`),
  "ask.blocked": (e, d) => {
    if (str(d.limit)) return { sentence: `Cost guard: ${str(d.limit)!.replace(/_/g, " ")} reached, the question was not run.`, tone: "blocked", badge: "Blocked · cost guard" };
    if (d.stage === "route") {
      const why = reasonWords(arr(d.reasons));
      return {
        sentence: `Not answered: ${quote(str(d.request))} ${why[0] ?? "is not Ripple's to answer"}. Instead: the doctor's and the label's own words, and a referral.`,
        tone: "blocked",
        badge: "Blocked · the request",
        why,
      };
    }
    const layer = num(d.layer);
    const sentence = str(obj(d.sentence).en);
    const why = reasonWords(arr(d.reasons));
    // C2 track E: the demo's check drill (lib/crew/drill.ts). The sentence was planted on purpose, and the row says so
    if (sentence === DRILL_SENTENCE) {
      return {
        sentence: `Check drill: a made-up sentence was added to the answer on purpose, ${quote(sentence)}. It was stopped at layer ${layer ?? "?"}, because ${why.join("; ") || "a check failed"}. Shown instead: the referral line.`,
        tone: "blocked",
        badge: `Blocked · layer ${layer ?? "?"} · drill`,
        why,
      };
    }
    return {
      sentence: `Stopped at layer ${layer ?? "?"}: ${quote(sentence)}, because ${why.join("; ") || "a check failed"}. Shown instead: the referral line.`,
      tone: "blocked",
      badge: `Blocked · layer ${layer ?? "?"}`,
      why,
    };
  },
  "ask.answered": (e, d) => {
    const n = arr(d.sentences).length;
    const ms = num(d.latencyMs);
    const time = ms === null ? "" : ms < 1000 ? ` in ${ms} ms` : ` in ${(ms / 1000).toFixed(1)} s`;
    // C2 track S (fix round of 10-11): the model's generation failed (the deadline, an outage, an unusable reply) and
    // the fixed rules picked his sources instead (lib/safety/pipeline.ts runGenerator): the row says so
    const byRules = str(d.composedBy) === "rules_after_generation_failed" ? " The model gave no usable answer in time, so the fixed rules picked his sources." : "";
    return { sentence: `Answered (${routeWords(d.route)}) with ${plural(n, "sourced sentence")}${time}.${byRules}`, tone: "plain" };
  },

  // ---- his records and questions (M0, M3, M4, M5)
  "question.created": (e, d) => questionLine(d, "Added"),
  "question.updated": (e, d) => {
    const q = obj(d.question);
    if (str(q.status) === "answered" && str(q.answer_text)) return { sentence: `Answer saved for ${quote(str(q.text), 50)}: ${quote(str(q.answer_text), 70)}.`, tone: "plain" };
    return questionLine(d, "Updated");
  },
  "dose.logged": (e, d) => {
    const dose = obj(d.dose);
    const name = str(d.name) ?? "his tablet";
    const state = str(dose.state);
    const reason = str(dose.reason);
    const day = num(dose.day);
    const words = state === "taken" ? "taken" : state === "missed" ? "not taken" : reason === "later" ? "later (not confirmed yet)" : reason === "no_reply" ? "no reply, not confirmed" : "not confirmed";
    const by = str(d.by) === "director" ? " (no reply recorded)" : str(d.by) === "system" ? " (no reply recorded when the window closed)" : "";
    return { sentence: `${name}${day !== null ? `, Day ${day}` : ""} ${str(dose.slot) ?? ""}: ${words}${by}.`.replace(/\s+:/, ":"), tone: "plain" };
  },
  "bp.logged": (e, d) => {
    const r = obj(d.reading);
    const s = num(r.systolic);
    const dia = num(r.diastolic);
    // C2: today's reading corrected or deleted (the change is kept as this event)
    const onDay = num(r.day) !== null ? ` on Day ${num(r.day)}` : "";
    if (d.deleted === true) return { sentence: `He deleted a blood pressure reading${s !== null && dia !== null ? ` (${s}/${dia})` : ""}${onDay}.`, tone: "plain" };
    if (d.corrected === true && s !== null && dia !== null) {
      const was = obj(d.was);
      const before = num(was.systolic) !== null && num(was.diastolic) !== null ? ` (it was ${num(was.systolic)}/${num(was.diastolic)})` : "";
      return { sentence: `He corrected a blood pressure reading to ${s}/${dia}${before}${onDay}.`, tone: "plain" };
    }
    return { sentence: s !== null && dia !== null ? `He recorded a blood pressure reading: ${s}/${dia}${num(r.day) !== null ? ` on Day ${num(r.day)}` : ""}.` : "A blood pressure reading was marked not taken.", tone: "plain" };
  },
  "note.logged": (e, d) => ({ sentence: `Noted in his words: ${quote(str(obj(d.note).text))}`, tone: "plain" }),
  "med.changed": (e, d) => medChanged(d),
  "reminder.clip_added": (e, d) =>
    // the same event when she deletes one of hers (C2): his phone then plays her next newest, or the stand-in voice
    num(d.removed)
      ? { sentence: "Wei Ling deleted one of her reminder recordings; his phone plays her next newest one, or the stand-in voice.", tone: "plain" }
      : { sentence: "Wei Ling recorded a reminder for her father.", tone: "plain" },
  "family_grant.changed": (e, d) => {
    const parts = Object.entries(obj(d.changed)).map(([k, v]) => `${k.replace(/_/g, " ")} ${v === true ? "on" : v === false ? "off" : "changed"}`);
    return { sentence: `Mr Tan changed what Wei Ling may see${parts.length ? `: ${parts.join(", ")}` : ""}.`, tone: "plain" };
  },

  // ---- session and director (M0)
  "clock.changed": (e, d) => {
    const s = obj(d.session);
    const scene = plainBeat(str(obj(d.beat).id));
    const day = num(s.story_day);
    const time = str(s.story_time);
    return { sentence: stop(`Story clock moved to Day ${day ?? "?"}${time ? ` ${time}` : ""}${scene ? `: ${scene}` : ""}`), tone: "plain" };
  },
  "director.cue": (e, d) => {
    if (d.cue === "no_reply") {
      const n = arr(d.marked).length;
      return {
        sentence: n ? `Director: no reply simulated, ${plural(n, "tablet")} recorded as not confirmed.` : "Director: no reply simulated, but every tablet of that time was already recorded.",
        tone: "plain",
      };
    }
    if (d.cue === "show") {
      const scene = plainBeat(str(d.beat));
      return { sentence: str(d.why) === "replay" ? "Director: the phones open the visit and play it." : `Director: the phones open the page of this scene${scene ? ` (${scene})` : ""}.`, tone: "plain" };
    }
    if (d.cue === "replay_stopped") {
      const why = str(d.why) === "clock" ? "the story clock moved" : str(d.why) === "reset" ? "the copy was reset" : "the director stopped it";
      return { sentence: `The visit replay stopped (${why}).`, tone: "plain" };
    }
    // her words; the audio may be the stand-in recording of them (the seed's), so not "her recording"
    return { sentence: `Director: the reminder pops up now on every patient phone${obj(d.clip).id ? ", with Wei Ling's reminder" : ""}.`, tone: "plain" };
  },
  "session.reset": () => ({ sentence: "This copy of the story was reset to how it starts.", tone: "plain" }),
  "session.filming_mode": (e, d) => ({ sentence: obj(d.session).filming_mode === true ? "Filming mode on: the phones use larger text and hide the crew's tools." : "Filming mode off.", tone: "plain" }),
  "session.member_joined": (e, d) => {
    const role = str(obj(d.member).role) ?? "a";
    const who = role === "patient" ? "Mr Tan's phone" : role === "family" ? "Wei Ling's phone" : role === "backstage" ? "A backstage screen" : role === "director" ? "A director's screen" : "A device";
    return { sentence: `${who} joined.`, tone: "plain" };
  },

  // ---- the real app (C2 foundation F1): links, consent, push, profile, the new modules, accounts, jobs
  "care_link.invited": (e, d) => ({ sentence: CARE_LINK_WORDS["care_link.invited"](linkWho(d)), tone: "plain" }),
  "care_link.accepted": (e, d) => ({ sentence: CARE_LINK_WORDS["care_link.accepted"](linkWho(d)), tone: "plain" }),
  "care_link.confirmed": (e, d) => ({ sentence: CARE_LINK_WORDS["care_link.confirmed"](linkWho(d)), tone: "plain" }),
  "care_link.declined": (e, d) => ({ sentence: CARE_LINK_WORDS["care_link.declined"](linkWho(d)), tone: "plain" }),
  "care_link.revoked": (e, d) => ({ sentence: CARE_LINK_WORDS["care_link.revoked"](linkWho(d)), tone: "plain" }),
  "care_link.left": (e, d) => ({ sentence: CARE_LINK_WORDS["care_link.left"](linkWho(d)), tone: "plain" }),
  "consent.recorded": (e, d) => consentLine(d),
  "push.subscribed": (e, d) => pushLine(e, d),
  "push.unsubscribed": (e, d) => pushLine(e, d),
  "push.sent": (e, d) => pushLine(e, d),
  "push.opened": (e, d) => pushLine(e, d),
  "profile.fact_added": (e, d) => factLine(e, d),
  "profile.fact_confirmed": (e, d) => factLine(e, d),
  "profile.fact_changed": (e, d) => factLine(e, d),
  "prevent.done": (e, d) => ({ sentence: `He marked a prevention item as done${str(d.item_id) ? ` (${str(d.item_id)!.replace(/[_-]/g, " ")})` : ""}.`, tone: "plain" }),
  "prevent.changed": () => ({ sentence: "His prevention list changed.", tone: "plain" }),
  "watch.synced": (e, d) => {
    const n = countOf(d, "count");
    return { sentence: `Watch data arrived${n !== null ? `: ${plural(n, "reading")}` : ""}; Ripple only describes it, never judges it.`, tone: "plain" };
  },
  "diet.checked": (e, d) => ({ sentence: `He answered today's food check${str(d.item) ? ` (${str(d.item)!.replace(/_/g, " ")})` : ""}.`, tone: "plain" }),
  "chat.message": (e, d) => ({ sentence: str(d.role) === "ripple" ? "Ripple replied in his conversation." : "He said something in his conversation with Ripple.", tone: "plain" }),
  "visit.transcribed": (e, d) => ({ sentence: `Visit ${str(d.visit_id) ?? str(obj(d.visit).id) ?? "?"}: the transcript arrived after the visit; it waits for his check.`, tone: "plain" }),
  // Ripple's notes of a visit: counted, never quoted (they are his visit's words, and not confirmed)
  "visit.summary": (e, d) => {
    const n = arr(d.points).length;
    const visit = visitName(d.visit_id);
    return {
      sentence:
        str(d.stage) === "final"
          ? `Ripple wrote its summary of ${visit} from the whole transcript (${plural(n, "point")}, not confirmed, never a source).`
          : `Ripple updated its live notes of ${visit} (${plural(n, "point")}, not confirmed).`,
      tone: "plain",
    };
  },
  "account.created": () => ({ sentence: "A new account was created with its own space.", tone: "plain" }),
  "account.changed": () => ({ sentence: "His account settings changed.", tone: "plain" }),
  "account.reseeded": (e, d) => ({ sentence: str(d.kind) === "blank" ? "The example data was cleared: he starts from his own." : "The example data was laid out again for today.", tone: "plain" }),
  "job.ran": (e, d) => jobLine(e, d),
  "job.failed": (e, d) => jobLine(e, d),
  // owner 10-16 (lib/care/told.ts): counted, never quoted
  "family.told": () => ({ sentence: "A family member was told he said something to Ripple that may need attention.", tone: "plain" }),
};

/** The sentence and highlight for one event; an unknown type falls back to the event's own `say`. */
export function renderEvent(e: BusEvent): EventLine & { known: boolean } {
  const r = RENDERERS[e.type];
  if (!r) return { sentence: e.say, tone: "plain", known: false };
  try {
    const line = r(e, obj(e.data));
    return { ...line, sentence: line.sentence || e.say, known: true };
  } catch {
    return { sentence: e.say, tone: "plain", known: true };
  }
}
