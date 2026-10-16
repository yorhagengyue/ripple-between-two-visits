/**
 * Next to a reading above the doctor's own warning line (C2 track B draws what track S's relayDoctorThreshold returns;
 * real-app 2.9, e2e-chains 16.1, journey 09's blood pressure step). 10-14, the owner's decision (the 995 sentence came too
 * early here): the doctor's own sentence comes first, as an entry of a line, whole and word for word, with the visit's
 * date, the time point in the recording, the checked Chinese under it and the clip; 「医生说」 in the white card when he
 * confirmed the sentence, 「好像是医生说的」 in the dashed card with the tag 「你还没认过这一句」 otherwise. Then, under that line,
 * the fixed template that follows it. The owner's second decision that day (「胸口痛就必须打 995」 was too absolute): it is
 * now 995 for when he feels very unwell (lib/safety/templates.ts signal_995_unwell), drawn as the ask screen draws it
 * (components/daily/answer-parts.ts): Ripple's line on the same line as the doctor's words, with its 打 995 button (the
 * only red on the screen). The fixed 995 template, were it ever here again, keeps the red card with its one tap to dial.
 * The order is relay.lines' (lib/safety/threshold.ts). Nothing judges the reading; nothing here is Ripple's own advice.
 *
 * `children`: entries that follow the doctor's sentence on the same line (his own reading, on the screen after saving),
 * so the page is one line and not loose nodes.
 *
 * Test hooks, as before: threshold-relay (data-state), relay-template (data-template), relay-doctor (data-source),
 * relay-translation.
 */
import type { ReactNode } from "react";
import { BpDoctorEntry } from "@/components/bp/BpDoctorEntry";
import { EmergencyBlock, Hotlines, Timeline, TimelineItem } from "@/components/ui";
import type { Locale } from "@/lib/i18n";
import type { ThresholdRelay } from "@/lib/safety/threshold";
import { answerParts, callsOf } from "../answer-parts";

export function ThresholdRelayBlock({ relay, locale, children }: { relay: ThresholdRelay; locale: Locale; children?: ReactNode }) {
  const t = relay.template;
  const d = relay.doctorLine;
  const cite = d.cite ?? {};
  const confirmed = cite.roleState === "confirmed";
  const text = locale === "zh-Hans" && t.zh ? t.zh : t.en;
  // the red card only for the fixed 995 template; a 995 that is for when he feels very unwell is Ripple's line, as on the
  // ask screen
  const card = answerParts([t], locale)[0]?.kind === "emergency";
  return (
    <section className="rpu rpu-stack" data-testid="threshold-relay" data-state={confirmed ? "confirmed" : "inferred"}>
      {/* the doctor's own words first (and his reading on the same line); the 995 sentence after them */}
      <Timeline>
        <BpDoctorEntry
          locale={locale}
          testId="relay-doctor"
          translationTestId="relay-translation"
          attrs={{ "data-source": d.sourceId }}
          tagUnconfirmed
          words={{
            text: d.en,
            date: cite.date ?? null,
            tStartMs: typeof cite.tStartMs === "number" ? cite.tStartMs : null,
            clipUrl: cite.clipUrl ?? null,
            standIn: !!cite.standInVoice,
            confirmed,
            sourceRef: cite.utteranceId ?? d.sourceId,
            zh: d.translation?.text ?? null,
          }}
        />
        {children}
        {card ? null : (
          <TimelineItem node="rip" testId="relay-template" attrs={{ "data-template": t.templateId ?? "" }}>
            <Hotlines locale={locale} lines={[{ text, calls: callsOf(text).map((c) => ({ number: c.number, href: c.href, urgent: c.urgent })) }]} />
          </TimelineItem>
        )}
      </Timeline>
      {card ? (
        <div data-testid="relay-template" data-template={t.templateId ?? ""}>
          <EmergencyBlock title={text} call={{ number: "995" }} locale={locale} style={{ marginTop: 0 }} />
        </div>
      ) : null}
    </section>
  );
}
