/**
 * The screens' side of SSE (owner 10-15: 「需要非常完整的 SSE 的输出，无论是哪个端，子女和老人，我都需要 SSE」): one POST that
 * asks for text/event-stream and hands each event to the screen as it arrives. Used by his 提问 sheet
 * (components/ask/AskFab.tsx), his ask page (components/today/AskSection.tsx) and the long press's sheet on both sides
 * (components/explain/ExplainSheet.tsx).
 *
 *   the request   POST with a JSON body, `Accept: text/event-stream`, through the caller's fetch (fetchSignedIn: a sign-in
 *                 that ended goes to the login and back, as for every request of his)
 *   the answer    an event stream: each frame's JSON goes to onEvent in order (lib/sse/frames.ts parses them, however
 *                 the bytes are cut); a plain answer (a refusal is one: 400, 401, 404, 429 with its words) is handed back
 *                 untouched, for the caller to read as it always did
 *   the end       `ended` is true once a final or an error event came. A stream that broke before that (the network, a
 *                 proxy) is not an error here: the caller falls back to the plain request, so he always gets his answer
 *   closing       the caller's signal aborts the request and the reading (he closed the sheet)
 *
 * Test hook: window.__rpStream, one entry per request (performance.now() ms): when it started, its first event, its first
 * sentence and its first word of Ripple's own, how many of each came, and when the final one did. The live checks read
 * the timings from there (nothing of the answer's words is kept in it).
 */
import { createSseParser, EVENT_STREAM } from "./frames";

export interface StreamEvent {
  event: string;
  data: unknown;
}

export interface StreamTiming {
  url: string;
  startedAt: number;
  /** the response's headers arrived */
  openedAt: number | null;
  firstEventAt: number | null;
  /** the first sentence of the answer (or, on the sheet, what Ripple looked at) */
  firstSentenceAt: number | null;
  /** the first word of Ripple's own (a delta) */
  firstDeltaAt: number | null;
  sentences: number;
  deltas: number;
  retracts: number;
  finalAt: number | null;
  /** "final", "error", "broken" (the stream stopped before its end), "plain" (a plain answer came) */
  end: string | null;
}

declare global {
  interface Window {
    __rpStream?: StreamTiming[];
  }
}

export interface StreamOutcome {
  /** the answer came as an event stream (its events went to onEvent); false: a plain answer, in `res` as it came */
  streamed: boolean;
  res: Response;
  /** a final or an error event came: the stream is complete */
  ended: boolean;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

function timingEntry(url: string): StreamTiming | null {
  if (typeof window === "undefined") return null;
  const t: StreamTiming = { url, startedAt: now(), openedAt: null, firstEventAt: null, firstSentenceAt: null, firstDeltaAt: null, sentences: 0, deltas: 0, retracts: 0, finalAt: null, end: null };
  (window.__rpStream ??= []).push(t);
  if (window.__rpStream.length > 50) window.__rpStream.shift();
  return t;
}

function note(t: StreamTiming | null, event: string): void {
  if (!t) return;
  const at = now();
  t.firstEventAt ??= at;
  if (event === "sentence" || event === "read") {
    t.sentences++;
    t.firstSentenceAt ??= at;
  } else if (event === "delta") {
    t.deltas++;
    t.firstDeltaAt ??= at;
  } else if (event === "retract") {
    t.retracts++;
  } else if (event === "final" || event === "error") {
    t.finalAt = at;
    t.end = event;
  }
}

/**
 * POST `body` as JSON to `url`, asking for an event stream, and hand each event to `onEvent`. Rejects only when no answer
 * came at all (the network, or the caller aborted before the headers).
 */
export async function postEventStream(
  url: string,
  body: unknown,
  opts: { onEvent: (e: StreamEvent) => void; signal?: AbortSignal; fetchImpl?: FetchLike },
): Promise<StreamOutcome> {
  const timing = timingEntry(url);
  const doFetch: FetchLike = opts.fetchImpl ?? ((input, init) => fetch(input, init));
  const res = await doFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: EVENT_STREAM },
    credentials: "same-origin",
    body: JSON.stringify(body),
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  if (timing) timing.openedAt = now();
  if (!(res.headers.get("content-type") ?? "").toLowerCase().includes(EVENT_STREAM) || !res.body) {
    if (timing) timing.end = "plain";
    return { streamed: false, res, ended: false };
  }
  let ended = false;
  const parser = createSseParser((frame) => {
    let data: unknown;
    try {
      data = JSON.parse(frame.data);
    } catch {
      return;
    }
    note(timing, frame.event);
    if (frame.event === "final" || frame.event === "error") ended = true;
    opts.onEvent({ event: frame.event, data });
  });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (value) parser.push(decoder.decode(value, { stream: true }));
      if (done) break;
    }
    parser.push(decoder.decode());
    parser.end();
  } catch {
    // the stream broke off (or he closed the screen): what came is kept, `ended` says whether it was all
  }
  if (timing && !ended) timing.end = "broken";
  return { streamed: true, res, ended };
}
