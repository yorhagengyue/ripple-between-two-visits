/**
 * The SSE frames (lib/sse/frames.ts) and the one-field reader of a streamed JSON reply (lib/sse/json-field.ts), owner 10-15
 * 「需要非常完整的 SSE 的输出」: what the routes write is what the screens and the model client read back, however the bytes are
 * cut on the way.
 */
import { describe, expect, it } from "vitest";
import { createFieldReader } from "@/lib/sse/json-field";
import { createSseParser, sseComment, sseFrame, wantsEventStream, type SseFrame } from "@/lib/sse/frames";

function parseAll(pieces: string[]): SseFrame[] {
  const out: SseFrame[] = [];
  const p = createSseParser((f) => out.push(f));
  for (const piece of pieces) p.push(piece);
  p.end();
  return out;
}

/** Every way of cutting a text in two, and one character at a time. */
function cuts(text: string): string[][] {
  const chars = [...text];
  const out: string[][] = [chars];
  for (let i = 1; i < chars.length; i++) out.push([chars.slice(0, i).join(""), chars.slice(i).join("")]);
  return out;
}

describe("SSE frames", () => {
  it("encodes an event and its JSON on one data line, and reads it back however the text is cut", () => {
    const data = { text: "口腔溃疡\n别吃太辣", n: 3, nested: { quote: 'he said "no"' } };
    const wire = sseFrame("delta", data) + sseComment("keep-alive") + sseFrame("final", { ok: true });
    expect(sseFrame("delta", data).split("\n").filter((l) => l.startsWith("data:"))).toHaveLength(1);
    for (const pieces of cuts(wire)) {
      const frames = parseAll(pieces);
      expect(frames.map((f) => f.event)).toEqual(["delta", "final"]);
      expect(JSON.parse(frames[0].data)).toEqual(data);
      expect(JSON.parse(frames[1].data)).toEqual({ ok: true });
    }
  });

  it("reads \\r\\n and \\r line ends (also a \\r\\n cut between two pieces), joins data lines, skips comments", () => {
    expect(parseAll(["event: a\r", "\ndata: 1\r\n\r\n"])).toEqual([{ event: "a", data: "1" }]);
    expect(parseAll(["event: a\rdata: x\rdata: y\r\r"])).toEqual([{ event: "a", data: "x\ny" }]);
    expect(parseAll([": just a comment\n\n", "data: plain\n\n"])).toEqual([{ event: "message", data: "plain" }]);
    // a frame with no data is not dispatched; one with no blank line after it is, when the stream ends
    expect(parseAll(["event: empty\n\n", "event: last\ndata: 9"])).toEqual([{ event: "last", data: "9" }]);
    // "data:" with no space keeps the value whole
    expect(parseAll(["data:[DONE]\n\n"])).toEqual([{ event: "message", data: "[DONE]" }]);
  });

  it("asks for a stream only with the literal type in Accept", () => {
    expect(wantsEventStream("text/event-stream")).toBe(true);
    expect(wantsEventStream("text/event-stream, application/json")).toBe(true);
    expect(wantsEventStream("*/*")).toBe(false);
    expect(wantsEventStream("application/x-ndjson")).toBe(false);
    expect(wantsEventStream(null)).toBe(false);
  });
});

describe("one field of a streamed JSON reply", () => {
  const read = (pieces: string[], name = "answer") => {
    const r = createFieldReader(name);
    const got = pieces.map((p) => r.push(p));
    return { r, got };
  };

  it("gives the field's decoded words, piece by piece, whatever the cut (escapes, a surrogate pair, a key cut in two)", () => {
    const answer = '口腔溃疡时先别吃太辣，"清淡"一点。\n多喝水 \\ 😀 ok/再看';
    const json = JSON.stringify({ answer, ask: "doctor" }).replace("😀", "\\ud83d\\ude00").replace("/", "\\/");
    for (const pieces of cuts(json)) {
      const { r } = read(pieces);
      expect(r.text).toBe(answer);
      expect(r.done).toBe(true);
    }
  });

  it("streams as the pieces come: nothing of the key, the other field or what follows", () => {
    const { got, r } = read(['{"ans', 'wer": "一般', '来说，', '先休息", "ask": "doctor"}']);
    expect(got).toEqual(["", "一般", "来说，", "先休息"]);
    expect(r.text).toBe("一般来说，先休息");
  });

  it("only the outer object's key counts; a fence before the object is passed over; a value that is no string gives nothing", () => {
    expect(read(['{"ask": "the answer is no", "inner": {"answer": "x"}, "answer": "yes"}']).r.text).toBe("yes");
    expect(read(['```json\n{"verdict": "降压药", "abstain": false}\n```'], "verdict").r.text).toBe("降压药");
    expect(read(['{"answer": null, "ask": "none"}']).r.text).toBe("");
    expect(read(['{"list": ["answer", "b"], "answer": "ok"}']).r.text).toBe("ok");
    // the first value only
    const twice = read(['{"answer": "one", "answer": "two"}']).r;
    expect(twice.text).toBe("one");
  });
});
