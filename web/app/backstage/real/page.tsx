/**
 * /backstage/real — "Try a real recording / 用真录音试一次" (plan item 4, acceptance 4.3): one PriMock57 mock
 * consultation (CC BY 4.0) through the real Whisper service, the main model's checked labels and the safety layer
 * (lib/asr/real-demo.ts). The crew's only (lib/crew/gate.ts, the same rule as its API): it holds the GPU and may
 * spend on the main model; anyone else gets Next's 404. The dataset credit is also on /how for everyone.
 * Nothing it does is stored in a session: it never reaches Mr Tan's story.
 */
import Link from "next/link";
import { StaffShell } from "@/components/staff/StaffShell";
import { DEMO_CREDIT, DEMO_DATASET, demoConsultations } from "@/lib/asr/real-demo";
import { requireCrewPage } from "@/lib/crew/gate";
import { RealDemo } from "./RealDemo";

export const dynamic = "force-dynamic";
export const metadata = { title: "Try a real recording · Ripple" };

export default async function RealRecordingPage() {
  await requireCrewPage();
  return (
    <StaffShell title="Try a real recording" wide={false}>
      <div className="flex min-w-0 flex-col gap-5" data-testid="page-real">
        <header className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold">
            Try a real recording <span className="font-normal text-ink-2">· </span>
            <span lang="zh-Hans">用真录音试一次</span>
          </h1>
          <p className="text-[18px] text-ink-2">
            A real recorded conversation instead of Mr Tan&apos;s scripted visits: a mock GP consultation from a public research dataset goes through
            the same steps as a recorded visit. Whisper on this laptop transcribes the whole recording, the extraction labels the doctor&apos;s
            sentences, and every card is the doctor&apos;s own sentence as Whisper heard it, with its time point, after the safety checks. Nothing
            here is saved to any session.
          </p>
        </header>

        <section className="rp-card flex min-w-0 flex-col gap-2" data-testid="real-credit" aria-label="Dataset credit">
          <h2 className="text-[19px] font-bold">Whose recording this is</h2>
          <p className="text-[17px] leading-snug [overflow-wrap:anywhere]" data-testid="real-credit-en">
            {DEMO_CREDIT.en}
          </p>
          <p className="text-[17px] leading-snug [overflow-wrap:anywhere]" lang="zh-Hans" data-testid="real-credit-zh">
            {DEMO_CREDIT.zh}
          </p>
          <p className="text-[16px] text-ink-2">
            <a className="underline" href={DEMO_CREDIT.source_url} rel="noopener noreferrer" target="_blank">
              {DEMO_DATASET.title}
            </a>{" "}
            ·{" "}
            <a className="underline" href={DEMO_CREDIT.licence_url} rel="noopener noreferrer" target="_blank">
              {DEMO_CREDIT.licence_name}
            </a>{" "}
            · {DEMO_DATASET.nature}
          </p>
        </section>

        <RealDemo consultations={demoConsultations()} allowed />

        <p className="text-[16px] text-ink-2">
          How the app treats recordings and clinical words: <Link className="underline" href="/how">How it works</Link>. Crew sign-in:{" "}
          <Link className="underline" href="/backstage/crew">
            /backstage/crew
          </Link>
          .
        </p>
      </div>
    </StaffShell>
  );
}
