/**
 * /demo — the judges' split page (real-app 5.3; it was "/" until C2). Every judge gets an own copy of Mr Tan's story,
 * stopped on the evening of Day 29 (8:15pm). On the first visit the page answers 200 and the browser makes that copy
 * and gets ready (components/landing/DemoReady: POST /api/session, POST /api/demo/view), then re-renders.
 *
 * Desktop (>= 1024 px): split view. Left, Mr Tan's phone (/p/today of this copy, in a phone-sized frame) with the ways
 * to open it full size or try the real app on a phone; right, the hero question, the judge's own question, the phone's
 * language, then the live backstage of the same copy. Narrow screens stack the same parts, with no sideways page scroll.
 *
 * What a judge reads is plain (real-status "导演台和评委页"): one intro line, a reason next to a button that cannot be
 * pressed yet, no filming words, Singapore times. The story-clock buttons ("Watch from day one", "Next scene", "Back to
 * Day 29", "Reset this copy") are the film crew's (lib/crew/gate.ts): without the crew's cookie they are not on the page
 * and their routes answer 404 (real-app 5.3, decided 10-09: the story clock is for filming). The phone follows the
 * browser's language the first time.
 *
 * rp_view=demo (lib/crew/demo-view.ts): a browser that is also signed in to an account sees the demo copy in the frame;
 * the banner's "Back to my account" clears it. Nothing tapped here reaches the account, and the other way round.
 */
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { EventFeed } from "@/components/backstage/EventFeed";
import { TodayPanel } from "@/components/backstage/TodayPanel";
import { AccountBanner } from "@/components/landing/AccountBanner";
import { DemoReady } from "@/components/landing/DemoReady";
import { LandingControls } from "@/components/landing/LandingControls";
import { PHONE_FRAME_TESTID } from "@/components/landing/phone-driver";
import { PhoneLinks } from "@/components/landing/PhoneLinks";
import { LiveSessionProvider } from "@/components/live/LiveSession";
import { StaffShell } from "@/components/staff/StaffShell";
import { DEMO_VIEW, localeFromAcceptLanguage, PHONE_APP_PATH, sgtDateTime, VIEW_COOKIE } from "@/lib/crew/demo-view";
import { isCrewPage } from "@/lib/crew/gate";
import { encodeQr, qrSvgPath } from "@/lib/crew/qr";
import { DEFAULT_PATIENT_LOCALE, LOCALE_COOKIE, toLocale } from "@/lib/i18n";
import { recentEvents } from "@/lib/session/server";
import { dueDoses } from "@/lib/session/today";
import { getDemoPageSubject } from "@/lib/subject";

export const dynamic = "force-dynamic";
export const metadata = { title: "Demo · Ripple" };

function Intro() {
  return (
    <header className="mb-5 flex max-w-4xl flex-col gap-2" data-testid="demo-intro">
      <h1 className="text-[28px] font-bold leading-tight">Ripple: a companion between doctor visits</h1>
      <p className="text-[19px] leading-snug text-ink-2" data-testid="demo-intro-line">
        Ripple keeps what the doctor said and, at home, repeats only those words with their source. Mr Tan is 67, reads Mandarin and started a
        blood pressure tablet six weeks ago: on the left is his phone on the evening of Day 29, on the right every step Ripple takes.
      </p>
    </header>
  );
}

/** The phone's origin as the judge's browser reached this server (for the link to the real app on a phone). */
function originOf(h: Headers): string {
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto.split(",")[0].trim()}://${host.split(",")[0].trim()}`;
}

export default async function DemoPage() {
  // owner, 10-14: the judges are given two accounts (an example elder and a family member bound to him) instead of
  // this page; it stays the film crew's (the story clock), and anyone else is sent to the front door
  if (!(await isCrewPage())) redirect("/");
  const [ctx, crew, jar, h] = await Promise.all([getDemoPageSubject(), isCrewPage(), cookies(), headers()]);
  const langCookie = jar.get(LOCALE_COOKIE)?.value;
  const phoneLocale = langCookie ? toLocale(langCookie, DEFAULT_PATIENT_LOCALE) : localeFromAcceptLanguage(h.get("accept-language"));
  const viewSet = jar.get(VIEW_COOKIE)?.value === DEMO_VIEW;
  const signedIn = !!(jar.get("rp_at")?.value || jar.get("rp_rt")?.value);
  const phoneAppUrl = `${originOf(h)}${PHONE_APP_PATH}`;
  const qrCode = encodeQr(phoneAppUrl);

  if (!ctx || !viewSet || !langCookie) {
    return (
      <StaffShell title="Demo">
        <div data-testid="page-landing">
          <Intro />
          <DemoReady needCopy={!ctx} needView={!viewSet || !langCookie} />
        </div>
      </StaffShell>
    );
  }

  const store = ctx.store;
  const id = ctx.session.id;
  const day = ctx.session.story_day;
  const [meds, doses] = await Promise.all([store.listMeds(id), store.listDoses(id, { fromDay: day, toDay: day })]);
  const keptUntil = ctx.session.expires_at ? sgtDateTime(ctx.session.expires_at) : null;

  return (
    <StaffShell title="Demo">
      <LiveSessionProvider key={id} session={ctx.client} d0={ctx.d0} since={ctx.since}>
        <div data-testid="page-landing">
          <Intro />
          {signedIn ? <AccountBanner /> : null}
          <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,432px)_minmax(0,1fr)]">
            <div className="flex min-w-0 flex-col items-center gap-3 lg:sticky lg:top-4">
              <div className="w-full max-w-[432px] overflow-hidden rounded-[36px] border-2 border-hair-2 bg-bg shadow-sm" data-testid="landing-phone-frame">
                <iframe
                  src="/p/today"
                  title="Mr Tan's phone"
                  className="block h-[min(840px,calc(100dvh-140px))] min-h-[560px] w-full"
                  data-testid={PHONE_FRAME_TESTID}
                />
              </div>
              <p className="text-[18px] text-ink-2">Mr Tan&apos;s phone · your own copy of his story</p>
              <PhoneLinks phoneAppUrl={phoneAppUrl} qr={qrCode ? qrSvgPath(qrCode) : null} />
            </div>
            <div className="flex min-w-0 flex-col gap-5">
              <LandingControls locale={phoneLocale} crew={crew} keptUntil={keptUntil} />
              <TodayPanel key={day} initial={dueDoses(meds, doses, day)} crew={crew} />
              <EventFeed initial={recentEvents(id, 200)} compact />
            </div>
          </div>
        </div>
      </LiveSessionProvider>
    </StaffShell>
  );
}
