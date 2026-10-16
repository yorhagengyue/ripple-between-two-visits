/**
 * Readings over time (server component, inline SVG). His readings as two lines (top and bottom number) and, only
 * when the doctor gave a number (R1) before today, that number as two dashed lines in the doctor's colour. Points
 * are never coloured by where they fall: the chart puts his numbers next to the doctor's, it does not judge them.
 * All words are outside the SVG (HTML, 18px); the SVG is decoration for the list below it.
 */
import type { Locale } from "@/lib/i18n";
import { dt } from "@/lib/daily/i18n";
import type { BpReadingView, DoctorTarget } from "@/lib/daily/types";

const W = 360;
const H = 190;
const PAD = { l: 8, r: 8, t: 12, b: 12 };

export function BpChart({ readings, target, locale }: { readings: BpReadingView[]; target: DoctorTarget | null; locale: Locale }) {
  const pts = readings.filter((r) => r.state === "recorded" && r.systolic !== null && r.diastolic !== null);
  if (pts.length === 0) return null;
  const values = pts.flatMap((r) => [r.systolic!, r.diastolic!]);
  if (target) values.push(target.systolic, target.diastolic);
  const lo = Math.min(...values) - 8;
  const hi = Math.max(...values) + 8;
  const order = pts.map((_, i) => i);
  const x = (i: number) => PAD.l + (order.length === 1 ? (W - PAD.l - PAD.r) / 2 : (i * (W - PAD.l - PAD.r)) / (order.length - 1));
  const y = (v: number) => PAD.t + ((hi - v) * (H - PAD.t - PAD.b)) / (hi - lo);
  const path = (key: "systolic" | "diastolic") => pts.map((r, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(r[key]!).toFixed(1)}`).join(" ");

  return (
    <section className="rp-card flex flex-col gap-2" data-testid="bp-chart-card">
      <h2 className="text-[20px] font-bold">{dt(locale, "bp.chart")}</h2>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-hidden="true"
        data-testid="bp-chart"
        data-points={pts.length}
        data-ref={target ? `${target.systolic}/${target.diastolic}` : "none"}
      >
        {target
          ? [target.systolic, target.diastolic].map((v) => (
              <line key={v} x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--doc)" strokeWidth={2} strokeDasharray="6 5" data-testid="bp-ref-line" data-value={v} />
            ))
          : null}
        <path d={path("systolic")} fill="none" stroke="var(--t1)" strokeWidth={2.5} strokeLinejoin="round" />
        <path d={path("diastolic")} fill="none" stroke="var(--t3)" strokeWidth={2.5} strokeLinejoin="round" />
        {pts.map((r, i) => (
          <g key={r.id}>
            <circle cx={x(i)} cy={y(r.systolic!)} r={3.5} fill="var(--t1)" />
            <circle cx={x(i)} cy={y(r.diastolic!)} r={3.5} fill="var(--t3)" />
          </g>
        ))}
      </svg>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-body text-ink-2">
        <span>
          <span aria-hidden="true" className="mr-1 inline-block h-[3px] w-5 bg-ink align-middle" />
          {dt(locale, "bp.record.top")}
        </span>
        <span>
          <span aria-hidden="true" className="mr-1 inline-block h-[3px] w-5 bg-ink-3 align-middle" />
          {dt(locale, "bp.record.bottom")}
        </span>
        {target ? (
          <span data-testid="bp-ref-legend">
            <span aria-hidden="true" className="mr-1 inline-block h-[3px] w-5 border-t-[3px] border-dashed border-doc align-middle" />
            {dt(locale, "bp.lineLabel", { s: target.systolic, d: target.diastolic })}
          </span>
        ) : null}
        <span>{dt(locale, "bp.unit")}</span>
      </div>
    </section>
  );
}
