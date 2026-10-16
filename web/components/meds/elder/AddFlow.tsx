"use client";

/**
 * /p/meds/add on his account (C2 track F; real-app 2.16; the integrator's request: the label photo and a typed entry,
 * with 「以后再说」), laid out as the timeline draft's 06-3 to 06-5 and 08-1a to 08-2. One screen at a time:
 *
 *   where it is from (医生开的 / 自己买的 / 亲戚带的 / 保健品; skipped for a prescribed medicine's label)
 *   photo   06-3, 08-1a: the step before the phone's own camera (capture="environment"), in the draft's dark camera
 *           look: what to photograph, the place of the viewfinder, the shutter that opens the camera; the example
 *           account also has Mr Tan's sample photos (the outlined pills). It comes right after the origin and holds
 *           the other two ways, 「我自己输入」 and 「以后再说」 (owner's tidy of 10-13: the screen that asked 拍药袋 /
 *           我自己输入 / 以后再说 before it is gone). With AI processing off, or ?manual=1, the origin goes to typing.
 *   same    06-4b: the label names a medicine he already has, with the same dispensing date and from the same place:
 *           「这盒已经在你的药里。」; nothing is written. He may take another photo, go to his medicines, or check this
 *           label again all the same (a new reading of the same bag: the way to correct a line he ticked wrongly)
 *   check   06-4a: every line of the label on one screen, each with 「对」 and 「改」 (his words then, shown as 「你改过」,
 *           never as the label's); the label's own time words say which reminder they set; the grey bar counts what is
 *           left. The last answer saves (as it always did): the draft's 「放进我的药」 is not a button to tap.
 *   slots   when he takes it, only when the label's own words name no time (早上 / 中午 / 晚上 / 睡前, his choice)
 *   done    saved: what was kept, the way to its card
 *   unknown 08-1b, 08-2: a medicine nobody identified: his photo, the fixed sentence (lib/safety), his question for
 *           the pharmacist already on the list, and what he does with the box (没在吃 / 带去给医生看, his own choice)
 *   mismatch a label that names another medicine than the doctor prescribed: real-app's sentence and his question
 *   typed   06-5: the name as he types it, the strength if he wants, when he takes it: his own entry, never checked
 *
 * Nothing clinical is worded here: the printed words come from the server's read, the fixed sentences from lib/safety.
 *
 * C2 round two:
 *   - his consent to AI processing is off (`aiOff`): no camera. One sentence says so and where to change it (「我」), and
 *     he types the label's words himself; for a prescribed medicine awaiting its label the typed label goes onto that
 *     medicine. If the server refuses a photo (403 ai_off: he turned it off elsewhere) the flow goes the same way.
 *   - opened from setting up his account (`returnHref`): after the medicine is added, and on 「以后再说」, the button goes
 *     on with setting up.
 *   - a slot whose reminder time nothing says yet (`askTimes`: 中午 / 晚上 / 睡前 on an account that was only asked for
 *     breakfast): asked once, right before saving; his answer is his own setting from then on (real-app 2.16).
 *
 * C2 round three:
 *   - the reminder-time question is track C's, the one 「我 › 早饭时间和提醒」 asks: the same words, the same time chips
 *     with 「别的时间」 (TimeChips), the same usual times and the same range for each part of the day; the server keeps
 *     the answer through C's writer. Nothing about reminder times is implemented here.
 *   - a medicine of his waits for its label and this page was not opened for it: the server holds every label against
 *     the waiting ones (lib/meds/write.ts). When it cannot tell whether this label is the waiting medicine's (409
 *     label_which) the flow asks him, 「这是医生开的 … 的药袋吗？」, and sends his answer; nothing is guessed. 「是」 goes
 *     the way of a label photographed for that medicine (another name: the pharmacist question).
 *
 * Test hooks of the check screen (the journeys walk it line by line): add-check carries data-index (the first line
 * still to answer) and data-total; that line's value is add-check-value (data-field), its buttons add-line-right and
 * add-line-change; the field 「改」 opens is add-edit-input with add-line-changed. Every line also has add-row-<field>.
 */
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
// track C's reminder-time controls (the one implementation): the chips and each part of the day's usual times
import { TimeChips } from "@/app/onboard/[step]/steps";
import { CHOICES as SLOT_TIME_CHOICES } from "@/app/p/profile/times/[slot]/SlotTimeForm";
import {
  Act,
  Acts,
  ActionDock,
  BodyText,
  Box,
  Button,
  ButtonRow,
  Field,
  Icon,
  LabelOriginal,
  ListCard,
  ListItem,
  LoadingState,
  PageHeader,
  PrimaryButton,
  Screen,
  SecondaryButton,
  TabBar,
  Tag,
  Timeline,
  TimelineItem,
  TlControls,
  UiLink,
} from "@/components/ui";
import { shortDay, shortTime } from "@/lib/daily/i18n";
import { fieldWords, mx, slotWords, type MedsLocale } from "@/lib/meds/account-copy";
import { formatDate } from "@/lib/meds/i18n";
import { accountSamples, type AccountSampleLabel } from "@/lib/meds/samples";
import { CONFIRM_FIELDS, MED_ORIGINS, type ConfirmField, type LabelReadResponse, type MedOrigin, type StoredLabel } from "@/lib/meds/types";
import type { DaySlot, MedicationRow } from "@/lib/store/types";
import { uiCopy } from "@/lib/ui/copy";
import { UnknownChoices } from "./CardParts";
import "./meds.css";

type Step = "origin" | "photo" | "working" | "same" | "check" | "slots" | "times" | "saving" | "done" | "unknown" | "mismatch" | "which" | "error" | "manual" | "exists";

/** A slot whose reminder time is asked once (lib/meds/slot-times.ts SlotTimeQuestion: track C's words and range). */
export interface AskTime {
  slot: DaySlot;
  /** the time used until he answers, offered first */
  now: string;
  range: { from: string; to: string };
  /** the headline, in lines: 「中午的药，」「几点提醒你？」 */
  title: string[];
  /** said when he picks a time outside the range */
  rangeWords: string;
}

/** A medicine he has whose label is checked, as the page read it: for 「这盒已经在你的药里。」 (06-4b). */
export interface KnownMed {
  id: string;
  /** the kb medicine */
  drugId: string;
  origin: MedOrigin;
  /** the date on its label (YYYY-MM-DD), or null */
  dispensed: string | null;
  clinic: string | null;
  /** "Amlodipine 5 mg" */
  name: string;
}

/** A medicine waiting for its label, as the server names it in 409 label_which. */
interface WaitingMed {
  id: string;
  name: string;
  zh: string | null;
}

/** His answer to "which medicine is this label for": one of the waiting ones, or none of them. */
type WhichChoice = { medId: string } | { other: true };

const SLOTS: DaySlot[] = ["morning", "midday", "evening", "night"];
/** The lines whose value is the label's printed words (mono); the date is written out and the clinic is a name. */
const PRINTED: readonly ConfirmField[] = ["drug_text", "strength", "directions"];
const minutesOf = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

interface Saved {
  med: MedicationRow;
  name: string;
  outcome?: "label_confirmed" | "unidentified";
  created?: boolean;
  answer?: { fixedText?: string | null; fixedTextZh?: string | null } | null;
  questions?: { id: string; text: string }[];
}

type Edits = Partial<Record<ConfirmField, string>>;

/**
 * A step's lower buttons in the draft's fixed area (`dk`): the white strip under a hairline that stays at the foot of
 * the screen while the step's blocks scroll under it, above the tab bar where the step has one (the foundation's
 * `<ActionDock bar>`: sticky and in the page's flow, so on a computer it stays inside the phone's column).
 */
function Dock({ children }: { children: ReactNode }) {
  return <ActionDock bar>{children}</ActionDock>;
}

async function send<T>(path: string, method: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string; detail?: Record<string, unknown> }> {
  const res = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin" }).catch(() => null);
  if (!res) return { ok: false, status: 0, error: "network" };
  const data = (await res.json().catch(() => ({}))) as { error?: string; detail?: Record<string, unknown> };
  if (!res.ok) return { ok: false, status: res.status, error: data.error ?? "request_failed", detail: data.detail };
  return { ok: true, data: data as T };
}

export function AddFlow({
  locale,
  forMed,
  samples,
  manual: startManual,
  laterHref,
  returnHref = null,
  aiOff: aiOffAtLoad = false,
  askTimes = [],
  slotFirst = {},
  known = [],
}: {
  locale: MedsLocale;
  /** the date line of the first header (kept for callers; the draft's headers carry the screen's own title) */
  story?: string;
  /** photographing the label of this medicine (a prescription awaiting its label) */
  forMed: { id: string; name: string; origin: MedOrigin; drugId?: string | null } | null;
  /** the example account (and the demo): Mr Tan's sample label photos */
  samples: boolean;
  /** ?manual=1: straight to typing it in (after the origin) */
  manual: boolean;
  /** where 「以后再说」 goes */
  laterHref: string;
  /** opened from setting up his account: where he goes on once the medicine is added (null: stays with his medicines) */
  returnHref?: string | null;
  /** his consent to AI processing is off: no photo is read, he types the label's words himself */
  aiOff?: boolean;
  /** the slots whose reminder time nothing says yet: asked once when this medicine uses one */
  askTimes?: AskTime[];
  /** when each part of his day is reminded now ("08:45"), for 「→ 早上提醒（8:45）」 under the label's own time words */
  slotFirst?: Partial<Record<DaySlot, string>>;
  /** the medicines he has whose label is checked: the same bag photographed again is said so, not added again */
  known?: KnownMed[];
}) {
  const router = useRouter();
  const copy = uiCopy(locale);
  const [aiOff, setAiOff] = useState(aiOffAtLoad);
  const [step, setStep] = useState<Step>(forMed ? (aiOffAtLoad ? "manual" : "photo") : "origin");
  const [origin, setOrigin] = useState<MedOrigin>(forMed?.origin ?? "prescription");
  const [read, setRead] = useState<LabelReadResponse | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<ConfirmField[]>([]);
  const [edits, setEdits] = useState<Edits>({});
  /** the line whose 「改」 is open, and what is in its field */
  const [editing, setEditing] = useState<{ field: ConfirmField; text: string } | null>(null);
  const [slots, setSlots] = useState<DaySlot[]>([]);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [problem, setProblem] = useState<"unreadable" | "failed">("failed");
  const [mismatchQuestion, setMismatchQuestion] = useState<string | null>(null);
  /** the label is of a medicine he already has (the same bag again) */
  const [same, setSame] = useState<KnownMed | null>(null);
  /** the server could not tell which medicine the label is for: the waiting ones, the name on the label, and the save to repeat */
  const [which, setWhich] = useState<{ waiting: WaitingMed[]; labelName: string | null; again: (choice: WhichChoice) => void } | null>(null);
  const [timeProblem, setTimeProblem] = useState(false);
  // typing the label of a prescribed medicine: its name is there to start with (he can change it)
  const [name, setName] = useState(forMed && aiOffAtLoad ? forMed.name : "");
  const [strength, setStrength] = useState("");
  const [existingId, setExistingId] = useState<string | null>(null);
  /** his answers to 「几点提醒你？」, the question on screen, and what to save once they are all answered */
  const [times, setTimes] = useState<Partial<Record<DaySlot, string>>>({});
  const [timePick, setTimePick] = useState<string | null>(null);
  const [afterTimes, setAfterTimes] = useState<{ kind: "label"; c: ConfirmField[]; e: Edits; chosen: DaySlot[] } | { kind: "manual" } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  const fields = read ? CONFIRM_FIELDS.filter((f) => read.fields[f] !== null && read.fields[f] !== "") : [];
  const shown = (f: ConfirmField, v: string | null | undefined) => (f === "dispensed" && v ? formatDate(locale, v) : (v ?? ""));
  /** the slots the label's own words name (the server's closed table, sent with the read); none once he changed that line */
  const labelSlots = (e: Edits = edits): DaySlot[] => (!read || e.directions !== undefined || !read.fields.directions ? [] : (read.dose_slots ?? []));
  const answered = (f: ConfirmField, c: ConfirmField[] = confirmed, e: Edits = edits) => c.includes(f) || e[f] !== undefined;

  function fail(kind: "unreadable" | "failed") {
    setProblem(kind);
    setStep("error");
  }

  async function sendPhoto(blob: Blob) {
    setStep("working");
    setPreview(URL.createObjectURL(blob));
    const link = await send<{ path: string; url: string; method: string; headers: Record<string, string> }>("/api/upload-url", "POST", { kind: "label", content_type: blob.type || "image/jpeg" });
    if (!link.ok) return fail("failed");
    const put = await fetch(link.data.url, { method: link.data.method, headers: link.data.headers, body: blob }).catch(() => null);
    if (!put?.ok) return fail(put?.status === 415 ? "unreadable" : "failed");
    const out = await send<LabelReadResponse>("/api/labels/read", "POST", { path: link.data.path });
    if (!out.ok && out.error === "ai_off") {
      // he turned AI processing off since this page loaded: the photo was not read; he types the label instead
      setAiOff(true);
      if (forMed && !name) setName(forMed.name);
      setStep("manual");
      return;
    }
    if (!out.ok) return fail(out.status === 422 || out.status === 415 ? "unreadable" : "failed");
    // a reading with no line to check is a photo nothing was read from
    if (!CONFIRM_FIELDS.some((f) => out.data.fields[f] !== null && out.data.fields[f] !== "")) return fail("unreadable");
    setRead(out.data);
    setConfirmed([]);
    setEdits({});
    setEditing(null);
    // the same bag again (06-4b): the medicine the label names is his already, from the same place, with the same date
    const f = out.data.fields;
    const again = !forMed && f.drug_id ? (known.find((k) => k.drugId === f.drug_id && k.origin === origin && (k.dispensed ?? null) === (f.dispensed ?? null)) ?? null) : null;
    setSame(again);
    setStep(again ? "same" : "check");
  }

  async function sendSample(sample: AccountSampleLabel) {
    const res = await fetch(`/api/labels/sample?name=${sample}`).catch(() => null);
    if (!res?.ok) return fail("failed");
    await sendPhoto(await res.blob());
  }

  /** Back to the camera with nothing kept of the last reading (「‹ 重拍」, 「重新拍」); to typing with AI processing off. */
  function retake() {
    setRead(null);
    setSame(null);
    setConfirmed([]);
    setEdits({});
    setEditing(null);
    setStep(aiOff ? "manual" : "photo");
  }

  /** After an answer to a line: when every line is answered, on to when he takes it, or straight to saving. */
  function afterAnswer(c: ConfirmField[], e: Edits) {
    if (fields.some((f) => !answered(f, c, e))) return;
    // every line checked: when he takes it, unless the label's own words say (or nobody identified it)
    const identified = !!read?.fields.drug_id || !!e.drug_text;
    const fromLabel = labelSlots(e);
    if (identified && fromLabel.length === 0) {
      setStep("slots");
      return;
    }
    // the label's own words name the slot: its reminder time is asked once when nothing says it yet
    saveOrAsk({ kind: "label", c, e, chosen: [] }, identified ? fromLabel : []);
  }

  function answerRight(f: ConfirmField) {
    const c = [...confirmed.filter((x) => x !== f), f];
    const e = { ...edits };
    delete e[f];
    setConfirmed(c);
    setEdits(e);
    if (editing?.field === f) setEditing(null);
    afterAnswer(c, e);
  }

  function answerChanged(f: ConfirmField, text: string) {
    const e = { ...edits, [f]: text.trim() };
    const c = confirmed.filter((x) => x !== f);
    setEdits(e);
    setConfirmed(c);
    setEditing(null);
    afterAnswer(c, e);
  }

  /** The next slot of this medicine whose reminder time has to be asked (none: go on and save). */
  const nextAsk = (used: DaySlot[], given: Partial<Record<DaySlot, string>>): AskTime | null => askTimes.find((q) => used.includes(q.slot) && !given[q.slot]) ?? null;

  /** Save, unless a slot's time must be asked first (then the question, and the same save after it). */
  function saveOrAsk(action: NonNullable<typeof afterTimes>, used: DaySlot[], given: Partial<Record<DaySlot, string>> = times) {
    const q = nextAsk(used, given);
    if (q) {
      setAfterTimes(action);
      setTimePick(q.now);
      setTimeProblem(false);
      setStep("times");
      return;
    }
    if (action.kind === "label") void save(action.c, action.e, action.chosen, given);
    else void saveManual(given);
  }

  /** Which medicine the request is for: this page's, or his answer to 「这是哪一种药的药袋？」, else where he said it is from. */
  const forWhich = (choice?: WhichChoice) => (forMed ? { med_id: forMed.id } : choice && "medId" in choice ? { med_id: choice.medId } : { origin, ...(choice ? { other: true } : {}) });

  /** 409 label_which: the server will not guess which medicine the label is for. Ask him, then send `again` with his answer. */
  function askWhich(detail: Record<string, unknown> | undefined, again: (choice: WhichChoice) => void): boolean {
    const waiting = (detail?.waiting as WaitingMed[] | undefined) ?? [];
    if (!waiting.length) return false;
    setWhich({ waiting, labelName: typeof detail?.label_name === "string" ? detail.label_name : null, again });
    setStep("which");
    return true;
  }

  async function save(c: ConfirmField[], e: Edits, chosen: DaySlot[], given: Partial<Record<DaySlot, string>> = times, choice?: WhichChoice) {
    if (!read) return;
    setStep("saving");
    const out = await send<Saved>("/api/meds", "POST", {
      read_token: read.read_token,
      confirmed: c,
      ...(Object.keys(e).length ? { edits: e } : {}),
      ...(chosen.length ? { slots: chosen } : {}),
      ...(Object.keys(given).length ? { times: given } : {}),
      ...forWhich(choice),
      locale,
    });
    if (!out.ok) {
      if (out.error === "label_which" && askWhich(out.detail, (ch) => void save(c, e, chosen, given, ch))) return;
      if (out.error === "label_mismatch") {
        const qs = (out.detail?.questions as { text: string }[] | undefined) ?? [];
        setMismatchQuestion(qs[0]?.text ?? null);
        setStep("mismatch");
        return;
      }
      return fail("failed");
    }
    setSaved(out.data);
    setStep(out.data.outcome === "unidentified" ? "unknown" : "done");
    router.refresh();
  }

  async function saveManual(given: Partial<Record<DaySlot, string>> = times, choice?: WhichChoice) {
    setStep("saving");
    const target = forWhich(choice);
    const out = await send<Saved>("/api/meds/manual", "POST", {
      name,
      origin,
      slots,
      strength: strength.trim() || null,
      ...("med_id" in target ? { med_id: target.med_id } : "other" in target ? { other: true } : {}),
      ...(Object.keys(given).length ? { times: given } : {}),
      locale,
    });
    if (!out.ok) {
      if (out.error === "label_which" && askWhich(out.detail, (ch) => void saveManual(given, ch))) return;
      if (out.error === "label_mismatch") {
        const qs = (out.detail?.questions as { text: string }[] | undefined) ?? [];
        setMismatchQuestion(qs[0]?.text ?? null);
        setStep("mismatch");
        return;
      }
      if (out.error === "med_exists") {
        setExistingId((out.detail?.med_id as string | undefined) ?? null);
        setStep("exists");
        return;
      }
      setStep("manual");
      return;
    }
    setSaved(out.data);
    setStep("done");
    router.refresh();
  }

  // ---------------------------------------------------------------- the pieces every step is drawn from

  const tabs = <TabBar active="records" locale={locale} />;
  const toMeds = { href: "/p/meds", label: mx(locale, "card.back") };
  /** One step: its header and its blocks, 18px apart, the buttons in the lower part. The test hook is on the whole step. */
  const stepScreen = (testId: string, o: { header?: ReactNode; tabBar?: boolean; extra?: Record<string, string>; children: ReactNode }) => (
    <Screen locale={locale} tabBar={o.tabBar ? tabs : undefined} tabBarPlacement="fixed" foot="plain">
      <div className="rpu-meds-step" data-testid={testId} data-step={step} data-ai-off={aiOff ? "true" : "false"} {...o.extra}>
        {o.header}
        <div className="rpu-meds-step-body">{o.children}</div>
      </div>
    </Screen>
  );
  /**
   * 「‹ 重拍」: the tap goes back to the camera inside this flow (nothing is loaded again). It stays a link to the add
   * page all the same, which is where it leads when the page's script has not run.
   */
  const retakeHeader = (
    <PageHeader
      back={{
        href: forMed ? `/p/meds/add?med=${encodeURIComponent(forMed.id)}` : "/p/meds/add",
        label: mx(locale, "add.retake"),
        onClick: (e) => {
          e.preventDefault();
          retake();
        },
      }}
      title={mx(locale, "check.title")}
      subtitle={step === "check" ? mx(locale, "check.sub") : undefined}
      locale={locale}
    />
  );
  /** AI processing is off: the one sentence, and the way to change it */
  const aiOffNote = aiOff ? <Box variant="grey" title={mx(locale, "add.aiOff")} link={{ href: "/p/me/ai", label: mx(locale, "add.aiOffChange") }} testId="add-ai-off" /> : null;
  /** opened from setting up his account: the way on (the first button once the medicine is added) */
  const onward = returnHref ? (
    <PrimaryButton href={returnHref} data-testid="add-continue">
      {mx(locale, "add.continue")}
    </PrimaryButton>
  ) : null;
  /** 「看药卡」: the first button, or the second when setting up goes on */
  const openCard = (id: string | null) => {
    const href = id ? `/p/meds/${encodeURIComponent(id)}` : "/p/meds";
    return onward ? (
      <SecondaryButton href={href} data-testid="add-open-card">
        {mx(locale, "add.openCard")}
      </SecondaryButton>
    ) : (
      <PrimaryButton href={href} data-testid="add-open-card">
        {mx(locale, "add.openCard")}
      </PrimaryButton>
    );
  };
  /** when he takes it: the four parts of the day as chips, any number of them */
  const slotChips = (
    <div className="rpu rpu-chips" data-rp="chips" role="group" aria-label={mx(locale, "add.slots")} data-testid="add-slot-choices">
      {SLOTS.map((s) => {
        const on = slots.includes(s);
        return (
          <button key={s} type="button" className="rpu-chip" data-rp="chip" aria-pressed={on} data-testid={`add-slot-${s}`} data-on={on ? "true" : "false"} onClick={() => setSlots((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]))}>
            {mx(locale, `slot.${s}`)}
          </button>
        );
      })}
    </div>
  );
  /** his photo, on the screens that follow it */
  const photo = preview ? (
    // eslint-disable-next-line @next/next/no-img-element -- a local object URL of his own photo
    <img src={preview} alt={mx(locale, "photo.alt")} className="rpu-meds-photo" data-rp="label-photo" />
  ) : null;

  // ---- where it is from
  if (step === "origin") {
    return stepScreen("add-origin", {
      tabBar: true,
      header: <PageHeader back={toMeds} title={mx(locale, "add.origin")} locale={locale} />,
      children: (
        <ListCard>
          {MED_ORIGINS.map((o) => (
            <ListItem
              key={o}
              title={originWord(locale, o)}
              chevron
              testId={`add-origin-${o}`}
              // straight to the camera, which also offers 「我自己输入」 and 「以后再说」; to typing with AI processing
              // off (that screen says why) or with ?manual=1 (owner's tidy of 10-13: no screen asks "how" in between)
              onClick={() => {
                setOrigin(o);
                setStep(startManual || aiOff ? "manual" : "photo");
              }}
            />
          ))}
        </ListCard>
      ),
    });
  }

  // ---- the step before the phone's camera (never with AI processing off: nothing would read the photo)
  if (step === "photo" && !aiOff) {
    const alts = samples ? accountSamples(forMed?.drugId) : [];
    return (
      <Screen locale={locale} className="rpu-meds-cam" data-rp-phone="dark">
        <div className="rpu-meds-cam-body" data-testid="add-photo" data-step={step} data-ai-off="false">
          <div className="rpu-meds-cam-top">
            {forMed ? (
              <UiLink href="/p/meds" nav="back" className="rpu-meds-cam-back" data-rp="back">
                <Icon name="back" stroke={2.8} />
                {mx(locale, "cam.back")}
              </UiLink>
            ) : (
              <button type="button" className="rpu-meds-cam-back" data-rp="back" onClick={() => setStep("origin")}>
                <Icon name="back" stroke={2.8} />
                {mx(locale, "cam.back")}
              </button>
            )}
          </div>
          <h1 className="rpu-meds-cam-hint">{forMed ? mx(locale, "add.forMed", { name: forMed.name }) : mx(locale, "add.photo")}</h1>
          <div className="rpu-meds-cam-view">
            <p className="rpu-meds-cam-in">{mx(locale, "add.photoSub")}</p>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            capture="environment"
            hidden
            data-testid="add-file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void sendPhoto(file);
            }}
          />
          <button type="button" className="rpu-meds-cam-shutter" onClick={() => fileRef.current?.click()} data-testid="add-take-photo">
            {mx(locale, "add.takePhoto")}
          </button>
          {alts.length ? (
            <div className="rpu-meds-cam-alts">
              <p className="rpu-meds-cam-note">{mx(locale, "add.samples")}</p>
              {alts.map((s) => (
                <button key={s} type="button" className="rpu-meds-cam-alt" onClick={() => void sendSample(s)} data-testid={`add-sample-${s}`}>
                  {sampleWord(locale, s)}
                </button>
              ))}
            </div>
          ) : null}
          <div className="rpu-meds-cam-ways" style={{ ["--rpu-cols" as string]: forMed ? 1 : 2 }}>
            {!forMed ? (
              <button type="button" className="rpu-meds-cam-way" onClick={() => setStep("manual")} data-testid="add-photo-manual">
                {mx(locale, "add.manual")}
              </button>
            ) : null}
            <UiLink href={laterHref} className="rpu-meds-cam-way">
              {mx(locale, "add.later")}
            </UiLink>
          </div>
        </div>
      </Screen>
    );
  }

  // ---- the photo is being read, or what he checked is being saved
  if (step === "working" || step === "saving") {
    return stepScreen("add-working", {
      children: (
        <>
          {photo}
          <Timeline>
            <TimelineItem node="now" title={mx(locale, step === "working" ? "add.reading" : "add.saving")} />
          </Timeline>
          <LoadingState locale={locale} lines={3} />
        </>
      ),
    });
  }

  // ---- 06-4b: the same bag again
  if (step === "same" && same && read) {
    const detail = [same.name, same.dispensed ? mx(locale, "card.dispensed", { date: shortDay(locale, same.dispensed) }) : null, same.clinic].filter(Boolean).join(" · ");
    return stepScreen("add-same", {
      header: retakeHeader,
      extra: { "data-med": same.id },
      children: (
        <>
          <Box variant="line" title={mx(locale, "same.title")} testId="add-same-box">
            <span translate="no">{detail}</span>
          </Box>
          <ButtonRow cols={2}>
            <SecondaryButton onClick={retake} data-testid="add-same-retake">
              {mx(locale, "same.retake")}
            </SecondaryButton>
            <PrimaryButton href="/p/meds" data-testid="add-same-list">
              {mx(locale, "same.list")}
            </PrimaryButton>
          </ButtonRow>
          <Button variant="link" onClick={() => setStep("check")} data-testid="add-same-check">
            {mx(locale, "same.again")}
          </Button>
        </>
      ),
    });
  }

  // ---- 06-4a: every line of the label, 「对」 or 「改」
  if (step === "check" && read) {
    const current = fields.find((f) => !answered(f)) ?? null;
    const left = fields.filter((f) => !answered(f)).length;
    const reminder = labelSlots()
      .map((s) => (slotFirst[s] ? mx(locale, "check.reminder", { slot: mx(locale, `slot.${s}`), time: shortTime(slotFirst[s]!) }) : mx(locale, "check.reminderNoTime", { slot: mx(locale, `slot.${s}`) })))
      .join(locale === "en" ? ", " : "、");
    return stepScreen("add-check", {
      header: retakeHeader,
      extra: { "data-index": String(current ? fields.indexOf(current) : fields.length), "data-total": String(fields.length) },
      children: (
        <>
          <div className="rpu rpu-kv" data-rp="kv">
            {fields.map((f) => {
              const mine = edits[f];
              const open = editing?.field === f;
              const isCurrent = f === current;
              const state = mine !== undefined || open ? "edit" : confirmed.includes(f) ? "yes" : undefined;
              return (
                <div key={f} className="rpu-kv-row rpu-meds-kv" data-rp="kv-row" data-state={state} data-field={f} data-current={isCurrent ? "true" : undefined} data-testid={`add-row-${f}`}>
                  <div className="rpu-kv-main">
                    <span className="rpu-kv-l">{fieldWords(locale, f)}</span>
                    <span
                      className="rpu-kv-v"
                      data-mono={mine === undefined && PRINTED.includes(f) ? "true" : undefined}
                      translate="no"
                      {...(isCurrent ? { "data-testid": "add-check-value", "data-field": f } : {})}
                    >
                      {mine ?? shown(f, read.fields[f])}
                    </span>
                    {mine !== undefined ? <span className="rpu-kv-s">{mx(locale, "add.youChanged")}</span> : f === "directions" && reminder ? <span className="rpu-kv-s">{reminder}</span> : null}
                  </div>
                  <div className="rpu-kv-btns">
                    <button type="button" className="rpu-kv-btn" data-kv="yes" aria-pressed={state === "yes"} aria-label={`${fieldWords(locale, f)} ${mx(locale, "check.yes")}`} onClick={() => answerRight(f)} data-testid={isCurrent ? "add-line-right" : `add-right-${f}`}>
                      {mx(locale, "check.yes")}
                    </button>
                    <button
                      type="button"
                      className="rpu-kv-btn"
                      data-kv="edit"
                      aria-pressed={state === "edit"}
                      aria-label={`${fieldWords(locale, f)} ${mx(locale, "check.edit")}`}
                      onClick={() => setEditing(open ? null : { field: f, text: mine ?? shown(f, read.fields[f]) })}
                      data-testid={isCurrent ? "add-line-change" : `add-change-${f}`}
                    >
                      {mx(locale, "check.edit")}
                    </button>
                  </div>
                  {open ? (
                    <div className="rpu-meds-kv-edit">
                      <Field id={`rp-med-edit-${f}`} label={mx(locale, "add.changeTo")} value={editing.text} onChange={(e) => setEditing({ field: f, text: e.target.value })} aria-label={fieldWords(locale, f)} autoComplete="off" data-testid="add-edit-input" />
                      <PrimaryButton disabled={!editing.text.trim()} onClick={() => answerChanged(f, editing.text)} data-testid="add-line-changed">
                        {mx(locale, "add.changed")}
                      </PrimaryButton>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          <Dock>
            <p className="rpu-meds-left" role="status" data-testid="add-check-left" data-left={left}>
              {left > 0 ? mx(locale, "check.left", { n: left }) : mx(locale, "check.saving")}
            </p>
          </Dock>
        </>
      ),
    });
  }

  // ---- when he takes it (the label names no time)
  if (step === "slots") {
    return stepScreen("add-slots", {
      header: <PageHeader back={toMeds} title={mx(locale, "add.slots")} subtitle={mx(locale, "add.slotsSub")} locale={locale} />,
      children: (
        <>
          {slotChips}
          <Dock>
            <PrimaryButton onClick={() => saveOrAsk({ kind: "label", c: confirmed, e: edits, chosen: slots }, slots)} disabled={slots.length === 0} data-testid="add-slots-done">
              {mx(locale, "add.slotsDone")}
            </PrimaryButton>
          </Dock>
        </>
      ),
    });
  }

  // ---- 06-5: typed in by himself
  if (step === "manual") {
    return stepScreen("add-manual", {
      tabBar: true,
      header: <PageHeader back={toMeds} title={forMed ? mx(locale, "add.manualFor", { name: forMed.name }) : mx(locale, "add.manual")} subtitle={forMed ? undefined : originWord(locale, origin)} locale={locale} />,
      children: (
        <>
          {aiOffNote}
          <Field id="rp-med-name" label={mx(locale, "add.manualName")} placeholder={mx(locale, "add.manualNameHint")} hint={mx(locale, "manual.hint")} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" data-testid="add-manual-name" />
          <Field id="rp-med-strength" label={mx(locale, "add.manualStrength")} value={strength} onChange={(e) => setStrength(e.target.value)} autoComplete="off" data-testid="add-manual-strength" />
          <div className="rpu-btns">
            <BodyText variant="strong" style={{ marginTop: 0 }}>
              {mx(locale, "add.slots")}
            </BodyText>
            {slotChips}
          </div>
          <Box variant="dash" title={mx(locale, "add.manualNote")} />
          <Dock>
            <PrimaryButton onClick={() => saveOrAsk({ kind: "manual" }, slots)} disabled={!name.trim()} data-testid="add-manual-save">
              {mx(locale, "add.manualSave")}
            </PrimaryButton>
            {/* on every way into typing: the screen that used to offer it before this one is gone (owner's tidy of 10-13) */}
            <SecondaryButton href={laterHref} data-testid="add-later">
              {mx(locale, "add.later")}
            </SecondaryButton>
          </Dock>
        </>
      ),
    });
  }

  // ---- a slot's reminder time, asked once (nothing in his settings says when)
  if (step === "times" && afterTimes) {
    const used = afterTimes.kind === "manual" ? slots : afterTimes.chosen.length ? afterTimes.chosen : labelSlots(afterTimes.e);
    const q = nextAsk(used, times);
    if (q) {
      const picked = timePick ?? q.now;
      // the same range the server keeps (track C's): a time outside it is said here, before anything is sent
      const inRange = /^\d{2}:\d{2}$/.test(picked) && minutesOf(picked) >= minutesOf(q.range.from) && minutesOf(picked) <= minutesOf(q.range.to);
      return stepScreen("add-times", {
        extra: { "data-slot": q.slot, "data-picked": picked },
        header: (
          <PageHeader
            back={toMeds}
            title={q.title.map((line, i) => (
              <Fragment key={i}>
                {i > 0 ? <br /> : null}
                {line}
              </Fragment>
            ))}
            subtitle={mx(locale, "add.timesSub")}
            locale={locale}
          />
        ),
        children: (
          <>
            {/* track C's chips (the question 「我 › 早饭时间和提醒」 asks): the part's usual times and 「别的时间」; keyed by
                the slot so the next question starts from its own time */}
            <TimeChips
              key={q.slot}
              locale={locale}
              times={SLOT_TIME_CHOICES[q.slot]}
              value={picked}
              onChange={(t) => {
                setTimePick(t);
                setTimeProblem(false);
              }}
              testid="add-time"
            />
            {timeProblem ? (
              <div role="alert" data-rp="form-problem">
                <Box variant="red" title={q.rangeWords} testId="add-time-problem" />
              </div>
            ) : null}
            <Dock>
              <PrimaryButton
                data-testid="add-times-done"
                onClick={() => {
                  if (!inRange) return setTimeProblem(true);
                  const given = { ...times, [q.slot]: picked };
                  setTimes(given);
                  saveOrAsk(afterTimes, used, given);
                }}
              >
                {mx(locale, "add.timesDone")}
              </PrimaryButton>
            </Dock>
          </>
        ),
      });
    }
  }

  // ---- a medicine waits for its label, and the server could not tell whether this label is its own: he says
  if (step === "which" && which) {
    const one = which.waiting.length === 1 ? which.waiting[0] : null;
    const nameOf = (m: WaitingMed) => (locale !== "en" && m.zh ? `${m.name} ${m.zh}` : m.name);
    // the name as printed on the label, unless he typed it or changed that line (then it is his word, said as his)
    const printed = !!read && edits.drug_text === undefined;
    return stepScreen("add-which", {
      extra: { "data-waiting": String(which.waiting.length) },
      header: (
        <PageHeader
          back={toMeds}
          title={one ? mx(locale, "add.whichOne", { name: nameOf(one) }) : mx(locale, "add.whichMany")}
          subtitle={one ? mx(locale, "add.whichOneSub", { name: nameOf(one) }) : mx(locale, "add.whichManySub")}
          locale={locale}
        />
      ),
      children: (
        <>
          {which.labelName ? (
            <Timeline>
              {printed ? (
                <TimelineItem node="lab" who={copy.sources.label} testId="add-which-label">
                  <LabelOriginal>{which.labelName}</LabelOriginal>
                </TimelineItem>
              ) : (
                <TimelineItem node="me" who={mx(locale, read ? "add.youChanged" : "add.youTyped")} say={<span translate="no">{which.labelName}</span>} testId="add-which-label" />
              )}
            </Timeline>
          ) : null}
          <Dock>
            {which.waiting.map((m, i) => {
              const Btn = i === 0 ? PrimaryButton : SecondaryButton;
              return (
                <Btn key={m.id} data-testid={`add-which-${m.id}`} data-which="waiting" onClick={() => which.again({ medId: m.id })}>
                  {one ? mx(locale, "add.whichYes") : mx(locale, "add.whichThis", { name: nameOf(m) })}
                </Btn>
              );
            })}
            <SecondaryButton data-testid="add-which-other" onClick={() => which.again({ other: true })}>
              {mx(locale, one ? "add.whichNo" : "add.whichNone")}
            </SecondaryButton>
          </Dock>
        </>
      ),
    });
  }

  // ---- saved
  if (step === "done" && saved) {
    const s = saved.med.dose_slots ?? [];
    const typed = saved.med.status === "unverified";
    return stepScreen("add-done", {
      tabBar: true,
      extra: { "data-med": saved.med.id, "data-status": saved.med.status },
      header: <PageHeader back={toMeds} locale={locale} />,
      children: (
        <>
          <Timeline open>
            <TimelineItem node="ok" title={mx(locale, "add.done")} />
            <TimelineItem
              node={typed ? "me" : "lab"}
              frame="card"
              title={<span translate="no">{saved.name}</span>}
              note={s.length ? mx(locale, "add.doneSlots", { slots: slotWords(locale, s) }) : mx(locale, "add.doneNoSlots")}
              // the tag in its own row, as wide as its words (alone in the entry's column it stretched across the card)
              actions={
                typed ? (
                  <TlControls>
                    <Tag>{mx(locale, "status.unverified")}</Tag>
                  </TlControls>
                ) : undefined
              }
            />
          </Timeline>
          <div className="rpu rpu-btns rpu-ind">
            {onward}
            {openCard(saved.med.id)}
            <SecondaryButton href={returnHref ? "/p/meds/add?from=onboard" : "/p/meds/add"}>{mx(locale, "add.another")}</SecondaryButton>
          </div>
        </>
      ),
    });
  }

  // ---- 08-1b, 08-2: nobody identified it: the fixed sentence (lib/safety), his question for the pharmacist, his choice
  if (step === "unknown" && saved) {
    const label = saved.med.label as StoredLabel | null;
    const printed = boxName(saved.med);
    const onList = !!saved.questions?.length || !!label?.question_id;
    return stepScreen("add-unknown", {
      tabBar: true,
      extra: { "data-med": saved.med.id },
      header: <PageHeader back={toMeds} title={mx(locale, "add.unknownTitle")} locale={locale} />,
      children: (
        <>
          {photo}
          <Timeline>
            {printed ? (
              <TimelineItem node="lab" who={copy.sources.label}>
                <LabelOriginal lang="zh-Hans">{printed}</LabelOriginal>
              </TimelineItem>
            ) : null}
            {saved.answer?.fixedText ? (
              <TimelineItem
                node="rip"
                testId="add-unknown-sentence"
                say={
                  <>
                    <span lang="en">{saved.answer.fixedText}</span>
                    {locale === "zh-Hans" && saved.answer.fixedTextZh ? (
                      <>
                        {"\n"}
                        {saved.answer.fixedTextZh}
                      </>
                    ) : null}
                  </>
                }
              />
            ) : null}
            {onList ? (
              <TimelineItem
                node="ok"
                title={mx(locale, "add.questionAdded")}
                testId="add-unknown-on-list"
                actions={
                  <Acts>
                    <Act variant="outline" href="/p/questions">
                      {mx(locale, "card.seeList")}
                    </Act>
                  </Acts>
                }
              />
            ) : null}
          </Timeline>
          <UnknownChoices medId={saved.med.id} locale={locale} initial={label?.patient_status ?? null} onListInitially={!!label?.doctor_question_id} listLink={!onList} hooks="add" />
          <Dock>
            {onward}
            {openCard(saved.med.id)}
          </Dock>
        </>
      ),
    });
  }

  // ---- the label names another medicine than the doctor prescribed
  if (step === "mismatch") {
    return stepScreen("add-mismatch", {
      tabBar: true,
      header: <PageHeader back={toMeds} locale={locale} />,
      children: (
        <>
          <Timeline>
            <TimelineItem node="rip" say={mx(locale, "add.mismatch")} />
            {/* his question for the pharmacist, in the words the list keeps for him */}
            {mismatchQuestion ? <TimelineItem node="me" who={copy.askPharmacist} say={mismatchQuestion} /> : null}
            {mismatchQuestion ? (
              <TimelineItem
                node="ok"
                title={mx(locale, "add.questionAdded")}
                actions={
                  <Acts>
                    <Act variant="outline" href="/p/questions">
                      {mx(locale, "card.seeList")}
                    </Act>
                  </Acts>
                }
              />
            ) : null}
          </Timeline>
          <Dock>{onward ?? <PrimaryButton href="/p/meds">{mx(locale, "add.back")}</PrimaryButton>}</Dock>
        </>
      ),
    });
  }

  // ---- the medicine he typed is on his list already
  if (step === "exists") {
    return stepScreen("add-exists", {
      tabBar: true,
      header: <PageHeader back={toMeds} locale={locale} />,
      children: (
        <>
          <Box variant="line" title={mx(locale, "add.exists")} />
          <Dock>
            {onward}
            {openCard(existingId)}
          </Dock>
        </>
      ),
    });
  }

  // ---- something did not work: what it was, what is still there, what he can do
  return stepScreen("add-error", {
    tabBar: true,
    extra: { "data-problem": problem },
    header: <PageHeader back={toMeds} locale={locale} />,
    children: (
      <>
        <div role="alert">
          <Box variant="red" title={mx(locale, problem === "unreadable" ? "add.unreadable" : "add.failed")}>
            {mx(locale, "error.listSame")}
          </Box>
        </div>
        <div className="rpu-btns">
          <PrimaryButton onClick={() => setStep(aiOff ? "manual" : "photo")} data-testid="add-retry">
            {mx(locale, "add.retake")}
          </PrimaryButton>
          {!forMed ? (
            <SecondaryButton onClick={() => setStep("manual")} data-testid="add-error-manual">
              {mx(locale, "add.manual")}
            </SecondaryButton>
          ) : null}
          <SecondaryButton href={laterHref}>{mx(locale, "add.later")}</SecondaryButton>
        </div>
      </>
    ),
  });
}

/** The printed name of a box (the label's medicine line), or null. */
function boxName(med: MedicationRow): string | null {
  return (med.label as StoredLabel | null)?.drug_text?.trim() || null;
}

function originWord(locale: MedsLocale, o: MedOrigin): string {
  const words: Record<MedOrigin, [string, string]> = {
    prescription: ["医生开的", "From the doctor"],
    self_bought: ["自己买的", "Bought myself"],
    relative: ["亲戚带的", "From a relative"],
    supplement: ["保健品", "Supplements"],
  };
  return words[o][locale === "en" ? 1 : 0];
}

function sampleWord(locale: MedsLocale, s: AccountSampleLabel): string {
  const words: Record<AccountSampleLabel, [string, string]> = {
    amlodipine: ["示例：诊所药袋（amlodipine）", "Sample: clinic label (amlodipine)"],
    losartan: ["示例：诊所药袋（losartan）", "Sample: clinic label (losartan)"],
    ibuprofen: ["示例：止痛药盒（ibuprofen）", "Sample: painkiller box (ibuprofen)"],
    relative_box: ["示例：亲戚带的药盒", "Sample: box from a relative"],
  };
  return words[s][locale === "en" ? 1 : 0];
}
