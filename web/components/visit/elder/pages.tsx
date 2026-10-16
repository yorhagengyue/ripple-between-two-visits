/**
 * The server halves of his visit pages on a real account (C2 track F): /p/visit and /p/visit/[id]/review read his
 * scope through the page subject's scoped store and hand the client components what they show. Since the owner's
 * decision of 10-14 /p/visit is also where his question list and what to tell the doctor are (the visit tab's first
 * screen, components/visit/elder/VisitHub.tsx; its data, lib/visit/hub.ts). The demo keeps its own pages
 * (components/visit/VisitFlow, ReviewScreen) unchanged. Server-only.
 */
import { notFound, redirect } from "next/navigation";
import { Screen, TabBar } from "@/components/ui";
import { speechProviderName, type SpeechProviderName } from "@/lib/asr";
import { blobPrefix, getBlobStore, pathInSession, READ_LINK_SECONDS } from "@/lib/blob";
import { listDoctorSignals } from "@/lib/daily/signals";
import { errorCode, log } from "@/lib/log";
import { recordingListenPath } from "@/lib/privacy/links";
import { isCrewPage } from "@/lib/crew/gate";
import { questionList } from "@/lib/profile/questions";
import { samplesAllowed, scopeClinic, scopeTz } from "@/lib/store/scope";
import type { UtteranceRow, VisitRow } from "@/lib/store/types";
import type { PageSubject } from "@/lib/subject";
import { storyDate } from "@/lib/story/clock";
import { at, metaLine, shortDate, type AccountLocale } from "@/lib/visit/account-copy";
import { helpedOnDevice } from "@/lib/visit/consent";
import { copiedFrom, isReplayCopy, visitHappened } from "@/lib/visit/happened";
import { hubQuestions, hubSignals, pastRecords, type VisitHubData } from "@/lib/visit/hub";
import { PART_MS } from "@/lib/visit/parts";
import { plannedIsApprox } from "@/lib/visit/pipeline";
import { readOnce } from "@/lib/visit/read-once";
import { completeParts } from "@/lib/visit/recording";
import { transcriptGaveUp } from "@/lib/visit/transcript-tries";
import { buildVisitView, liveUtterances, replayFixtureFor } from "@/lib/visit/view";
import { AccountReview } from "./AccountReview";
import { AccountVisitFlow, type PastVisit, type PlannedVisit, type UnfinishedVisit } from "./AccountVisitFlow";
import type { KnownVisit } from "./kept";
import { OneAudio } from "./OneAudio";
import { clinicName, placeWords } from "./words";
// owner 10-15 (scene 2's job, one line here): the planned visit's time and doctor under its place (lib/daily/visit-details.ts)
import { clockWords } from "@/lib/daily/i18n";
import { doctorWords, visitDetail } from "@/lib/daily/visit-details";

const UNFINISHED = new Set(["recording", "transcribing", "awaiting_transcript", "review"]);

/** His screen's top line: today's real date and time. */
export function accountStory(ctx: PageSubject, locale: AccountLocale): string {
  return metaLine(storyDate(ctx.d0, ctx.session.story_day), ctx.session.story_time, locale);
}

/** How many earlier visits the tab's timeline lists (the newest ones). */
const PAST_SHOWN = 5;

/**
 * What the tab's first screen shows besides the visits' rows (owner 10-14; lib/visit/hub.ts): the records of the earlier
 * visits it lists, what Ripple noted for the doctor, his question list as one list. Read through one readOnce store, each
 * part on its own: a part that cannot be read says less (a record: only the way to its review; the notes: left out; the
 * list: only the way to it), and the screen keeps its button to start the visit.
 */
async function visitHub(ctx: PageSubject, locale: AccountLocale, past: { visit: VisitRow; transcript: UtteranceRow[] }[]): Promise<VisitHubData> {
  const reads = readOnce(ctx.store);
  // the kept Chinese of every line the records show, from one read of the list (readOnce answers each line from it)
  void reads.listTranslations(ctx.session.id).catch(() => null);
  const failed = (part: string) => (e: unknown) => {
    log("warn", "visit.hub", { route: "/p/visit", code: `${part}:${errorCode(e)}` });
    return null;
  };
  const [records, signals, questions] = await Promise.all([
    pastRecords(reads, ctx.session, past, locale).catch(failed("records")),
    listDoctorSignals(reads, ctx.session, locale)
      .then((rows) => hubSignals(rows, { d0: ctx.d0, tz: scopeTz(ctx.session), locale }))
      .catch(failed("signals")),
    questionList(reads, ctx.session, locale).then(hubQuestions).catch(failed("questions")),
  ]);
  return { records: records ?? {}, signals: signals ?? [], questions };
}

/** Which transcription this server has, for the first screen's fixed line (real-app 2.14); a bad setting reads as none. */
function speechHere(): SpeechProviderName {
  try {
    return speechProviderName();
  } catch {
    return "mock";
  }
}

export async function AccountVisitPage({
  ctx,
  locale,
  visitParam,
  speed,
  step,
  partMs = PART_MS,
}: {
  ctx: PageSubject;
  locale: AccountLocale;
  visitParam: string | null;
  speed: number;
  /** back from 「先给医生看简报」: the card for the doctor, at the place he chose (C2 track V) */
  step?: { step: "consent"; place: "clinic" | "pharmacy" } | null;
  /** C2 track R: the length of audio one uploaded file holds (lib/visit/parts.ts; default 20 minutes) */
  partMs?: number;
}) {
  const store = ctx.store;
  const scopeId = ctx.session.id;
  let initialView = null;
  if (visitParam) {
    initialView = await buildVisitView(store, scopeId, visitParam, { session: ctx.session });
    if (initialView && !["recording", "transcribing"].includes(initialView.visit.status)) redirect(`/p/visit/${encodeURIComponent(visitParam)}/review`);
  }
  const visits = await store.listVisits(scopeId);
  const today = ctx.session.story_day;
  const unfinished: UnfinishedVisit[] = [];
  const past: PastVisit[] = [];
  const pastLines: { visit: VisitRow; transcript: UtteranceRow[] }[] = [];
  const planned: PlannedVisit[] = [];
  // a visit waiting for its text whose attempts are used up (track F, lib/visit/transcript-tries.ts): its row says so
  const tries = visits.some((v) => v.status === "awaiting_transcript") ? await store.listDeliveries(scopeId) : [];
  for (const v of [...visits].sort((a, b) => b.day - a.day || b.created_at.localeCompare(a.created_at))) {
    if (UNFINISHED.has(v.status)) {
      const failed = v.status === "awaiting_transcript" && transcriptGaveUp(tries, v.id);
      // the example's recorded visit, played and left before its end (or a copy of it played again): a replay, never a
      // visit of his own; its row says 「示例回放」 as every screen of the replay does (real-app 4.6)
      const replay = !!replayFixtureFor(v) || isReplayCopy(v);
      unfinished.push({ id: v.id, status: v.status as UnfinishedVisit["status"], date: shortDate(v.date, locale), ...(failed ? { failed } : {}), ...(replay ? { sample: true } : {}) });
      continue;
    }
    if (isReplayCopy(v)) continue;
    // C2 track V: a planned follow-up is not a visit that happened; it has its own row (real-app 4.4), from today on.
    // One made from a doctor's 「about six weeks」 is approximate (「大约 11月20日」, 2.15) until he sets the day he
    // booked (「我约的日子」, PATCH /api/visits/[id]); recording at the clinic on its day continues that row
    // (lib/visit/pipeline.ts startVisit). The example's sample visit is planned today too, and its day is not his to set
    if (v.status === "planned") {
      if (v.day < today) continue;
      const isToday = v.day === today;
      const key = isToday ? "visit.planned.today" : (await plannedIsApprox(store, scopeId, v)) ? "visit.planned.about" : "visit.planned.on";
      const detail = visitDetail(ctx.session, v.id);
      const withWho = [detail.time ? clockWords(locale, detail.time) : null, doctorWords(detail.doctor, locale)].filter(Boolean).join(" · ");
      planned.push({ id: v.id, today: isToday, label: at(locale, key, { date: shortDate(v.date, locale) }), date: v.date, canBook: !replayFixtureFor(v), place: [placeWords(locale, v), withWho].filter(Boolean).join("\n") });
      continue;
    }
    if (v.status !== "confirmed") continue;
    const transcript = liveUtterances(await store.listUtterances(scopeId, v.id));
    // a visit with a record he can read again (the example's seeded visits have none: nothing to open)
    if (transcript.length > 0 && visitHappened(v, { lines: transcript.length })) {
      // the row's date and place, also apart: the list draws them as the row's title and the grey line under it
      past.push({ id: v.id, label: at(locale, "visit.past.row", { date: shortDate(v.date, locale), place: v.place }), date: shortDate(v.date, locale), place: placeWords(locale, v) });
      // the timeline opens the newest of them in place (lib/visit/hub.ts): their lines are read once, here
      if (pastLines.length < PAST_SHOWN) pastLines.push({ visit: v, transcript });
    }
  }
  // the example account's sample visit: today's follow-up with its recorded example (never on a blank account); C2 track J
  // (filming): also a filming account's, on a phone that carries the film crew's cookie (its visit scenes are filmed so)
  const sampleVisit = samplesAllowed(ctx.session, ctx.session.filming === true && (await isCrewPage()))
    ? visits.find((v) => !isReplayCopy(v) && v.day === today && !!replayFixtureFor(v))
    : undefined;
  const sample = sampleVisit ? { fixture: sampleVisit.id } : null;
  // C2 track V: what the phone needs to decide about the recordings it keeps (components/visit/elder/kept.ts): every
  // visit of his, not only the rows shown, and the one-way name of his space the kept copies are filed under
  const known: KnownVisit[] = [];
  for (const v of visits) {
    const audioPath = v.audio_path ?? null;
    // ended with nothing recorded (no recording, no line): a phone that still holds its recording may send it
    const empty = v.status === "review" && !audioPath ? liveUtterances(await store.listUtterances(scopeId, v.id)).length === 0 : false;
    known.push({ id: v.id, status: v.status, audioPath, ...(empty ? { empty } : {}) });
  }
  // where a clinic visit recorded now will be filed, for the line under the header of the card for the doctor (the
  // draft's 05-1): as lib/visit/pipeline.ts startVisit decides it. Today's planned follow-up, when the recording
  // continues that row; else the clinic he told the app. null: no name on record (the screen then says 「诊所」)
  const continued = visits.find((v) => v.day === today && v.status === "planned" && !v.audio_fixture);
  const clinic = clinicName(continued ? continued.place : scopeClinic(ctx.session));
  // scene 1 (10-15): how his live captions name his daughter: the name on his link with her (the first family member he
  // shares with); none: 「家人」. A link that cannot be read names nobody
  const owner = ctx.session.owner_user_id;
  const family = owner ? ((await store.listCareLinks({ patient_id: owner, status: ["active"] }).catch(() => [])).find((l) => l.family_label?.trim())?.family_label?.trim() ?? null) : null;
  return (
    <AccountVisitFlow
      locale={locale}
      story={accountStory(ctx, locale)}
      clinic={clinic}
      owner={blobPrefix(ctx.session)}
      // someone is helping him on his device: what sign-up recorded (nothing on these screens asks again); it goes
      // into the doctor's yes or no (consent_record.assisted, real-app 3.11)
      assisted={ctx.session.owner_user_id ? await helpedOnDevice(store, ctx.session.owner_user_id) : false}
      today={storyDate(ctx.d0, today)}
      known={known}
      // every unfinished visit has its row: one left off the list could not be finished from anywhere
      unfinished={unfinished}
      planned={planned.reverse()}
      past={past.slice(0, PAST_SHOWN)}
      sample={sample}
      speech={speechHere()}
      initialView={initialView}
      initialStep={step ?? null}
      speed={speed}
      // C2 track R: how much audio one uploaded file holds (20 minutes; the route hands a test's small one)
      partMs={partMs}
      // owner 10-14: the earlier visits' records, what to tell the doctor, the question list (the say bar is gone: asking
      // is an entry of the list)
      hub={await visitHub(ctx, locale, pastLines)}
      family={family}
    />
  );
}

export async function AccountReviewPage({ ctx, locale, visitId }: { ctx: PageSubject; locale: AccountLocale; visitId: string }) {
  // one read of each of his tables for this page (lib/visit/read-once.ts): the view's reads answer the two below
  const store = readOnce(ctx.store);
  const scopeId = ctx.session.id;
  const view = await buildVisitView(store, scopeId, visitId, { session: ctx.session });
  const visit = view ? await store.getVisit(scopeId, visitId) : null;
  if (!view || !visit) notFound();
  let recordingUrl: string | null = null;
  // C2 track R: a long recording is several files; 「听录音」 goes through them as one (the files after the first, and
  // every file's length)
  let recordingMore: string[] = [];
  let recordingLengths: number[] | null = null;
  const prefix = blobPrefix(ctx.session);
  if (visit.status === "awaiting_transcript" && visit.audio_path && pathInSession(prefix, visit.audio_path)) {
    // C2 track H (only change here): the browser never holds a link longer than 10 minutes (real-app 3.9). The player
    // gets our own route, which signs a fresh link for every play; the link asked for here only tells whether the
    // file is in storage.
    const there = await getBlobStore()
      .signedReadUrl("audio", visit.audio_path, READ_LINK_SECONDS)
      .then(
        () => true,
        () => false,
      );
    recordingUrl = there ? recordingListenPath(visit.id) : null;
    const parts = there ? completeParts(visit) : null;
    if (parts && parts.length > 1 && parts.every((p) => pathInSession(prefix, p.path))) {
      recordingMore = parts.slice(1).map((_, i) => recordingListenPath(visit.id, i + 1));
      recordingLengths = parts.map((p) => p.ms);
    }
  }
  const owner = copiedFrom(visit) ?? visit.id;
  const prescribed = (await store.listMeds(scopeId)).some((m) => m.prescribed_visit_id === owner && m.status === "awaiting_label");
  return (
    <Screen locale={locale} tabBar={<TabBar active="visit" locale={locale} />} tabBarPlacement="fixed">
      {/* one sound at a time; the review draws its own header (its second line follows the line he is on) */}
      <OneAudio />
      <AccountReview
        view={view}
        locale={locale}
        context={at(locale, "review.context", { date: shortDate(view.visit.date, locale) })}
        retainUntil={visit.retain_until && visit.audio_path ? shortDate(visit.retain_until, locale) : null}
        keepForever={visit.keep_forever === true}
        recordingUrl={recordingUrl}
        recordingMore={recordingMore}
        recordingLengths={recordingLengths}
        prescribed={prescribed}
      />
    </Screen>
  );
}
