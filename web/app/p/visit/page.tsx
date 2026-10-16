/**
 * /p/visit — consent, then the live visit screen (v3), then the after-visit review (M2).
 *
 * Query: ?visit=<id>&mode=record|replay reopens a visit that is still recording (a reload keeps the screen);
 * one waiting for review (or confirmed) goes to its review. ?replay=v1|v2|v3 starts that sample replay straight
 * away (judges' links, tests). ?speed=0.25..20 runs the mock realtime clock faster or slower (default 1).
 * ?crew=1 shows the crew-key field on a filming phone that is not the crew's yet (the sign-in door; lib/visit/crew.ts).
 *
 * Day gating: only sample visits on or before the story day are offered (a later one would show records
 * from days that have not happened yet); ?replay= or ?visit= for a later visit falls back to the consent step.
 *
 * C2: on his own account the page is the elder UI (components/visit/elder): since the owner's decision of 10-14 its first
 * screen is the visit tab's hub (his visits as one timeline, what to tell the doctor, his question list, one button
 * 「开始就诊」 to the card for the doctor), then recording and the unfinished visits; ?visit=<id> reopens one still
 * recording, ?speed= sets the stand-in captions' clock, ?step=consent&place= opens the card for the doctor straight
 * away (the way back from the brief for the doctor, track V). Track R: a long recording is uploaded in
 * parts of 20 minutes (lib/visit/parts.ts); a test names a small part length in the x-ripple-part-ms request header
 * (developer tools only).
 */
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AccountVisitPage } from "@/components/visit/elder/pages";
import { VisitFlow } from "@/components/visit/VisitFlow";
import type { ReplayOption } from "@/components/visit/ConsentStep";
import { devToolsEnabled } from "@/lib/dev/enabled";
import { getPatientLocale } from "@/lib/session/server";
import { isReplayCopy } from "@/lib/visit/happened";
import { PART_HEADER, PART_MS, partMsOr } from "@/lib/visit/parts";
import { buildVisitView } from "@/lib/visit/view";
import { getPageSubject } from "@/lib/subject";

export const dynamic = "force-dynamic";

const SAMPLES = ["v1", "v2", "v3"];

export default async function VisitPage({ searchParams }: PageProps<"/p/visit">) {
  const [ctx, locale, sp] = await Promise.all([getPageSubject(), getPatientLocale(), searchParams]);
  if (!ctx) return null;
  const store = ctx.store;
  const sessionId = ctx.session.id;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  // his own account (C2): the elder screens; the demo below is unchanged
  if (ctx.subject.kind === "account") {
    const rawSpeed = Number(one(sp.speed) ?? 1);
    // C2 track V: ?step=consent&place=clinic|pharmacy is the way back from 「先给医生看简报」 (the card for the doctor)
    const rawPlace = one(sp.place);
    const place: "clinic" | "pharmacy" | null = rawPlace === "clinic" || rawPlace === "pharmacy" ? rawPlace : null;
    const step = one(sp.step) === "consent" && place ? { step: "consent" as const, place } : null;
    // C2 track R: one uploaded file holds 20 minutes of audio (lib/visit/parts.ts). With the developer tools on, a test
    // may name a small part length in a request header, so a recording of seconds is sent in parts; the server
    // measures whatever it is given and has no such setting
    const partMs = devToolsEnabled() ? partMsOr(Number((await headers()).get(PART_HEADER) ?? Number.NaN)) : PART_MS;
    return (
      <AccountVisitPage
        ctx={ctx}
        locale={locale}
        visitParam={one(sp.visit) ?? null}
        speed={Number.isFinite(rawSpeed) && rawSpeed >= 0.25 && rawSpeed <= 20 ? rawSpeed : 1}
        step={step}
        partMs={partMs}
      />
    );
  }

  const visitParam = one(sp.visit);
  let initialView = null;
  if (visitParam) {
    initialView = await buildVisitView(store, sessionId, visitParam, { session: ctx.session });
    if (initialView && initialView.visit.day > ctx.session.story_day) initialView = null;
    if (initialView && (initialView.visit.status === "review" || initialView.visit.status === "confirmed")) {
      redirect(`/p/visit/${encodeURIComponent(visitParam)}/review`);
    }
  }

  const visits = await store.listVisits(sessionId);
  const samples = visits.filter((v) => SAMPLES.includes(v.id));
  const replays: ReplayOption[] = samples
    .filter((v) => v.day <= ctx.session.story_day)
    .sort((a, b) => a.day - b.day)
    .map((v) => ({ fixture: v.id, day: v.day, date: v.date, kind: v.kind }));
  const laterReplays = samples.length > replays.length;

  // C2: visits started and not finished (a replay left before its end, a review not done) are listed on top
  const unfinished = visits
    .filter((v) => v.day <= ctx.session.story_day && (v.status === "recording" || v.status === "transcribing" || v.status === "review") && v.id !== initialView?.visit.id)
    .map((v) => ({
      id: v.id,
      day: v.day,
      date: v.date,
      kind: v.kind,
      status: v.status === "review" ? ("review" as const) : v.status === "transcribing" ? ("transcribing" as const) : ("recording" as const),
      // C2 track E: a replay copy of a visit that already happened is listed as a re-watch
      ...(isReplayCopy(v) ? { rewatch: true } : {}),
    }));
  const replay = one(sp.replay);
  const rawSpeed = Number(one(sp.speed) ?? 1);
  const speed = Number.isFinite(rawSpeed) && rawSpeed >= 0.25 && rawSpeed <= 20 ? rawSpeed : 1;
  const autoReplay = replay && replays.some((r) => r.fixture === replay) && !initialView ? { fixture: replay, speed } : null;

  // No key: a router.refresh() (after visit.changed) must not remount the flow and lose the live state.
  return (
    <VisitFlow
      sessionId={ctx.client.id}
      locale={locale}
      replays={replays}
      initialView={initialView}
      initialMode={one(sp.mode) === "record" ? "record" : "replay"}
      autoReplay={autoReplay}
      speed={speed}
      crew={one(sp.crew) === "1"}
      laterReplays={laterReplays}
      unfinished={unfinished}
    />
  );
}
