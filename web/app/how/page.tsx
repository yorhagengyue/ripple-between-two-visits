/**
 * /how — how Ripple is built (task M8 item 3): the architecture (every box names its product and model from
 * lib/how/stack.ts, the one config, and what this server actually runs from lib/how/runtime.ts), the trust boundary (no
 * component writes clinical text; where recordings are kept and for how long; what Wei Ling's phone receives), and the
 * two sides of AIHGle 2.0 Table 3, quoted verbatim. Renders completely at phone and desktop widths without sideways page
 * scroll.
 *
 * C2 (real-status: "/how 太长，露出文件路径和本机端口；数据库那格和这台对不上"): each box says what runs on this server, no
 * file paths, addresses or ports; each trust zone shows one plain sentence first and its exact rules one tap away. The
 * real-recording demo is the film crew's (its page answers 404 to anyone else), so only the crew's browser gets the link;
 * the dataset credit is here for everyone.
 */
import Link from "next/link";
import { StaffShell } from "@/components/staff/StaffShell";
// C2 track I (only add; real-app 2.6): the manual's section on reminders and the Home Screen
import { InstallManual } from "@/components/push/InstallManual";
import { isCrewPage } from "@/lib/crew/gate";
import { REAL_RECORDING } from "@/lib/how/real-recording";
import { runtimeStack, type RuntimeStack } from "@/lib/how/runtime";
import { AIHGLE, ARCHITECTURE_ROWS, STACK, STATUS_TEXT, type StackBox } from "@/lib/how/stack";
import { AUDIO, CLINICAL_TEXT, FAMILY, type TrustZone } from "@/lib/how/trust";

export const dynamic = "force-dynamic";
export const metadata = { title: "How it works · Ripple" };

const ROW_TITLES = ["Who uses it", "The app", "What the app calls"];

function Box({ box, running }: { box: StackBox; running: string | undefined }) {
  const open = box.status !== "in_use";
  return (
    <div
      className={`flex min-w-0 flex-col gap-1 rounded-2xl border-2 bg-surface p-4 ${open ? "border-dashed border-ink-3" : "border-ink"}`}
      data-testid={`how-box-${box.id}`}
      data-status={box.status}
    >
      <span className="text-[16px] font-semibold uppercase tracking-wide text-ink-2">{box.role}</span>
      <span className="text-[20px] font-bold leading-snug [overflow-wrap:anywhere]" data-testid="how-box-product">
        {box.productZh ? (
          <>
            <span lang="zh-Hans">{box.productZh}</span> / {box.product}
          </>
        ) : (
          box.product
        )}
      </span>
      {box.model ? (
        <span className="font-mono text-[17px] [overflow-wrap:anywhere]" data-testid="how-box-model">
          {box.model}
        </span>
      ) : null}
      <span className="self-start rounded-md border border-hair-2 px-2 py-0.5 text-[16px] text-ink-2">{STATUS_TEXT[box.status]}</span>
      {running ? (
        <p className="text-[17px] leading-snug" data-testid="how-box-running">
          <span className="font-semibold">On this server:</span> {running}
        </p>
      ) : null}
      <details className="text-[17px] leading-snug text-ink-2">
        <summary className="min-h-11 cursor-pointer py-2 text-ink">How it is used</summary>
        <p>{box.note}</p>
      </details>
    </div>
  );
}

function Zone({ zone, boundary = false }: { zone: TrustZone; boundary?: boolean }) {
  return (
    <section
      className={`flex min-w-0 flex-col gap-2 rounded-2xl p-4 ${boundary ? "border-[3px] border-ink bg-surface" : "border-2 border-hair-2 bg-surface-2"}`}
      data-testid={`trust-${zone.id}`}
    >
      <h3 className="text-[19px] font-bold">{zone.title}</h3>
      <p className="text-[18px] leading-snug" data-testid={`trust-${zone.id}-summary`}>
        {zone.summary}
      </p>
      <details className="text-[17px] leading-snug">
        <summary className="min-h-11 cursor-pointer py-2 font-semibold">The exact rules</summary>
        <ul className="flex list-disc flex-col gap-1.5 pl-5">
          {zone.lines.map((l) => (
            <li key={l} className="[overflow-wrap:anywhere]">
              {l}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

const Arrow = ({ label }: { label: string }) => (
  <div className="flex items-center gap-2 py-1 pl-6 text-[17px] text-ink-2" aria-hidden="true">
    <span className="text-[24px] leading-none">↓</span>
    <span>{label}</span>
  </div>
);

export default async function HowPage() {
  const crew = await isCrewPage();
  const running: RuntimeStack = runtimeStack();
  return (
    <StaffShell title="How it works" wide={false}>
      <div data-testid="page-how" className="flex min-w-0 flex-col gap-8">
        <header className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold">How it works</h1>
          <p className="text-[18px] text-ink-2">
            Ripple keeps what the doctor, the clinic counter and the medicine label said, and only ever repeats those words, with their source. It
            records, asks and refers; it does not advise.
          </p>
        </header>

        <section className="flex min-w-0 flex-col gap-3" aria-labelledby="how-arch" data-testid="how-architecture">
          <h2 id="how-arch" className="text-[24px] font-bold">
            Architecture
          </h2>
          {ARCHITECTURE_ROWS.map((row, i) => (
            <div key={row.join("-")} className="flex min-w-0 flex-col gap-2">
              {i > 0 ? <Arrow label={i === 1 ? "pages and API calls, live events back" : "server-side calls only; keys never leave the server"} /> : null}
              <p className="text-[16px] font-semibold uppercase tracking-wide text-ink-2">{ROW_TITLES[i]}</p>
              <div className={`grid min-w-0 gap-3 ${row.length > 2 ? "sm:grid-cols-2 lg:grid-cols-3" : row.length === 2 ? "sm:grid-cols-2" : ""}`}>
                {row.map((id) => (
                  <Box key={id} box={STACK[id]} running={running[id]} />
                ))}
              </div>
            </div>
          ))}
        </section>

        <section className="flex min-w-0 flex-col gap-3" aria-labelledby="how-trust" data-testid="how-trust">
          <h2 id="how-trust" className="text-[24px] font-bold">
            Trust boundary
          </h2>
          <p className="text-[18px] font-semibold" data-testid="how-no-clinical-text">
            No component originates clinical text. The generator only composes from the sources below, every sentence passes three checks, and
            what is not Ripple&apos;s to say becomes a fixed template.
          </p>
          <Zone zone={CLINICAL_TEXT[0]} />
          <Arrow label="quoted, never rewritten" />
          <Zone zone={CLINICAL_TEXT[1]} boundary />
          <Arrow label="only checked sentences, each with its source label" />
          <section className="flex min-w-0 flex-col gap-2 rounded-2xl border-2 border-hair-2 bg-surface-2 p-4" data-testid="trust-phone">
            <h3 className="text-[19px] font-bold">Mr Tan&apos;s phone</h3>
            <p className="text-[18px] leading-snug">Shows each sentence with who said it, the date and the time point in the recording, and plays that recording.</p>
          </section>
          <div className="grid min-w-0 gap-3 md:grid-cols-2">
            <Zone zone={AUDIO} />
            <Zone zone={FAMILY} />
          </div>
        </section>

        <section className="flex min-w-0 flex-col gap-3" aria-labelledby="how-aihgle" data-testid="how-aihgle">
          <h2 id="how-aihgle" className="text-[24px] font-bold">
            AIHGle 2.0, Table 3
          </h2>
          <div className="grid min-w-0 gap-3 md:grid-cols-2">
            <figure className="flex min-w-0 flex-col gap-2 rounded-2xl border-2 border-ink bg-surface p-4" data-testid="aihgle-device">
              <figcaption className="text-[17px] font-semibold uppercase tracking-wide text-ink-2">Medical-device examples in Table 3</figcaption>
              {AIHGLE.device.map((q) => (
                <blockquote key={q} className="border-l-4 border-ink pl-3 text-[18px] leading-snug [overflow-wrap:anywhere]" data-testid="aihgle-quote">
                  &ldquo;{q}&rdquo;
                </blockquote>
              ))}
            </figure>
            <figure className="flex min-w-0 flex-col gap-2 rounded-2xl border-2 border-dashed border-ink-3 bg-surface p-4" data-testid="aihgle-non-device">
              <figcaption className="text-[17px] font-semibold uppercase tracking-wide text-ink-2">Non-device example in Table 3</figcaption>
              {AIHGLE.nonDevice.map((q) => (
                <blockquote key={q} className="border-l-4 border-ink-3 pl-3 text-[18px] leading-snug [overflow-wrap:anywhere]" data-testid="aihgle-quote">
                  &ldquo;{q}&rdquo;
                </blockquote>
              ))}
            </figure>
          </div>
          <p className="text-[17px] text-ink-2">
            <cite data-testid="aihgle-citation">{AIHGLE.citation}</cite>
          </p>
          <p className="text-[18px]">
            Ripple stays on the explaining side: it repeats the words of the doctor, the label and the leaflet with their source, and every question
            about changing a dose or combining medicines goes to the doctor or pharmacist instead of being answered.
          </p>
        </section>

        {/* C2 track I (only add): how reminders reach a phone, Android's one tap and the iPhone's three steps */}
        <InstallManual />

        <section className="flex min-w-0 flex-col gap-3" aria-labelledby="how-real" data-testid="how-real">
          <h2 id="how-real" className="text-[24px] font-bold">
            {crew ? (
              <Link className="inline-flex min-h-11 items-center underline" href={REAL_RECORDING.href} data-testid="how-real-link">
                {REAL_RECORDING.title}
              </Link>
            ) : (
              REAL_RECORDING.title
            )}{" "}
            · <span lang="zh-Hans">{REAL_RECORDING.titleZh}</span>
          </h2>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[17px] leading-snug">
            {REAL_RECORDING.lines.map((l) => (
              <li key={l} className="[overflow-wrap:anywhere]">
                {l}
              </li>
            ))}
          </ul>
          <div className="flex min-w-0 flex-col gap-1 rounded-2xl border-2 border-hair-2 bg-surface-2 p-4" data-testid="how-real-credit">
            <p className="text-[17px] leading-snug [overflow-wrap:anywhere]">{REAL_RECORDING.credit.en}</p>
            <p className="text-[17px] leading-snug [overflow-wrap:anywhere]" lang="zh-Hans">
              {REAL_RECORDING.credit.zh}
            </p>
            <p className="text-[16px] text-ink-2">
              <a className="inline-flex min-h-11 min-w-11 items-center underline" href={REAL_RECORDING.credit.sourceUrl} rel="noopener noreferrer" target="_blank">
                Source
              </a>{" "}
              ·{" "}
              <a className="inline-flex min-h-11 min-w-11 items-center underline" href={REAL_RECORDING.credit.licenceUrl} rel="noopener noreferrer" target="_blank">
                {REAL_RECORDING.credit.licenceName}
              </a>
            </p>
          </div>
        </section>
      </div>
    </StaffShell>
  );
}
