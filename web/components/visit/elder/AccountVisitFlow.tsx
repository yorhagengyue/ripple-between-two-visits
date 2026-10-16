"use client";

/**
 * /p/visit on his account (C2 track F, track V; real-app 2.12-2.14, 2.25, 4.4, 4.6), laid out after the timeline draft's
 * 05 group (web/progress/fe-05.md). Every screen is a header, the page's blocks, and a white strip at the foot of the
 * screen with the question and its buttons (./parts.tsx VisitDock). The screens, in order:
 *
 *   where      the visit tab (owner's decision of 10-14: the visit page and the question list are one tab, short):
 *              recordings this phone still holds (「上次的录音（…）还没传」 + 「现在传」), the visits not finished (one
 *              whose text the server could not make says so), then ./VisitHub.tsx: his visits as one timeline (the
 *              earlier ones open in place to the lines he confirmed; the next one, with 「我约的日子」 and the brief for
 *              the doctor; on the example account today's planned row is the sample visit: a tap plays it, marked
 *              「示例回放」), what to tell the doctor, his question list. One button, 「开始就诊」: the card for the doctor,
 *              at the clinic (the 诊所就诊 / 药房 choice and 「先给医生看简报」 / 「直接开始」 are gone). A blank account
 *              has the same screen, its timeline saying 「暂无就诊记录」 (2.25)
 *   booking    「我约的日子」 (?plan=<id>): the day he booked for a planned follow-up (real-app 2.15), a date field
 *   consent    05-1: the card for the doctor (English, 「FOR THE DOCTOR」). 「医生同意了，开始录」 asks for the microphone
 *              first: only when it is running is the visit started. 「医生不同意」 is saved before the screen says so; a
 *              failed save says so and can be tried again. Both answers go with `assisted` (someone is helping him on
 *              his device: what sign-up recorded; the server refuses a recording without the doctor's answer)
 *   nomic      the microphone was refused or is missing: said plainly in the red-bordered box (the draft's 通用-2),
 *              nothing that looks like a recording, no visit started; he can try again or go back
 *   live       05-2: recording: the ink bar with the red dot and the time, the last two captions as a line of two
 *              entries when there are live captions, how many things were noted, one 「录完了」; no tab bar and no 「我」
 *              (a stray tap must not take him off the page). The sample replay has no recording bar (nothing is
 *              recorded): it carries 「示例回放」 on every screen, after a reload too (4.6). 05-10: once the server has
 *              put the visit's own list together (view.qlist: near the end of the visit, as it reads the lines),
 *              「离开前要问的（N 个）」 opens it in the captions' place; a question the recording heard him ask is ticked
 *   reopened   an unfinished visit opened again (?visit=<id>: its row, the review's 「接着结束」, a reload). Nothing is
 *              recording on this screen, so it never shows the recording bar: the recording this phone kept and 「现在
 *              传」; or 「录音已经存好」 and 「接着结束」 when the server has it; or that this phone has none
 *   ending     the recording is saved (「正在存录音……」), then turned into text (「正在整理成文字……」, with 「录音已经存
 *              下来了」 above it once the server has taken the recording); no tab bar and no 「我」 here either
 *   error      something did not work: the recording is still on the phone, 「再传一次」 (通用-2 again)
 *
 * His recording on the phone (components/visit/elder/recording-store.ts, kept.ts): while he records, a copy goes into
 * IndexedDB every 10 s, filed under his own space; what is left is written when he ends the visit, when the page goes
 * to the background or is closed, and before any upload. Ending always sends a recording when there is one: this
 * page's own, else the copy kept on the phone (a visit opened again has no recorder). The phone copy is deleted in one
 * case only: the server has the recording on the visit (asked again after the upload). Never for a visit that is not
 * on a list, never by a button.
 *
 * Ending uploads the recording (16 kHz WAV through a signed link) and asks for the whole-visit transcript: with a
 * transcription service it becomes the review; without one (mock speech on an account) the visit waits for its text,
 * never the demo's script, and the first screens say so (2.14).
 *
 * C2 track R (long visits; lib/visit/parts.ts, ./upload-recording.ts): what is uploaded is the copy on the phone, and
 * this page holds no recording in memory. A recording that fits in one part (20 minutes) goes as one file, exactly as
 * before; a longer one goes as consecutive files, each confirmed by the server before the next, and a failed upload
 * goes on from the first part the server does not have. Nothing on the recording screen is different for it, and no
 * screen speaks of parts: while a long recording is being saved, the saving screen says how many minutes are saved
 * of how many. What could still keep a recording from being kept or sent is said before it happens, in one sentence:
 * the phone's room, on the card for the doctor (under half an hour left) and while recording (under ten minutes; and
 * when the phone refuses a write, that the recording now lives in this page only); and a recording left running, which
 * ends itself after nine parts (three hours) and says so ten minutes before.
 *
 * Live captions: with Whisper (SPEECH_PROVIDER=whisper) the microphone's blocks go to LiveWhisperClient (lib/asr/live-
 * client, as the demo's VisitFlow): 2-3 s 16 kHz mono WAV chunks and whole lines to /api/asr/chunk, the last two lines
 * shown as they grow. The blocks recorded before the client exists (it waits for /api/asr/realtime-token) are handed
 * to it first. When the service does not answer, at the start or mid-visit, the captions stop and say so and the
 * recording goes on; the formal transcript comes from the recording after 「录完了」 (never the script: an account's
 * own visit has no replay; a filming account's misheard lines are the crew's scripted fallback, on the server).
 * The developer tools' stand-in (SPEECH_PROVIDER=devfake) plays the fixture the test names as captions; mock speech has
 * none and says so. With Tencent Cloud speech recognition (SPEECH_PROVIDER=tencent, lib/asr/tencent.ts) only whole lines
 * are sent (the token says partials: false; each request is a paid recognition task), so a caption appears when its line
 * is done, 2-3 s after he pauses, and "captions are late" waits for the token's delay_ms.
 *
 * Ripple's live notes (owner's decision of 10-14; lib/visit/ripple-summary.ts): while he records, the event visit.summary
 * (stage live) brings the latest points, at most every 15 s; they are drawn above the captions as 「实时总结」 with
 * 「Ripple 根据录到的话整理，未经确认」 (./RippleNotes.tsx). The server writes none without his consent to AI processing or
 * with the offline model: then the captions are alone, as before. Ripple's words, never the record.
 *
 * Who is speaking (scene 1, owner 10-15; lib/visit/speakers.ts): every caption names its speaker as the server has it,
 * from the voices and the words: 「医生」 (a guessed clinician's node, until he checks it), 「你」 for his own lines, his
 * daughter's name (his link's label for her, else 「家人」), or the plain caption's node while nobody can tell yet. A
 * line's speaker may change as more lines come (utterance.role): the caption follows. One quiet line under the captions
 * says it is Ripple's guess, checked by him after the visit. The live notes grow large by themselves for a few seconds
 * when a point arrives or changes (./RippleNotes.tsx, components/visit/SummaryFocus.tsx); a tap shows them large too.
 *
 * The layout's live connection re-reads this page after data events (router.refresh), also while he records: the
 * component is never keyed on the visit, and a visit named in the address is opened by an effect, never by a remount.
 * No clinical words of the app's own; the captions are the record's words.
 */
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveEvent } from "@/components/live/LiveSession";
import { Box, Button, DarkButton, Field, ForDoctorCard, ListCard, ListItem, PageHeader, PrimaryButton, Screen, SecondaryButton, TabBar, Tag, Timeline, TimelineItem } from "@/components/ui";
import { EarlyBlocks, type Block } from "@/lib/asr/early-blocks";
import { LiveWhisperClient } from "@/lib/asr/live-client";
import type { LiveTuning } from "@/lib/asr/segmenter";
import type { BusEvent } from "@/lib/bus";
import { ApiError, fetchSignedIn, postJson } from "@/lib/session/client";
import { fill, uiCopy } from "@/lib/ui/copy";
import { at, clipTimeLabel, shortDate, type AccountLocale } from "@/lib/visit/account-copy";
import { CONSENT_CARD_EN } from "@/lib/visit/consent";
import { minutesOfRoom, PART_MS, recordingLimit } from "@/lib/visit/parts";
import { vt } from "@/lib/visit/strings";
import type { QItemView, VisitView } from "@/lib/visit/types";
import type { NodeKind } from "@/lib/ui/tokens";
import type { RoleState, UtteranceRole } from "@/lib/store/types";
import { useWavRecorder } from "../useWavRecorder";
import { classifyKept, uploadConfirmed, type KnownVisit } from "./kept";
import { HeldRecording } from "./HeldRecording";
import { MicCheck } from "./MicCheck";
import { rememberMic, settleMic, startRecording } from "../mic-devices";
import { OneAudio } from "./OneAudio";
import { Heading, Problem, RecBar, VisitDock, VisitHeader } from "./parts";
import { chunkKeeper, dropConfirmed, keptSource, pendingRecordings, type PendingRecording } from "./recording-store";
import { RippleNotes } from "./RippleNotes";
import { uploadRecording, type UploadApi, type UploadProgress } from "./upload-recording";
import { vw } from "./words";
// owner 10-14: the visit tab's first screen (the timeline, what to tell the doctor, the question list)
import type { VisitHubData } from "@/lib/visit/hub";
import { VisitHub } from "./VisitHub";

export interface UnfinishedVisit {
  id: string;
  status: "recording" | "transcribing" | "awaiting_transcript" | "review";
  /** 「10月12日」 */
  date: string;
  /** waiting for its text, and the server used up its attempts: the recording is kept, the text could not be made */
  failed?: boolean;
  /** the example's recorded visit, played and left before its end: a replay, never a visit of his own (「示例回放」) */
  sample?: boolean;
}

export interface PlannedVisit {
  id: string;
  /** planned for today: recording at the clinic continues this row */
  today: boolean;
  /** 「今天的复诊（计划）」 / 「大约 11月20日的复诊（计划）」 / 「11月21日的复诊（计划）」 */
  label: string;
  /** its day now, ISO */
  date: string;
  /** he may set the day he booked (never the example's sample visit) */
  canBook: boolean;
  /** where it is, in the screen's words (lib/visit words.ts placeWords): the grey line under the row */
  place?: string;
}

export interface PastVisit {
  id: string;
  label: string;
  /** 「10月12日」 and where it was, apart: the row's title and the grey line under it (absent: `label` alone) */
  date?: string;
  place?: string;
}

type Phase = "where" | "booking" | "consent" | "declined" | "nomic" | "live" | "reopened" | "ending" | "error";
type Place = "clinic" | "pharmacy";

interface Caption {
  id: string;
  text: string;
  tStart: number;
  /** who said it as the server has it (scene 1): Ripple's guess until he checks it; absent: not known yet */
  role?: UtteranceRole;
  roleState?: RoleState;
}

/** a line Whisper heard, as /api/asr/chunk stores it */
interface LiveLine {
  id: string;
  text: string;
  t_start_ms: number;
  t_end_ms: number;
  role?: UtteranceRole;
  role_state?: RoleState;
}

/** Ripple's live notes of the recording: the latest points (its own words, never the record), in his language */
interface LiveNotes {
  points: string[];
  lang: AccountLocale;
}

/** the captions kept: at most the last four, in recording order (the screen shows the last two); a caption keeps the speaker it had when the new copy does not say one */
const upsertCaptions = (cs: Caption[], add: Caption[]): Caption[] =>
  [...cs.filter((c) => !add.some((a) => a.id === c.id)), ...add.map((a) => (a.role ? a : { ...a, role: cs.find((c) => c.id === a.id)?.role, roleState: cs.find((c) => c.id === a.id)?.roleState }))]
    .sort((a, b) => a.tStart - b.tStart)
    .slice(-4);

/** A stored line as a caption, with its speaker. */
const captionOf = (u: { id: string; text: string; t_start_ms: number; role?: UtteranceRole; role_state?: RoleState }): Caption => ({
  id: u.id,
  text: u.text,
  tStart: u.t_start_ms,
  ...(u.role ? { role: u.role, roleState: u.role_state } : {}),
});

/** The node a caption is drawn with: a guessed clinician's until he checks it, his own, his daughter's, or a plain point. */
function captionNode(c: Caption): NodeKind {
  if (c.role === "doctor" || c.role === "pharmacist" || c.role === "dispenser") return c.roleState === "confirmed" ? "doc" : "unc";
  if (c.role === "patient") return "me";
  if (c.role === "family") return "dau";
  return "dot";
}

/** a newer screen state never goes back to an older one (the event stream may be ahead of a chunk's answer) */
const newerView = (cur: VisitView | null, next: VisitView): VisitView =>
  cur && cur.visit.id === next.visit.id && cur.lines.length > next.lines.length ? cur : next;

const pad = (n: number) => String(n).padStart(2, "0");
const elapsedLabel = (ms: number) => `${pad(Math.floor(ms / 60_000))}:${pad(Math.floor((ms % 60_000) / 1000))}`;

/** The sample visit (the example account's follow-up with its recorded example, or a copy played again): a replay, never a recording of his. */
const isSample = (v: VisitView | null): boolean => v?.account?.sample ?? !!v?.replayable;

/** A question of the visit's own list, in the words it is shown with (his own; else Ripple's wording in the screen's language). */
const questionText = (locale: AccountLocale, q: QItemView): string => q.text.own ?? (locale === "zh-Hans" ? (q.text.zh ?? q.text.en) : (q.text.en ?? q.text.zh)) ?? "";

/** A caption's own language, as far as its letters say (nobody has said yet whose line it is). */
const captionLang = (text: string): AccountLocale => (/[一-鿿]/.test(text) ? "zh-Hans" : "en");

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin", cache: "no-store" });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? "request_failed");
  return data as T;
}

/** The server's side of an upload (./upload-recording.ts): one link and one PUT per file; for a long recording, the server's list of parts. */
const uploadApi: UploadApi = {
  link: (visitId) => postJson("/api/upload-url", null, { kind: "recording", content_type: "audio/wav", visit_id: visitId }),
  put: async (link, file) => (await fetch(link.url, { method: link.method, headers: link.headers, body: file })).ok,
  parts: (visitId) => getJson(`/api/visits/${encodeURIComponent(visitId)}/parts`),
  register: (visitId, seq, path) => postJson(`/api/visits/${encodeURIComponent(visitId)}/parts`, null, { seq, path }),
};

/** He is told on the card for the doctor when the phone has room for less than this many minutes of recording ... */
const ROOM_BEFORE_MIN = 30;
/** ... and while recording when it is less than this. */
const ROOM_RECORDING_MIN = 10;

/** Minutes of recording this phone still has room for, as far as the browser says (null: it does not say). */
async function roomMinutes(): Promise<number | null> {
  try {
    const est = await navigator.storage?.estimate?.();
    if (!est || typeof est.quota !== "number" || typeof est.usage !== "number") return null;
    return minutesOfRoom(est.quota - est.usage);
  } catch {
    return null;
  }
}

/** Why the recorder did not start: the permission was refused, or this phone has no microphone it can use. */
async function micProblem(): Promise<"denied" | "unavailable"> {
  try {
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === "undefined") return "unavailable";
    const perm = await navigator.permissions?.query({ name: "microphone" as PermissionName }).catch(() => null);
    if (perm?.state === "denied") return "denied";
    const devices = await navigator.mediaDevices.enumerateDevices().catch(() => [] as MediaDeviceInfo[]);
    return devices.some((d) => d.kind === "audioinput") ? "denied" : "unavailable";
  } catch {
    return "denied";
  }
}

export function AccountVisitFlow({
  locale,
  story,
  clinic = null,
  owner,
  assisted,
  today,
  known,
  unfinished,
  planned,
  past,
  sample,
  speech,
  initialView,
  initialStep,
  speed = 1,
  partMs = PART_MS,
  hub,
  family = null,
}: {
  locale: AccountLocale;
  /** the top line: 「10月12日 周一 · 上午 9:30」 */
  story: string;
  /** the name of the clinic a visit recorded now is filed under (his own clinic, as he told the app); null: none on record */
  clinic?: string | null;
  /** the name the recordings kept on this phone are filed under: a one-way stand-in for his space (lib/blob/prefix.ts) */
  owner: string;
  /** someone is helping him on his device (what sign-up recorded): kept with the doctor's yes or no (real-app 3.11) */
  assisted: boolean;
  /** today in his own dates, ISO: the first day a follow-up can be booked on */
  today: string;
  /** every visit of his as the server has it: what a kept recording's visit still needs (./kept.ts) */
  known: KnownVisit[];
  unfinished: UnfinishedVisit[];
  planned: PlannedVisit[];
  past: PastVisit[];
  /** the example account's sample visit (today's planned follow-up with its recorded example) */
  sample: { fixture: string } | null;
  /** this server's transcription: "mock" is none (the first screens say so, real-app 2.14) */
  speech: "mock" | "trtc" | "whisper" | "tencent" | "devfake";
  /** ?visit=<id>: an unfinished visit, opened again */
  initialView: VisitView | null;
  /** back from the brief for the doctor: the card, at the place he chose */
  initialStep: { step: "consent"; place: Place } | null;
  /** the live captions' clock (tests); 1 = real time */
  speed?: number;
  /** how much audio one uploaded file holds at most (lib/visit/parts.ts: 20 minutes; a test's small one) */
  partMs?: number;
  /** the tab's first screen besides the visits' own rows (lib/visit/hub.ts): the earlier visits' records, what to tell the doctor, the question list */
  hub: VisitHubData;
  /** scene 1: how his captions name his daughter (his link's label for her: her name); null: 「家人」 */
  family?: string | null;
}) {
  const router = useRouter();
  const search = useSearchParams();
  const urlVisit = search.get("visit");
  /** ?plan=<id>: 「我约的日子」 for that planned follow-up */
  const urlPlan = search.get("plan");
  const booking = urlPlan ? (planned.find((p) => p.id === urlPlan && p.canBook) ?? null) : null;
  // the recording is kept on the phone as it is made and uploaded from there: never whole in this page's memory
  const recorder = useWavRecorder({ hold: false });
  const copy = uiCopy(locale);
  /** the screen he starts from: the tab's first screen, also with nothing on it yet (its timeline says so, real-app 2.25) */
  const first: Phase = "where";
  const [phase, setPhaseState] = useState<Phase>(() => (initialView ? (isSample(initialView) ? "live" : "reopened") : initialStep ? "consent" : booking ? "booking" : first));
  const phaseRef = useRef<Phase>(phase);
  const setPhase = (p: Phase) => {
    phaseRef.current = p;
    setPhaseState(p);
  };
  const [place, setPlace] = useState<Place>(initialStep?.place ?? "clinic");
  const [mode, setMode] = useState<"record" | "replay">(isSample(initialView) ? "replay" : "record");
  const [view, setView] = useState<VisitView | null>(initialView);
  const [captions, setCaptions] = useState<Caption[]>([]);
  /**
   * Ripple's live notes of this recording (the event visit.summary, stage live; lib/visit/ripple-summary.ts): the latest
   * points, null until the first. None come without his consent to AI processing or with the offline model: then the
   * screen shows the captions alone, as before
   */
  const [notes, setNotes] = useState<LiveNotes | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<"saving" | "transcribing">("saving");
  /** while the text is made: the server was handed this visit's recording (the saving screen then says it is saved) */
  const [handedOver, setHandedOver] = useState(false);
  const [error, setError] = useState<"upload" | "failed" | null>(null);
  const [declineFailed, setDeclineFailed] = useState(false);
  const [bookDate, setBookDate] = useState<string>(booking?.date ?? "");
  const [bookFailed, setBookFailed] = useState(false);
  const [mic, setMic] = useState<"denied" | "unavailable">("denied");
  const [startedAt, setStartedAt] = useState<number | null>(null);
  /** while recording: the list 「离开前要问的」 is on the screen in place of the captions (the draft's 05-10) */
  const [leaving, setLeaving] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const visitId = useRef<string | null>(initialView?.visit.id ?? null);
  /**
   * What this page got onto the server for the visit this screen is on, until the visit is finished. `path`: the
   * recording's (the first part's, for a long one); `parts`: how many files it is (null: one, as before).
   */
  const pending = useRef<{ visitId: string | null; path: string | null; parts: number | null }>({ visitId: null, path: null, parts: null });
  /** how far the saving of a long recording is (null: one file, or not saving) */
  const [sent, setSent] = useState<UploadProgress | null>(null);
  /** what he is told while recording, before it could go wrong: the phone's room, a recording left running */
  const [warn, setWarn] = useState<string | null>(null);
  /** minutes of recording the phone has room for, asked when the card for the doctor is shown (null: not known) */
  const [roomBefore, setRoomBefore] = useState<number | null>(null);
  const room = useRef<{ at: number; min: number | null }>({ at: 0, min: null });
  const wake = useRef<{ release(): Promise<void> } | null>(null);
  /** the recording kept on the phone every 10 s (IndexedDB), until the server has it */
  const keeper = useRef<ReturnType<typeof chunkKeeper> | null>(null);
  /** the visit that keeper records (what it still holds in memory is that visit's, and no other's) */
  const keeperVisit = useRef<string | null>(null);
  /** his recordings on this phone (null: not looked up yet) */
  const [kept, setKept] = useState<PendingRecording[] | null>(null);
  /** Whisper's live captions on this visit (null: none, or they stopped) */
  const live = useRef<LiveWhisperClient<VisitView, LiveLine> | null>(null);
  /** the recorder's blocks until the live client exists (null: not buffering) */
  const early = useRef<EarlyBlocks | null>(null);
  /** live lines already stored (a late chunk caption for them is ignored) */
  const finals = useRef<Set<string>>(new Set());

  // leaving the page: no more live chunks from this screen, what was recorded so far goes to the phone, the microphone
  // is let go
  const stopRecorder = recorder.stop;
  useEffect(
    () => () => {
      void live.current?.stop(0);
      live.current = null;
      void keeper.current?.flush();
      void stopRecorder();
    },
    [stopRecorder],
  );

  // the page goes to the background or is closed (the phone is locked, another app, the tab is closed): what was
  // recorded since the last 10 s copy is written to the phone now (real-app 2.13)
  useEffect(() => {
    const save = () => void keeper.current?.flush();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") save();
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", save);
    // a reload or the back button: asked before the page is taken down, while a write still has time to land (by
    // pagehide the browser may already be discarding the page's writes; measured, 10-10). Never a prompt.
    window.addEventListener("beforeunload", save);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", save);
      window.removeEventListener("beforeunload", save);
    };
  }, []);

  // his recordings on this phone, whenever the server's list of his visits changes: a copy whose visit already has its
  // recording on the server is no longer needed (dropped, with the server's path as the proof); every other copy stays
  const knownKey = JSON.stringify(known);
  useEffect(() => {
    let gone = false;
    void (async () => {
      const by = new Map(known.map((v) => [v.id, v]));
      const still: PendingRecording[] = [];
      for (const k of await pendingRecordings(owner)) {
        const v = by.get(k.visitId);
        if (classifyKept(v) === "saved" && (await dropConfirmed(owner, k.visitId, { serverAudioPath: v?.audioPath }))) continue;
        still.push(k);
      }
      if (!gone) setKept(still);
    })();
    return () => {
      gone = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owner, knownKey]);

  /** the recordings to offer on the first screen: their visits still need them */
  const offers = useMemo(() => {
    const by = new Map(known.map((v) => [v.id, v]));
    return (kept ?? []).filter((k) => classifyKept(by.get(k.visitId)) === "offer");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kept, knownKey]);

  /**
   * The recordings this phone keeps that are not offered for sending (./kept.ts "hold": the server does not list the
   * visit, or the visit already has its record): said on the visit tab, where he can listen to them (./HeldRecording.tsx)
   */
  const holds = useMemo(() => {
    const by = new Map(known.map((v) => [v.id, v]));
    return (kept ?? []).filter((k) => classifyKept(by.get(k.visitId)) === "hold");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kept, knownKey]);

  /** Back to the first screen (the address loses its ?visit=): what this phone keeps is offered there. */
  function reset() {
    visitId.current = null;
    setView(null);
    setCaptions([]);
    setNotes(null);
    setNotice(null);
    setError(null);
    setDeclineFailed(false);
    setLeaving(false);
    setMode("record");
    setPhase(first);
    if (typeof window !== "undefined" && window.location.search) window.history.replaceState(null, "", "/p/visit");
  }

  // a visit named in the address (its row on this page, the review's 「接着结束」): opened here, without a remount.
  // Only while the address names it (after 「返回」 the page's data may still carry it for a moment), and never while
  // this screen records or sends: the layout re-reads the page during a recording too
  const openId = initialView?.visit.id ?? null;
  useEffect(() => {
    if (!initialView || urlVisit !== initialView.visit.id || visitId.current === initialView.visit.id) return;
    if (phaseRef.current === "live" || phaseRef.current === "ending") return;
    visitId.current = initialView.visit.id;
    setView(initialView);
    setCaptions([]);
    setNotes(null);
    setNotice(null);
    setError(null);
    setMode(isSample(initialView) ? "replay" : "record");
    setPhase(isSample(initialView) ? "live" : "reopened");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId, urlVisit]);

  // the address lost its ?visit= (the 看诊 tab): leave a screen about that visit for the first screen
  useEffect(() => {
    if (urlVisit) return;
    const p = phaseRef.current;
    if (p === "reopened" || p === "error" || p === "nomic") reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlVisit]);

  // 「我约的日子」 named in the address (the planned row's link): its screen, and back to the list when the address
  // loses it (saved, or 「返回」)
  const bookingId = booking?.id ?? null;
  useEffect(() => {
    const p = phaseRef.current;
    if (booking && p === "where") {
      setBookDate(booking.date);
      setBookFailed(false);
      setPhase("booking");
    } else if (!booking && p === "booking") {
      setPhase(first);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingId]);

  // back from the brief for the doctor: the address goes back to the plain visit page (a reload starts from the top)
  useEffect(() => {
    if (initialStep && window.location.search) window.history.replaceState(null, "", "/p/visit");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the timer while recording
  useEffect(() => {
    if (phase !== "live") return;
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [phase]);

  // the phone's room for a recording, asked as the card for the doctor comes up: said there, before anything is recorded
  useEffect(() => {
    if (phase !== "consent") return;
    let gone = false;
    void roomMinutes().then((min) => {
      if (!gone) setRoomBefore(min);
    });
    return () => {
      gone = true;
    };
  }, [phase]);

  // while he records (every tick of the timer): a recording left running ends itself after the longest the phone
  // makes, and says so before; the phone's room is asked again now and then; a write the phone refused is said at once
  useEffect(() => {
    if (phase !== "live" || mode !== "record") return;
    const k = keeper.current;
    if (!k) return;
    const limit = recordingLimit(k.recordedMs(), partMs);
    if (limit.state === "stop") {
      void end();
      return;
    }
    if (now - room.current.at > 20_000) {
      room.current.at = now;
      void roomMinutes().then((min) => (room.current.min = min));
    }
    const left = room.current.min;
    setWarn(
      k.refused()
        ? at(locale, "visit.room.full")
        : limit.state === "soon"
          ? at(locale, "visit.limit.soon", { min: Math.max(1, Math.ceil(limit.leftMs / 60_000)) })
          : left !== null && left < ROOM_RECORDING_MIN
            ? at(locale, "visit.room.soon", { min: Math.max(1, left) })
            : null,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, phase, mode]);

  // keep the screen on while recording (taken again when he comes back to the page)
  useEffect(() => {
    if (phase !== "live") {
      void wake.current?.release().catch(() => undefined);
      wake.current = null;
      return;
    }
    const nav = navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<{ release(): Promise<void> }> } };
    const take = () => void nav.wakeLock?.request("screen").then((l) => (wake.current = l)).catch(() => undefined);
    take();
    const onVisible = () => document.visibilityState === "visible" && take();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [phase]);

  useLiveEvent((event: BusEvent) => {
    const id = visitId.current;
    if (!id) return;
    const d = event.data as {
      visit_id?: string;
      utterance?: { id: string; text: string; t_start_ms: number };
      utterances?: { id: string; text: string; t_start_ms: number; role?: UtteranceRole; role_state?: RoleState }[];
      changes?: { id: string; role: UtteranceRole; state: RoleState }[];
      view?: VisitView;
      stage?: string;
      lang?: string;
      points?: { text?: unknown }[];
    };
    if (d?.visit_id !== id) return;
    if (event.type === "utterance.role") {
      // scene 1: who said a line, decided again (the model's vote came, the voices were grouped again): the captions follow
      const changes = new Map((d.changes ?? []).map((c) => [c.id, c]));
      if (changes.size) setCaptions((cs) => cs.map((c) => (changes.has(c.id) ? { ...c, role: changes.get(c.id)!.role, roleState: changes.get(c.id)!.state } : c)));
      const next = d.view;
      if (next) setView((cur) => newerView(cur, next));
      return;
    }
    if (event.type === "visit.summary") {
      // Ripple's live notes: the latest points replace the ones on screen (the final summary is the review's)
      const points = (d.points ?? []).map((p) => p.text).filter((t): t is string => typeof t === "string" && t.trim() !== "");
      if (d.stage === "live" && points.length) setNotes({ points, lang: d.lang === "en" ? "en" : "zh-Hans" });
      return;
    }
    if (event.type === "asr.partial" && d.utterance) {
      const u = d.utterance;
      if (finals.current.has(u.id)) return;
      setCaptions((cs) => upsertCaptions(cs, [{ id: u.id, text: u.text, tStart: u.t_start_ms }]));
    } else if (event.type === "asr.final") {
      const done = d.utterances ?? [];
      for (const u of done) finals.current.add(u.id);
      setCaptions((cs) => upsertCaptions(cs, done.map(captionOf)));
      const next = d.view;
      if (next) setView((cur) => newerView(cur, next));
    }
  }, ["asr.partial", "asr.final", "visit.summary", "utterance.role"]);

  async function begin(kind: "record" | "replay", where: Place = place) {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    setWarn(null);
    setSent(null);
    setError(null);
    setLeaving(false);
    // the microphone's blocks until the visit has its id (they go to the phone copy and the captions first)
    const firstBlocks: Block[] = [];
    let recording = false;
    try {
      if (kind === "record") {
        // the microphone first. Without it nothing starts: no visit, and nothing on the screen that looks like a
        // recording (real-app 第三波必修: 没有麦克风时直接说清楚，不显示假的计时)
        // the microphone kept for this browser first (../mic-devices.ts), else the default; a silent one is replaced below
        recording = await startRecording(recorder);
        if (!recording) {
          setMic(await micProblem());
          setPhase("nomic");
          return;
        }
        recorder.setListener((block, rate) => firstBlocks.push({ block, rate }));
        setStartedAt(Date.now());
        // 10-15: a microphone that sends nothing (a headset that is off) is replaced by one with sound, by itself
        void settleMic(recorder).catch(() => null);
      }
      const out = await postJson<{ view: VisitView }>(
        "/api/visits",
        null,
        kind === "replay" ? { mode: "replay", fixture: sample?.fixture } : { mode: "record", consent: { given: true, assisted }, place: where },
      );
      const v = out.view;
      visitId.current = v.visit.id;
      setView(v);
      setCaptions([]);
      setNotes(null);
      setMode(kind);
      pending.current = { visitId: v.visit.id, path: null, parts: null };
      setPhase("live");
      window.history.replaceState(null, "", `/p/visit?visit=${encodeURIComponent(v.visit.id)}`);
      if (kind === "replay") {
        await postJson(`/api/visits/${encodeURIComponent(v.visit.id)}/replay`, null, { speed, source: "replay" });
        return;
      }
      // a copy on the phone every 10 s, so a closed page or a flat battery loses nothing; and, until the live client
      // exists, the blocks it will be handed first (his first words reach the captions too)
      keeper.current = chunkKeeper(owner, v.visit.id);
      keeperVisit.current = v.visit.id;
      room.current = { at: 0, min: null };
      const keep = keeper.current.listener;
      finals.current = new Set();
      early.current = new EarlyBlocks();
      for (const b of firstBlocks) {
        keep(b.block, b.rate);
        early.current.push(b.block, b.rate);
      }
      recorder.setListener((block, rate) => {
        keep(block, rate);
        const client = live.current;
        if (client) client.feed(block, rate);
        else early.current?.push(block, rate);
      });
      type Token = {
        provider: string;
        replay?: string | null;
        live?: Partial<LiveTuning>;
        /** tencent: false (whole lines only, each a paid recognition task) */
        partials?: boolean;
        /** tencent: a line takes 2-3 s, so the captions count as late only after this */
        delay_ms?: number;
        fallback?: { reason: string; replay: string | null };
      };
      let tok: Token;
      try {
        tok = await postJson<Token>("/api/asr/realtime-token", null, { visit_id: v.visit.id });
      } catch {
        // the captions could not be set up: the recording goes on without them
        early.current = null;
        setNotice(at(locale, "visit.captionsDown"));
        return;
      }
      // Whisper or Tencent Cloud speech recognition: the lines go to /api/asr/chunk (Tencent: whole lines only)
      if (tok.provider === "whisper" || tok.provider === "tencent") {
        startLive(v.visit.id, tok.live ?? {}, { partials: tok.partials !== false, delayMs: tok.delay_ms });
        return;
      }
      early.current = null; // no live captions on this visit: nothing to hand over
      if (tok.provider === "devfake" && tok.replay) {
        // the developer tools' stand-in: the fixture the test names, as live captions
        await postJson(`/api/visits/${encodeURIComponent(v.visit.id)}/replay`, null, { speed, source: "live" }).catch(() => undefined);
      } else {
        // Whisper not answering at the start (the server said so), or no transcription here: no captions, the
        // recording goes on
        setNotice(at(locale, tok.fallback ? "visit.captionsDown" : "visit.noCaptions"));
      }
    } catch {
      if (phaseRef.current !== "live") {
        // the visit did not start: the microphone is let go, nothing was recorded for any visit
        if (recording) {
          recorder.setListener(null);
          await recorder.stop().catch(() => null);
        }
        setStartedAt(null);
        setError("failed");
        setPhase("error");
      }
    } finally {
      setBusy(false);
    }
  }

  /**
   * SPEECH_PROVIDER=whisper or tencent: the microphone's blocks -> chunks (whisper only) and lines -> /api/asr/chunk (his
   * sign-in names the scope).
   */
  function startLive(id: string, tuning: Partial<LiveTuning>, how: { partials: boolean; delayMs?: number } = { partials: true }) {
    const late = at(locale, "visit.captionsLate");
    const lost = at(locale, "visit.captionLost");
    const client = new LiveWhisperClient<VisitView, LiveLine>({
      sessionId: null,
      visitId: id,
      tuning,
      partials: how.partials,
      ...(how.delayMs ? { delayMs: how.delayMs } : {}),
      onCaption: (c) => {
        if (finals.current.has(c.id)) return;
        setCaptions((cs) => upsertCaptions(cs, [{ id: c.id, text: c.text, tStart: c.t_start_ms }]));
      },
      onDrop: (lineId) => setCaptions((cs) => cs.filter((c) => c.id !== lineId)),
      onFinal: ({ view: next, utterances }) => {
        for (const u of utterances) finals.current.add(u.id);
        setCaptions((cs) => upsertCaptions(cs, utterances.map(captionOf)));
        if (next) setView((cur) => newerView(cur, next));
      },
      onFallback: () => {
        // the service stopped answering: no more captions (the lines already stored stay); the recording goes on and
        // its transcript is made after 「录完了」. An account's own visit has no replay to show instead.
        live.current = null;
        setCaptions((cs) => cs.filter((c) => finals.current.has(c.id)));
        setNotice(at(locale, "visit.captionsStopped"));
      },
      // late captions: said while it lasts, unless a more important notice is up
      onDelay: (on) => setNotice((n) => (on ? (n ?? late) : n === late ? null : n)),
      // a line that got no caption: said once (its words are in the recording)
      onLineLost: () => setNotice((n) => (n && n !== late ? n : lost)),
    });
    // what he said before this client existed goes first, in order: its sample 0 is the recording's sample 0
    const buffered = early.current ? early.current.drain((b, r) => client.feed(b, r)) : 0;
    early.current = null;
    client.markAttached(buffered);
    live.current = client;
  }

  /** The doctor said no: the record first (consent_record declined), then the screen that says so. */
  async function decline() {
    if (busy) return;
    setBusy(true);
    try {
      const out = await postJson<{ declined?: boolean }>("/api/visits", null, { mode: "record", consent: { given: false, assisted }, place });
      if (out.declined !== true) throw new Error("not recorded");
      setDeclineFailed(false);
      setPhase("declined");
    } catch {
      // nothing was written: the screen must not say it was (he can try again)
      setDeclineFailed(true);
    } finally {
      setBusy(false);
    }
  }

  /** 「我约的日子」: the planned follow-up moves to the day he booked (PATCH /api/visits/[id], track F's route). */
  async function book() {
    if (!booking || !bookDate || busy) return;
    setBusy(true);
    setBookFailed(false);
    try {
      // as every other save here: a sign-in that has ended leads to the login page and back (lib/session/client.ts)
      const res = await fetchSignedIn(`/api/visits/${encodeURIComponent(booking.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: bookDate }),
      });
      if (!res.ok) throw new Error(String(res.status));
      // back to the list, read again: the row now says the day he booked
      router.replace("/p/visit");
      router.refresh();
    } catch {
      setBookFailed(true);
    } finally {
      setBusy(false);
    }
  }

  /** done; failed; or waiting: the service could not make it, the recording is saved and the visit waits for its text */
  async function pollJob(id: string, jobId: string, deadline: number): Promise<"done" | "failed" | "waiting"> {
    for (;;) {
      const st = await getJson<{ status: string; awaiting_transcript?: boolean }>(`/api/asr/jobs/${encodeURIComponent(jobId)}?visit_id=${encodeURIComponent(id)}`);
      if (st.status === "done") return "done";
      if (st.status === "failed") return st.awaiting_transcript ? "waiting" : "failed";
      if (Date.now() > deadline) return "failed";
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  /**
   * The phone copy goes when, and only when, the server has this upload on the visit (real-app 2.14): asked from the
   * server again, after the upload was handed over. Any doubt (the question fails, another path) keeps the copy; the
   * next look at the visit page settles it.
   */
  async function forgetIfSaved(id: string, uploadedPath: string) {
    const saved = await getJson<{ view: { visit: { audioPath: string | null } } }>(`/api/visits/${encodeURIComponent(id)}`)
      .then((r) => r.view.visit.audioPath)
      .catch(() => null);
    if (!uploadConfirmed(uploadedPath, saved)) return;
    if (await dropConfirmed(owner, id, { serverAudioPath: saved })) setKept((k) => (k ? k.filter((x) => x.visitId !== id) : k));
  }

  async function end() {
    const id = visitId.current;
    if (!id || phaseRef.current === "ending") return;
    setPhase("ending");
    setStep("saving");
    setHandedOver(false);
    setSent(null);
    setError(null);
    try {
      if (live.current) {
        // the line in progress is finished and stored before the recorder stops (at most 3 s)
        await live.current.stop(3000);
        live.current = null;
      }
      if (pending.current.visitId !== id) pending.current = { visitId: id, path: null, parts: null };
      const audio = pending.current;
      if (recorder.state === "recording" || recorder.state === "paused") {
        // the microphone that heard the visit is the one for the next recording (10-15)
        if (recorder.hearing().peak > 0.02) rememberMic(recorder.inputId());
        await recorder.stop();
        // the last seconds go to the phone before anything is sent: a failed upload, or a page closed now, loses nothing
        await keeper.current?.flush();
        recorder.setListener(null);
      }
      if (!audio.path) {
        // the recording as this phone has it: the copy it kept (made on this screen, or by an earlier page: a visit
        // opened again has no recorder), with what this screen's keeper still holds because the phone did not take it
        const mine = keeperVisit.current === id ? keeper.current : null;
        if (mine) await mine.flush();
        const source = await keptSource(owner, id, { unsaved: mine?.unsaved() ?? [] });
        const up = source ? await uploadRecording({ visitId: id, source, partMs, api: uploadApi, onProgress: setSent }) : null;
        if (up?.ok) {
          audio.path = up.path;
          audio.parts = up.parts;
        } else if (up && up.why !== "empty") {
          // not uploaded, or not all of it: what the server does not have stays on the phone; 「再传一次」 goes on from
          // the first part the server lacks (the server is asked again what it has)
          setError(up.why === "gone" ? "failed" : "upload");
          setPhase("error");
          return;
        }
      }
      // nothing to send from this phone, and the server already has this visit's recording (an earlier upload whose
      // transcript was never made): the record is made from that one (the server takes a saved recording by itself
      // only with Whisper)
      if (!audio.path && view?.visit.id === id && view.visit.audioPath) audio.path = view.visit.audioPath;
      setStep("transcribing");
      const job = await postJson<{ job_id: string | null; status: string; wait_ms?: number }>("/api/asr/jobs", null, {
        visit_id: id,
        ...(audio.path ? { audio_path: audio.path } : {}),
        // a long recording: how many files it is, so the server uses its list only when it is whole
        ...(audio.path && audio.parts ? { parts: audio.parts } : {}),
      });
      // the server took the request with the recording in it (it keeps the path on the visit): said on this screen
      // while the text is made. Never for a visit that had nothing to send
      setHandedOver(!!audio.path);
      // handed over: the copy on the phone goes once the server says it has this recording, not before
      if (audio.path) await forgetIfSaved(id, audio.path);
      if (job.job_id) {
        const outcome = await pollJob(id, job.job_id, Date.now() + Math.max(120_000, Math.min(job.wait_ms ?? 0, 3_600_000)));
        if (outcome === "failed") throw new Error("transcript failed");
        // "waiting": the recording is saved on the visit, which waits for its text (the review page says so)
        if (outcome === "done") await postJson(`/api/visits/${encodeURIComponent(id)}/finalize`, null, { job_id: job.job_id });
      }
      pending.current = { visitId: null, path: null, parts: null };
      keeper.current = null;
      keeperVisit.current = null;
      router.push(`/p/visit/${encodeURIComponent(id)}/review`);
    } catch (err) {
      // the server no longer finds the upload it was given (or does not have every part it was told of): the next
      // try asks it what it has and sends what is missing
      if (err instanceof ApiError && (err.code === "audio_not_found" || err.code === "parts_missing")) pending.current = { visitId: id, path: null, parts: null };
      setError("failed");
      setPhase("error");
    }
  }

  /** A recording this phone kept (a closed page, a failed upload): upload it now and make the visit's record. */
  async function resume(visitIdToSend: string) {
    visitId.current = visitIdToSend;
    setMode("record");
    await end();
  }

  /** who said a caption, in his words: 「医生」, 「你」, his daughter's name (else 「家人」); nobody yet: 「字幕」 */
  const speakerWord = (c: Caption): string => {
    if (c.role === "doctor" || c.role === "pharmacist" || c.role === "dispenser" || c.role === "patient") return vw(locale, `live.who.${c.role}`);
    if (c.role === "family") return family?.trim() || vw(locale, "live.who.family");
    return vw(locale, "live.caption");
  };

  const tabs = <TabBar active="visit" locale={locale} />;
  /** the header of the visit tab's own screens: 「看诊」 over today's date and time */
  const tabHeader = <PageHeader title={copy.tabs.visit} subtitle={story} locale={locale} />;
  /** the header of a visit he is about to record: 「10月12日的看诊」 over where it is */
  const todayTitle = at(locale, "review.context", { date: shortDate(today, locale) });
  // where it is: his clinic by its name when the app knows one (the draft's 「Blossom Family Clinic」); a pharmacy has no name here
  const placeLine = place === "pharmacy" ? vw(locale, "place.pharmacy") : (clinic ?? vw(locale, "place.clinic"));
  /** 「示例回放」, on every screen of the sample replay (real-app 4.6) */
  const sampleLabel =
    mode === "replay" ? (
      <p style={{ margin: 0 }} data-testid="visit-sample-label">
        <Tag tone="ink">{at(locale, "visit.sampleLabel")}</Tag>
      </p>
    ) : null;
  /** the fixed line of a server without transcription (real-app 2.14), on the visit's first screens */
  const noService =
    speech === "mock" ? (
      <div data-testid="visit-no-service">
        <Box variant="grey">{at(locale, "visit.noService")}</Box>
      </div>
    ) : null;
  const heldBlock = holds.length ? (
    <section className="rpu-visit-group" style={{ gap: 10 }} data-testid="visit-held" data-count={holds.length}>
      <p className="rpu-label">{vw(locale, "held.section")}</p>
      {holds.map((k) => (
        <HeldRecording key={k.visitId} owner={owner} recording={k} locale={locale} partMs={partMs} />
      ))}
    </section>
  ) : null;
  const resumeCard = (k: PendingRecording, button: boolean) => {
    const s = Math.round(k.durationMs / 1000);
    return (
      <section key={k.visitId} className="rpu-visit-group" data-testid="visit-resume" data-visit={k.visitId} style={{ gap: 10 }}>
        <Box variant="acc" title={at(locale, "visit.resumeTitle", { min: Math.floor(s / 60), sec: s % 60 })} />
        {button ? (
          <PrimaryButton onClick={() => void resume(k.visitId)} data-testid="visit-resume-send">
            {at(locale, "visit.resumeSend")}
          </PrimaryButton>
        ) : null}
      </section>
    );
  };

  // ---- recording (or the sample replay): the draft's 05-2; with the list for the end of the visit, 05-10
  if (phase === "live" && view) {
    // the last two lines, the newest first: the line being said now stays in view above the dock (scene 1, 10-15)
    const shown = captions.slice(-2).reverse();
    const noted = view.counts.doc + view.counts.toConfirm + view.counts.chk;
    // the visit's own list (lib/visit/questions.ts): it is there once the visit nears its end, as the server reads the lines
    const questions = view.qlist?.items ?? [];
    const toAsk = questions.filter((q) => q.state === "not_asked").length;
    const list = leaving && questions.length > 0;
    const askWho = view.visit.kind === "pharmacy" ? copy.askPharmacist : copy.askDoctor;
    return (
      <Screen locale={locale}>
        <OneAudio />
        <VisitHeader title={at(locale, "review.context", { date: shortDate(view.visit.date, locale) })} locale={locale} me={false} />
        <div style={{ display: "contents" }} data-testid="visit-live" data-mode={mode} data-visit={view.visit.id} data-stream={view.stream.state} data-view={list ? "leaving" : "captions"} data-started-at={startedAt ?? undefined}>
          <div className="rpu-stack rpu-visit-body">
            {mode === "replay" ? (
              <Box variant="grey" title={<span data-testid="visit-sample-label"><Tag tone="ink">{at(locale, "visit.sampleLabel")}</Tag></span>}>
                {at(locale, "visit.sampleCaptions")}
              </Box>
            ) : (
              <>
                <RecBar elapsed={elapsedLabel(startedAt ? now - startedAt : 0)} locale={locale} mini={list} />
                {/* what the microphone hears, and 「听不到声音」 with the other microphones when it sends nothing (10-15) */}
                <MicCheck recorder={recorder} locale={locale} />
              </>
            )}
            {warn ? (
              <div data-testid="visit-warn">
                <Box variant="acc" title={warn} />
              </div>
            ) : null}
            {notice ? (
              <div data-testid="visit-notice">
                <Box variant="grey" title={notice} />
              </div>
            ) : null}
            {list ? (
              <div className="rpu-visit-group" data-testid="visit-leaving" data-count={questions.length} data-to-ask={toAsk}>
                <Heading title={vw(locale, "leaving.title")} sub={vw(locale, "leaving.sub")} />
                <ListCard>
                  {questions.map((q) => {
                    // as the visit's record has it: not asked yet; asked; or the doctor had already said it (the time point)
                    const asked = q.state !== "not_asked";
                    const how = !asked ? null : q.answer?.auto ? vt(locale, "q.auto", { time: clipTimeLabel(q.answer.tStartMs) }) : copy.answered;
                    return <ListItem key={q.id} mark={asked ? "ok" : "todo"} title={questionText(locale, q)} sub={how ? `${askWho} · ${how}` : askWho} testId="visit-leaving-row" attrs={{ "data-state": q.state }} />;
                  })}
                </ListCard>
              </div>
            ) : (
              <>
                {/* Ripple's live notes (lib/visit/ripple-summary.ts), above the captions: named as Ripple's and as not
                    confirmed; none without his consent to AI processing or with the offline model */}
                {notes ? <RippleNotes title={vw(locale, "live.notes")} note={vw(locale, "live.notesNote")} points={notes.points} lang={notes.lang} testId="visit-notes" live openLabel={vw(locale, "live.notesOpen")} /> : null}
                {shown.length ? (
                  <div className="rpu-visit-group" data-testid="visit-captions" data-lines={captions.length} aria-live="polite">
                    <p className="rpu-visit-lead">{vw(locale, "live.lastTwo")}</p>
                    <Timeline>
                      {shown.map((c) => (
                        // who said it, as the server has it now (Ripple's guess: a guessed clinician's node until he checks
                        // it); while nobody can tell, a plain point. The time, the words as they were heard
                        <TimelineItem
                          key={c.id}
                          node={captionNode(c)}
                          time={clipTimeLabel(c.tStart)}
                          who={speakerWord(c)}
                          testId="visit-caption"
                          attrs={{ "data-line": c.id, "data-role": c.role ?? "unknown", "data-role-state": c.roleState ?? "unknown" }}
                        >
                          <p className="rpu-visit-said" data-size="sub" lang={captionLang(c.text)}>
                            {c.text}
                          </p>
                        </TimelineItem>
                      ))}
                    </Timeline>
                    <p className="rpu-visit-note" data-testid="visit-captions-who">
                      {vw(locale, "live.whoGuess")}
                    </p>
                  </div>
                ) : null}
                <div data-testid="visit-noted" data-count={noted}>
                  <Box variant="grey" title={`${copy.captured} ${fill(copy.capturedItems, { n: noted })}`} />
                </div>
              </>
            )}
          </div>
          <VisitDock>
            {questions.length ? (
              <Button variant="link" onClick={() => setLeaving(!list)} data-testid="visit-leaving-toggle">
                {list ? vw(locale, "leaving.back") : toAsk > 0 ? vw(locale, "leaving.count", { n: toAsk }) : vw(locale, "leaving.title")}
              </Button>
            ) : null}
            {/* red, with the square of stopping (ux pass 10-12, round 5; the canvas screen 05-2) */}
            <DarkButton className="rpu-visit-recbtn" onClick={() => void end()} data-testid="visit-stop">
              <span className="rpu-visit-recbtn-mark" data-shape="square" aria-hidden="true" />
              {copy.stop}
            </DarkButton>
          </VisitDock>
        </div>
      </Screen>
    );
  }

  // ---- ending: saving the recording, then the text
  if (phase === "ending") {
    return (
      <Screen locale={locale}>
        <VisitHeader title={view ? at(locale, "review.context", { date: shortDate(view.visit.date, locale) }) : copy.tabs.visit} locale={locale} me={false} />
        <div style={{ display: "contents" }} data-testid="visit-ending" data-step={step} data-sent-ms={sent ? Math.round(sent.sentMs) : undefined} data-total-ms={sent ? Math.round(sent.totalMs) : undefined}>
          <div className="rpu-stack rpu-visit-body">
            {sampleLabel}
            <Timeline>
              {/* the recording is with the server before its text is made (the draft's 05-3 opens with the same entry): never said for a visit with nothing to send */}
              {step === "transcribing" && handedOver ? <TimelineItem node="ok" title={vw(locale, "ending.saved")} testId="visit-ending-saved" /> : null}
              <TimelineItem
                node="now"
                title={at(locale, step === "saving" ? "visit.saving" : "visit.transcribing")}
                // a long recording: how far the saving is, in minutes of the visit
                note={
                  step === "saving" && sent ? (
                    <span data-testid="visit-saving-progress">{at(locale, "visit.savingProgress", { done: Math.floor(sent.sentMs / 60_000), total: Math.max(1, Math.round(sent.totalMs / 60_000)) })}</span>
                  ) : undefined
                }
              />
            </Timeline>
          </div>
        </div>
      </Screen>
    );
  }

  // ---- something did not work: the recording is kept, try again (the draft's 通用-2)
  if (phase === "error") {
    return (
      <Screen locale={locale} tabBar={tabs} tabBarPlacement="fixed">
        {tabHeader}
        <div style={{ display: "contents" }} data-testid="visit-error" data-error={error ?? "failed"}>
          <div className="rpu-stack rpu-visit-body">
            {sampleLabel}
            <Problem
              title={at(locale, error === "upload" ? "visit.uploadFailed" : "visit.failed")}
              retryLabel={at(locale, error === "upload" ? "visit.uploadAgain" : "visit.tryAgain")}
              onRetry={() => (visitId.current ? void end() : reset())}
              other={
                <SecondaryButton onClick={reset} data-testid="visit-error-back">
                  {at(locale, "visit.back")}
                </SecondaryButton>
              }
            />
          </div>
        </div>
      </Screen>
    );
  }

  // ---- the microphone was refused or is missing: nothing is recording, and nothing looks like it
  if (phase === "nomic") {
    return (
      <Screen locale={locale} tabBar={tabs} tabBarPlacement="fixed">
        {tabHeader}
        <div style={{ display: "contents" }} data-testid="visit-nomic" data-mic={mic}>
          <div className="rpu-stack rpu-visit-body">
            <Problem
              title={at(locale, mic === "denied" ? "visit.mic.denied" : "visit.mic.unavailable")}
              retryLabel={at(locale, "visit.tryAgain")}
              onRetry={() => void begin("record")}
              pending={busy}
              retryTestId="visit-mic-retry"
              other={
                <SecondaryButton onClick={reset} disabled={busy} data-testid="visit-mic-back">
                  {at(locale, "visit.back")}
                </SecondaryButton>
              }
            >
              {at(locale, mic === "denied" ? "visit.mic.deniedSub" : "visit.mic.unavailableSub")}
            </Problem>
          </div>
        </div>
      </Screen>
    );
  }

  // ---- an unfinished visit, opened again: nothing is recording here
  if (phase === "reopened" && view) {
    const id = view.visit.id;
    const here = kept?.find((k) => k.visitId === id) ?? null;
    const state = kept === null ? "looking" : here ? "phone" : view.visit.audioPath ? "server" : "none";
    return (
      <Screen locale={locale} tabBar={tabs} tabBarPlacement="fixed">
        {tabHeader}
        <div style={{ display: "contents" }} data-testid="visit-reopened" data-visit={id} data-kept={state}>
          <div className="rpu-stack rpu-visit-body">
            <Heading title={at(locale, "visit.reopened", { date: shortDate(view.visit.date, locale) })} sub={state === "looking" ? at(locale, "visit.reopened.looking") : undefined} />
            {state === "phone" && here ? resumeCard(here, false) : null}
            {state === "server" ? <Box variant="line" title={at(locale, "visit.reopened.saved")} /> : null}
            {state === "none" ? (
              <Box variant="dash" title={at(locale, "visit.reopened.none")}>
                {at(locale, "visit.reopened.noneSub")}
              </Box>
            ) : null}
          </div>
          <VisitDock>
            {state === "phone" ? (
              <PrimaryButton onClick={() => void end()} data-testid="visit-resume-send">
                {at(locale, "visit.resumeSend")}
              </PrimaryButton>
            ) : null}
            {state === "server" || state === "none" ? (
              <PrimaryButton onClick={() => void end()} data-testid="visit-reopened-end">
                {at(locale, state === "server" ? "visit.unfinished.end" : "visit.reopened.endEmpty")}
              </PrimaryButton>
            ) : null}
            <SecondaryButton onClick={reset} data-testid="visit-reopened-back">
              {at(locale, "visit.back")}
            </SecondaryButton>
          </VisitDock>
        </div>
      </Screen>
    );
  }

  // ---- the doctor said no: on record, and what he can still do
  if (phase === "declined") {
    return (
      <Screen locale={locale} tabBar={tabs} tabBarPlacement="fixed">
        {tabHeader}
        <div style={{ display: "contents" }} data-testid="visit-declined">
          <div className="rpu-stack rpu-visit-body">
            <Timeline>
              <TimelineItem node="ok" title={at(locale, "visit.declined")} note={at(locale, "visit.declinedSub")} />
            </Timeline>
          </div>
          <VisitDock>
            <PrimaryButton href="/p/meds/add" data-testid="visit-declined-photo">
              {at(locale, "visit.declinedPhoto")}
            </PrimaryButton>
            <SecondaryButton onClick={() => setPhase(first)}>{at(locale, "visit.back")}</SecondaryButton>
          </VisitDock>
        </div>
      </Screen>
    );
  }

  // ---- the card for the doctor (the draft's 05-1)
  if (phase === "consent") {
    // his 「医生不同意」 could not be saved: said so, with one button to try again (the screen never says it was noted)
    if (declineFailed) {
      return (
        <Screen locale={locale} tabBar={tabs} tabBarPlacement="fixed">
          <VisitHeader title={todayTitle} subtitle={placeLine} locale={locale} />
          <div style={{ display: "contents" }} data-testid="visit-decline-failed">
            <div className="rpu-stack rpu-visit-body">
              <Problem
                title={at(locale, "visit.declineFailed")}
                retryLabel={at(locale, "visit.tryAgain")}
                onRetry={() => void decline()}
                pending={busy}
                other={
                  <SecondaryButton onClick={() => setDeclineFailed(false)} disabled={busy}>
                    {at(locale, "visit.back")}
                  </SecondaryButton>
                }
              />
            </div>
          </div>
        </Screen>
      );
    }
    return (
      <Screen locale={locale} tabBar={tabs} tabBarPlacement="fixed">
        <VisitHeader title={todayTitle} subtitle={placeLine} locale={locale} onBack={() => setPhase(first)} backLabel={copy.tabs.visit} />
        <div style={{ display: "contents" }} data-testid="visit-consent" data-place={place}>
          <div className="rpu-stack rpu-visit-body">
            <Heading title={copy.consentTitle} sub={copy.consentSub} />
            <ForDoctorCard locale={locale} style={{ marginTop: 0 }}>
              {CONSENT_CARD_EN}
            </ForDoctorCard>
            <p className="rpu-visit-note">{at(locale, "visit.consentNote")}</p>
            {/* the phone has little room left: said here, before anything is recorded */}
            {roomBefore !== null && roomBefore < ROOM_BEFORE_MIN ? (
              <div data-testid="visit-room" data-minutes={roomBefore}>
                <Box variant="acc" title={at(locale, roomBefore < 1 ? "visit.room.none" : "visit.room.low", { min: roomBefore })} />
              </div>
            ) : null}
          </div>
          <VisitDock>
            {/* red, with the round mark of a recording (ux pass 10-12, round 5; the canvas screen 05-1) */}
            <PrimaryButton className="rpu-visit-recbtn" onClick={() => void begin("record")} pending={busy} data-testid="consent-start">
              <span className="rpu-visit-recbtn-mark" aria-hidden="true" />
              {copy.consentStart}
            </PrimaryButton>
            <SecondaryButton onClick={() => void decline()} disabled={busy} data-testid="consent-skip">
              {at(locale, "visit.decline")}
            </SecondaryButton>
          </VisitDock>
        </div>
      </Screen>
    );
  }

  // ---- 「我约的日子」: the day he booked for a planned follow-up (real-app 2.15)
  if (phase === "booking" && booking) {
    return (
      <Screen locale={locale} tabBar={tabs} tabBarPlacement="fixed">
        <PageHeader back={{ href: "/p/visit", label: copy.tabs.visit }} title={at(locale, "visit.planned.book")} locale={locale} />
        <div style={{ display: "contents" }} data-testid="visit-booking" data-visit={booking.id}>
          <div className="rpu-stack rpu-visit-body">
            <Heading title={at(locale, "visit.book.title")} sub={at(locale, "visit.book.sub", { label: booking.label })} />
            <Field
              className="rpu-visit-field"
              id="rp-visit-booked"
              type="date"
              label={at(locale, "visit.planned.book")}
              error={bookFailed ? <span data-testid="visit-book-failed">{at(locale, "visit.book.failed")}</span> : undefined}
              min={today}
              value={bookDate}
              onChange={(e) => setBookDate(e.target.value)}
              data-testid="visit-book-date"
            />
          </div>
          <VisitDock>
            <PrimaryButton onClick={() => void book()} pending={busy} disabled={!bookDate || bookDate < today} data-testid="visit-book-save">
              {at(locale, "visit.book.save")}
            </PrimaryButton>
          </VisitDock>
        </div>
      </Screen>
    );
  }

  // ---- the visit tab (owner 10-14): what is not finished first (a recording still on this phone is sent from here),
  // then ./VisitHub.tsx (the timeline, what to tell the doctor, the question list) and one button, 「开始就诊」: the card
  // for the doctor, at the clinic
  return (
    <Screen locale={locale} tabBar={tabs} tabBarPlacement="fixed">
      <OneAudio />
      {tabHeader}
      <div style={{ display: "contents" }} data-testid="visit-where">
        <div className="rpu-stack rpu-visit-body">
          {offers.map((k) => resumeCard(k, true))}
          {heldBlock}
          {unfinished.length ? (
            <section data-testid="visit-unfinished">
              <ListCard heading={at(locale, "visit.unfinished")}>
                {unfinished.map((u) => {
                  const ends = u.status === "recording" || u.status === "transcribing";
                  return (
                    <div key={u.id} className="rpu-visit-row" data-testid="visit-unfinished-row" data-status={u.status} data-failed={u.failed ? "true" : undefined} data-sample={u.sample ? "true" : undefined}>
                      <ListItem
                        mark="miss"
                        title={at(locale, u.failed ? "visit.unfinished.failed" : `visit.unfinished.${u.status === "awaiting_transcript" ? "awaiting" : u.status}`, { date: u.date })}
                        // what a tap does, under the row's words; and, for the example's recorded visit left half way,
                        // that it is a replay, as every screen of the replay says (real-app 4.6)
                        sub={
                          <>
                            <span className="rpu-visit-row-act">{at(locale, ends ? "visit.unfinished.end" : "visit.unfinished.open")}</span>
                            {u.sample ? (
                              <>
                                {" "}
                                <Tag>{at(locale, "visit.sampleLabel")}</Tag>
                              </>
                            ) : null}
                          </>
                        }
                        chevron
                        href={ends ? `/p/visit?visit=${encodeURIComponent(u.id)}` : `/p/visit/${encodeURIComponent(u.id)}/review`}
                      />
                    </div>
                  );
                })}
              </ListCard>
            </section>
          ) : null}
          {sample && !planned.some((p) => p.id === sample.fixture) ? (
            // the example's sample visit was played before and is a record now, so no planned row carries it: it can be
            // played again from a row of its own, in the planned rows' place (owner's tidy of 10-13)
            <section data-testid="visit-sample">
              <ListCard>
                <div className="rpu-visit-row">
                  <ListItem mark="todo" title={at(locale, "visit.sample")} sub={<Tag>{at(locale, "visit.sampleLabel")}</Tag>} chevron onClick={() => void begin("replay")} testId="visit-sample-start" />
                </div>
              </ListCard>
            </section>
          ) : null}
          <VisitHub locale={locale} past={past} planned={planned} sample={sample} onSample={() => void begin("replay")} hub={hub} />
          {noService}
        </div>
        <VisitDock>
          {/* the one button (owner 10-14): the card for the doctor, which asks to record; at the clinic */}
          <PrimaryButton
            onClick={() => {
              setPlace("clinic");
              setPhase("consent");
            }}
            data-testid="visit-start"
          >
            {at(locale, "visit.start")}
          </PrimaryButton>
        </VisitDock>
      </div>
    </Screen>
  );
}
