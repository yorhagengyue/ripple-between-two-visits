/**
 * The real app's event types (C2 foundation F1, 10-10): registered once in lib/bus.ts so later tracks only publish them.
 * Each has its own plain-English backstage sentence written from ids, kinds and counts (never his words, a medicine
 * name or anyone's id), and each is dropped for the family role (lib/family/events.ts FAMILY_DROPS) until the owning
 * track decides otherwise.
 */
import { describe, expect, it } from "vitest";
import { renderEvent, RENDERERS } from "@/components/backstage/sentences";
import { EXTRA_EVENT_TYPES, type BusEvent } from "@/lib/bus";
import { FAMILY_DROPS, familyEvent } from "@/lib/family/events";

const REAL_APP_TYPES = [
  "care_link.invited",
  "care_link.accepted",
  "care_link.confirmed",
  "care_link.declined",
  "care_link.revoked",
  "care_link.left",
  "consent.recorded",
  "push.subscribed",
  "push.unsubscribed",
  "push.sent",
  "push.opened",
  "profile.fact_added",
  "profile.fact_confirmed",
  "profile.fact_changed",
  "prevent.done",
  "prevent.changed",
  "watch.synced",
  "diet.checked",
  "chat.message",
  "visit.transcribed",
  "account.created",
  "account.changed",
  "account.reseeded",
  "job.ran",
  "job.failed",
];

const SECRET_ID = "0b6f2a8e-1c3d-4e5f-8a9b-0c1d2e3f4a5b";
const ev = (type: string, data: unknown): BusEvent => ({ id: 7, type: type as BusEvent["type"], session_id: SECRET_ID, at: "2026-10-10T08:00:00.000Z", say: "SAY", data });

describe("the real app's event types", () => {
  it("are all in lib/bus.ts's list, each with its own renderer", () => {
    for (const t of REAL_APP_TYPES) {
      expect((EXTRA_EVENT_TYPES as readonly string[]).includes(t), t).toBe(true);
      expect(RENDERERS[t], t).toBeTypeOf("function");
    }
    expect([...FAMILY_DROPS].sort()).toEqual([...REAL_APP_TYPES].sort());
  });

  it("render one plain sentence from their data, never the publisher's say, an id or a name", () => {
    const samples: Record<string, unknown> = {
      "care_link.invited": { link: { id: SECRET_ID, status: "invited", relation: "daughter", family_label: "Wei Ling" } },
      "care_link.confirmed": { link: { id: SECRET_ID, status: "active", relation: "daughter" } },
      "consent.recorded": { kind: "ai_processing", decision: "granted", version: "2026-10-10" },
      "push.sent": { kind: "dose_first", count: 2 },
      "profile.fact_added": { fact: { id: SECRET_ID, kind: "condition", source: "family" } },
      "watch.synced": { count: 3 },
      "job.ran": { job: "dose_reminders", written: 1 },
      "job.failed": { job: "dose_reminders", code: "lease_lost" },
      "visit.transcribed": { visit_id: "visit-abc" },
    };
    for (const t of REAL_APP_TYPES) {
      const line = renderEvent(ev(t, samples[t] ?? {}));
      expect(line.known, t).toBe(true);
      expect(line.sentence.length, t).toBeGreaterThan(10);
      expect(line.sentence, t).not.toContain("SAY");
      expect(line.sentence, t).not.toContain(SECRET_ID);
      expect(line.sentence, t).not.toContain("Wei Ling");
    }
    expect(renderEvent(ev("care_link.invited", samples["care_link.invited"])).sentence).toBe(
      "He invited his daughter to see what he shares; the invitation waits for them to accept.",
    );
    expect(renderEvent(ev("consent.recorded", samples["consent.recorded"])).sentence).toBe("He gave consent to AI processing of what he says (text 2026-10-10).");
    expect(renderEvent(ev("push.sent", samples["push.sent"])).sentence).toBe("Notification sent (dose first) to 2 devices; the lock screen shows no medicine name.");
    expect(renderEvent(ev("profile.fact_added", samples["profile.fact_added"])).sentence).toBe(
      "His family proposed a condition fact for his profile; it waits for him to confirm.",
    );
    expect(renderEvent(ev("job.ran", samples["job.ran"])).sentence).toBe("The scheduled job dose_reminders ran and wrote 1 record.");
  });

  it("are dropped for the family role, whatever her switches", () => {
    const allOn = { dose_summary: true, bp_summary: true, questions_count: true, no_reply_alert: true, visit_transcripts: true, notes: true };
    for (const t of REAL_APP_TYPES) expect(familyEvent(ev(t, { link: { id: SECRET_ID } }), allOn), t).toEqual({ kind: "dropped", event: null });
  });

  it("the new visit states have their own words", () => {
    expect(renderEvent(ev("visit.changed", { visit: { id: "v9", status: "awaiting_transcript" } })).sentence).toBe(
      "The visit: the recording is saved, waiting for the transcription service.",
    );
    expect(renderEvent(ev("visit.changed", { visit: { id: "v3", status: "planned" } })).sentence).toBe("The third visit: a planned visit, not happened yet.");
  });
});
