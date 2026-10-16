/**
 * The phone's to-send list, by its rules alone (C2 track O; real-app 2.25): lib/offline/outbox.ts with a storage and a
 * sender handed in. The same rules against the real routes are in late-routes.test.ts and client.test.ts.
 */
import { describe, expect, it } from "vitest";
import { add, clear, doseKey, flush, mine, OUTBOX_LIMIT, readAll, remove, type NewEntry, type OutboxEntry, type OutboxStorage, type SendResult } from "@/lib/offline/outbox";

function memoryStorage(): OutboxStorage & { raw: string | null } {
  const s = {
    raw: null as string | null,
    read: () => s.raw,
    write: (v: string | null) => {
      s.raw = v;
    },
  };
  return s;
}

const HIM = "o-him";
const HER = "o-her";

function dose(id: string, at: string, over: Partial<NewEntry> = {}): NewEntry {
  return {
    id,
    owner: HIM,
    kind: "dose",
    key: doseKey("med-a", "2026-10-13", "morning"),
    at,
    body: { medication_id: "med-a", slot: "morning", state: "taken", reason: null, reason_text: null },
    label: { kind: "dose", slot: "morning", state: "taken", reason: null },
    ...over,
  };
}

function bp(id: string, at: string, over: Partial<NewEntry> = {}): NewEntry {
  return { id, owner: HIM, kind: "bp", key: `bp:${id}`, at, body: { id, systolic: 138, diastolic: 82 }, label: { kind: "bp", systolic: 138, diastolic: 82, pulse: null }, ...over };
}

/** A sender that answers from a script (by entry id) and remembers what it was asked to send, in order. */
function scripted(answers: Record<string, SendResult | SendResult[]>) {
  const sent: OutboxEntry[] = [];
  const send = async (e: OutboxEntry): Promise<SendResult> => {
    sent.push(e);
    const a = answers[e.id] ?? { status: 200 };
    return Array.isArray(a) ? (a.shift() ?? { status: 200 }) : a;
  };
  return { sent, send };
}

describe("the to-send list", () => {
  it("is sent in the order he tapped, each entry with the moment he tapped", async () => {
    const s = memoryStorage();
    expect(add(s, dose("d1", "2026-10-13T00:52:00.000Z"))).toBe(true);
    expect(add(s, bp("b1", "2026-10-13T00:55:10.000Z"))).toBe(true);
    expect(add(s, dose("d2", "2026-10-13T00:58:00.000Z", { key: doseKey("med-b", "2026-10-13", "morning"), body: { medication_id: "med-b", slot: "morning", state: "missed", reason: "forgot", reason_text: "忘了" } }))).toBe(true);
    const { sent, send } = scripted({});
    const report = await flush(s, HIM, send);
    expect(sent.map((e) => e.id)).toEqual(["d1", "b1", "d2"]);
    expect(sent.map((e) => e.at)).toEqual(["2026-10-13T00:52:00.000Z", "2026-10-13T00:55:10.000Z", "2026-10-13T00:58:00.000Z"]);
    expect(report).toMatchObject({ stopped: null, waiting: 0 });
    expect(report.sent).toHaveLength(3);
    expect(readAll(s)).toEqual([]);
    expect(s.raw).toBeNull();
  });

  it("a newer answer for the same medicine, day and slot replaces the one still waiting; a reading is only ever itself", () => {
    const s = memoryStorage();
    add(s, dose("d1", "2026-10-13T00:52:00.000Z", { body: { medication_id: "med-a", slot: "morning", state: "missed", reason: null, reason_text: null } }));
    add(s, bp("b1", "2026-10-13T00:53:00.000Z"));
    add(s, dose("d2", "2026-10-13T00:54:00.000Z", { body: { medication_id: "med-a", slot: "morning", state: "missed", reason: "forgot", reason_text: "忘了" } }));
    add(s, bp("b2", "2026-10-13T00:56:00.000Z"));
    // another day's cell and another account's same cell are other cells
    add(s, dose("d3", "2026-10-12T15:00:00.000Z", { key: doseKey("med-a", "2026-10-12", "morning") }));
    add(s, dose("x1", "2026-10-13T00:57:00.000Z", { owner: HER }));
    expect(mine(s, HIM).map((e) => e.id)).toEqual(["b1", "d2", "b2", "d3"]);
    expect(mine(s, HER).map((e) => e.id)).toEqual(["x1"]);
  });

  it("no answer from the server: everything waits, in order, and goes out on a later flush", async () => {
    const s = memoryStorage();
    add(s, dose("d1", "2026-10-13T00:52:00.000Z"));
    add(s, bp("b1", "2026-10-13T00:55:00.000Z"));
    const down = scripted({ d1: { status: 0 } });
    const first = await flush(s, HIM, down.send);
    expect(first).toMatchObject({ stopped: "no_network", waiting: 2 });
    expect(down.sent.map((e) => e.id)).toEqual(["d1"]); // what is behind it is not tried: order is kept
    for (const status of [408, 429, 502, 503, 504]) {
      const again = await flush(s, HIM, scripted({ d1: { status } }).send);
      expect(again, String(status)).toMatchObject({ stopped: "no_network", waiting: 2 });
    }
    const up = scripted({});
    expect(await flush(s, HIM, up.send)).toMatchObject({ stopped: null, waiting: 0 });
    expect(up.sent.map((e) => e.id)).toEqual(["d1", "b1"]);
    // a sender that throws is "no answer" too
    add(s, bp("b2", "2026-10-13T01:00:00.000Z"));
    expect(
      await flush(s, HIM, async () => {
        throw new TypeError("Failed to fetch");
      }),
    ).toMatchObject({ stopped: "no_network", waiting: 1 });
  });

  it("sending an entry again after a lost reply sends the very same entry (same id, same moment)", async () => {
    const s = memoryStorage();
    add(s, bp("b1", "2026-10-13T00:55:00.000Z"));
    const lost = scripted({ b1: [{ status: 0 }, { status: 200 }] });
    await flush(s, HIM, lost.send);
    await flush(s, HIM, lost.send);
    expect(lost.sent).toHaveLength(2);
    expect(lost.sent[0]).toEqual(lost.sent[1]);
    expect(readAll(s)).toEqual([]);
  });

  it("a refusal stays in the list with the server's reason until he puts it away; the rest still goes out", async () => {
    const s = memoryStorage();
    add(s, dose("d1", "2026-10-10T00:52:00.000Z", { key: doseKey("med-a", "2026-10-10", "morning") }));
    add(s, bp("b1", "2026-10-13T00:55:00.000Z"));
    add(s, dose("d2", "2026-10-13T00:58:00.000Z", { key: doseKey("med-gone", "2026-10-13", "morning") }));
    const { sent, send } = scripted({ d1: { status: 409, code: "too_late" }, d2: { status: 404, code: "not_found" } });
    const report = await flush(s, HIM, send);
    expect(sent.map((e) => e.id)).toEqual(["d1", "b1", "d2"]);
    expect(report.stopped).toBeNull();
    expect(report.sent.map((e) => e.id)).toEqual(["b1"]);
    expect(report.refused.map((e) => [e.id, e.why])).toEqual([
      ["d1", "too_late"],
      ["d2", "not_found"],
    ]);
    expect(mine(s, HIM).map((e) => [e.id, e.state, e.why])).toEqual([
      ["d1", "refused", "too_late"],
      ["d2", "refused", "not_found"],
    ]);
    // a refused entry is never sent again, and never leaves by itself
    const later = scripted({});
    expect(await flush(s, HIM, later.send)).toMatchObject({ waiting: 0 });
    expect(later.sent).toEqual([]);
    expect(mine(s, HIM)).toHaveLength(2);
    // a new answer for the refused cell is a new entry next to it, not a replacement of what he must still see
    add(s, dose("d3", "2026-10-13T01:10:00.000Z", { key: doseKey("med-a", "2026-10-10", "morning") }));
    expect(mine(s, HIM).map((e) => e.id)).toEqual(["d1", "d2", "d3"]);
    expect(remove(s, HIM, "d1")).toBe(true);
    expect(remove(s, HIM, "d1")).toBe(false);
    expect(mine(s, HIM).map((e) => e.id)).toEqual(["d2", "d3"]);
  });

  it("a refusal without a code keeps its status; a server error holds the list, then counts as refused after five", async () => {
    const s = memoryStorage();
    add(s, dose("d1", "2026-10-13T00:52:00.000Z"));
    add(s, bp("b1", "2026-10-13T00:55:00.000Z"));
    for (let i = 1; i <= 4; i++) {
      const r = await flush(s, HIM, scripted({ d1: { status: 500 } }).send);
      expect(r, `try ${i}`).toMatchObject({ stopped: "server_error", waiting: 2 });
      expect(mine(s, HIM)[0].tries).toBe(i);
    }
    const fifth = await flush(s, HIM, scripted({ d1: { status: 500 }, b1: { status: 403 } }).send);
    expect(fifth.stopped).toBeNull();
    expect(mine(s, HIM).map((e) => [e.id, e.state, e.why])).toEqual([
      ["d1", "refused", "server_error"],
      ["b1", "refused", "http_403"],
    ]);
  });

  it("a sign-in that ended stops the flush and keeps everything", async () => {
    const s = memoryStorage();
    add(s, dose("d1", "2026-10-13T00:52:00.000Z"));
    add(s, bp("b1", "2026-10-13T00:55:00.000Z"));
    const r = await flush(s, HIM, scripted({ d1: { status: 401, code: "not_signed_in" } }).send);
    expect(r).toMatchObject({ stopped: "signed_out", waiting: 2 });
    expect(mine(s, HIM).every((e) => e.state === "waiting")).toBe(true);
  });

  it("is never sent, nor listed, under another account that signs in on the same phone", async () => {
    const s = memoryStorage();
    add(s, dose("d1", "2026-10-13T00:52:00.000Z"));
    add(s, bp("b1", "2026-10-13T00:55:00.000Z"));
    const hers = scripted({});
    const r = await flush(s, HER, hers.send);
    expect(hers.sent).toEqual([]);
    expect(r).toMatchObject({ stopped: null, waiting: 0 });
    expect(mine(s, HER)).toEqual([]);
    expect(remove(s, HER, "d1")).toBe(false);
    // nobody signed in: nothing either
    const nobody = scripted({});
    await flush(s, null, nobody.send);
    expect(nobody.sent).toEqual([]);
    expect(mine(s, null)).toEqual([]);
    // his entries are still there for him, untouched
    expect(mine(s, HIM).map((e) => [e.id, e.state])).toEqual([
      ["d1", "waiting"],
      ["b1", "waiting"],
    ]);
    // the server says the phone is signed in to another account: the flush stops and nothing is marked refused
    const wrong = await flush(s, HIM, scripted({ d1: { status: 409, code: "other_account" } }).send);
    expect(wrong).toMatchObject({ stopped: "other_account", waiting: 2 });
    expect(mine(s, HIM).every((e) => e.state === "waiting")).toBe(true);
  });

  it("logging out clears every entry on the phone, whoever tapped it, sent or refused", async () => {
    const s = memoryStorage();
    add(s, dose("d1", "2026-10-10T00:52:00.000Z"));
    add(s, bp("b1", "2026-10-13T00:55:00.000Z"));
    add(s, bp("x1", "2026-10-13T00:56:00.000Z", { owner: HER }));
    await flush(s, HIM, scripted({ d1: { status: 409, code: "too_late" }, b1: { status: 0 } }).send);
    expect(readAll(s)).toHaveLength(3);
    clear(s);
    expect(readAll(s)).toEqual([]);
    expect(s.raw).toBeNull();
    expect(mine(s, HIM)).toEqual([]);
    expect(mine(s, HER)).toEqual([]);
  });

  it("an entry another tab already sent or took out is not sent from here", async () => {
    const s = memoryStorage();
    add(s, dose("d1", "2026-10-13T00:52:00.000Z"));
    add(s, bp("b1", "2026-10-13T00:55:00.000Z"));
    add(s, bp("b2", "2026-10-13T00:56:00.000Z"));
    const sent: string[] = [];
    await flush(s, HIM, async (e) => {
      sent.push(e.id);
      if (e.id === "d1") remove(s, HIM, "b1"); // meanwhile, elsewhere
      return { status: 200 };
    });
    expect(sent).toEqual(["d1", "b2"]);
    expect(readAll(s)).toEqual([]);
  });

  it("a phone that cannot keep the entry says so; a list that cannot be read counts as empty and is not sent", async () => {
    const full = memoryStorage();
    for (let i = 0; i < OUTBOX_LIMIT; i++) expect(add(full, bp(`b${i}`, "2026-10-13T00:55:00.000Z"))).toBe(true);
    expect(add(full, bp("one-more", "2026-10-13T00:56:00.000Z"))).toBe(false);
    expect(readAll(full)).toHaveLength(OUTBOX_LIMIT);

    const refusing: OutboxStorage = {
      read: () => null,
      write: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(add(refusing, bp("b1", "2026-10-13T00:55:00.000Z"))).toBe(false);
    expect(add(memoryStorage(), bp("b1", "2026-10-13T00:55:00.000Z", { owner: "" }))).toBe(false);

    const broken = memoryStorage();
    broken.raw = "{not json";
    expect(readAll(broken)).toEqual([]);
    broken.raw = JSON.stringify([{ id: "x" }, null, 3]);
    expect(readAll(broken)).toEqual([]);
    const nothing = scripted({});
    await flush(broken, HIM, nothing.send);
    expect(nothing.sent).toEqual([]);
  });
});
