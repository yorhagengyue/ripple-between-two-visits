import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/events/route";
import { getBus, publish } from "@/lib/bus";
import { SESSION_COOKIE } from "@/lib/session-cookie";
import { getMemoryStore } from "@/lib/store/memory";

const decoder = new TextDecoder();

async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, needle: string): Promise<string> {
  let text = "";
  while (!text.includes(needle)) {
    const { value, done } = await reader.read();
    if (done) throw new Error(`stream ended before "${needle}"; got: ${text}`);
    text += decoder.decode(value);
  }
  return text;
}

function dataLines(text: string) {
  return text
    .split("\n")
    .filter((l) => l.startsWith("data: "))
    .map((l) => JSON.parse(l.slice(6)));
}

describe("GET /api/events", () => {
  it("needs a session", async () => {
    const res = await GET(new NextRequest("http://localhost/api/events"));
    expect(res.status).toBe(400);
    const missing = await GET(new NextRequest("http://localhost/api/events?session=does-not-exist"));
    expect(missing.status).toBe(404);
  });

  it("streams this session's events and nothing from other sessions", async () => {
    const store = getMemoryStore();
    const mine = await store.createSession();
    const other = await store.createSession();
    const abort = new AbortController();

    const res = await GET(new NextRequest(`http://localhost/api/events?session=${mine.id}`, { signal: abort.signal }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    expect(await readUntil(reader, "connected")).toContain("retry: 1000");
    expect(getBus().listenerCount(mine.id)).toBe(1);

    publish(other.id, "dose.logged", "not mine", {});
    const ev = publish(mine.id, "dose.logged", "陈先生勾了「吃了」", { day: 29, state: "taken" });
    const text = await readUntil(reader, `id: ${ev.id}`);
    const events = dataLines(text);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "dose.logged", session_id: mine.id, say: "陈先生勾了「吃了」", data: { state: "taken" } });

    abort.abort();
    expect(getBus().listenerCount(mine.id)).toBe(0);
  });

  it("reads the session from the rp_session cookie and replays after Last-Event-ID", async () => {
    const store = getMemoryStore();
    const s = await store.createSession();
    const first = publish(s.id, "clock.changed", "Day 8", { day: 8 });
    const second = publish(s.id, "clock.changed", "Day 9", { day: 9 });

    const res = await GET(
      new NextRequest("http://localhost/api/events", {
        headers: { cookie: `${SESSION_COOKIE}=${s.id}`, "last-event-id": String(first.id) },
      }),
    );
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    const text = await readUntil(reader, `id: ${second.id}`);
    expect(dataLines(text).map((e) => e.say)).toEqual(["Day 9"]);
    await reader.cancel();
    expect(getBus().listenerCount(s.id)).toBe(0);
  });
});
