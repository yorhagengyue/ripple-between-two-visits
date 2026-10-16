/**
 * Server-Sent Events, both ways (owner 10-15: 「需要非常完整的 SSE 的输出，无论是哪个端，子女和老人，我都需要 SSE」). Pure and
 * client-safe: the routes encode with sseFrame, and one parser reads the frames wherever they come in pieces (the model's
 * own stream in lib/llm/openai.ts, the screens' lib/sse/client.ts).
 *
 * A frame is `event: <name>` and one `data: <json>` line, then a blank line (JSON.stringify writes no raw line break, so
 * the data is always one line). The parser follows the format as browsers read it: lines end with \n, \r\n or \r (also
 * when a chunk ends between the \r and the \n), a line starting with ":" is a comment (the routes' keep-alive), several
 * data lines join with "\n", a frame with no data line is not dispatched, and the event name is "message" when none is
 * given.
 */

export interface SseFrame {
  event: string;
  data: string;
}

/** One frame: its name and its data as JSON. */
export function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** A comment line (nothing for a reader; keeps a quiet connection open through proxies). */
export function sseComment(text = ""): string {
  return `:${text ? ` ${text}` : ""}\n\n`;
}

/** The media type a request asks for (Accept) and a stream answers with. */
export const EVENT_STREAM = "text/event-stream";

/** The request asks for an event stream (the literal type in its Accept header; a browser's "*\/*" is not asking). */
export function wantsEventStream(accept: string | null | undefined): boolean {
  return (accept ?? "").toLowerCase().includes(EVENT_STREAM);
}

/** The headers of a stream that no proxy or compression may hold back. */
export const EVENT_STREAM_HEADERS: Record<string, string> = {
  "Content-Type": `${EVENT_STREAM}; charset=utf-8`,
  // no-transform: Next's compression (and any proxy) leaves the body alone, so each frame goes out when it is written
  "Cache-Control": "no-store, no-transform",
  // nginx and the like: pass each frame on as it comes
  "X-Accel-Buffering": "no",
};

export interface SseParser {
  /** the next piece of text, as it came */
  push(text: string): void;
  /** the stream ended: a last frame with no blank line after it is dispatched */
  end(): void;
}

export function createSseParser(onFrame: (frame: SseFrame) => void): SseParser {
  let rest = "";
  /** the last piece ended with \r: a \n at the start of the next one belongs to it */
  let afterCr = false;
  let event = "";
  let data: string[] = [];
  let hasData = false;

  const dispatch = () => {
    if (hasData) onFrame({ event: event || "message", data: data.join("\n") });
    event = "";
    data = [];
    hasData = false;
  };
  const line = (l: string) => {
    if (l === "") return dispatch();
    if (l.startsWith(":")) return;
    const colon = l.indexOf(":");
    const field = colon < 0 ? l : l.slice(0, colon);
    let value = colon < 0 ? "" : l.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") {
      data.push(value);
      hasData = true;
    }
    // id and retry: not used here
  };

  return {
    push(text: string) {
      let t = text;
      if (afterCr && t.startsWith("\n")) t = t.slice(1);
      afterCr = false;
      rest += t;
      for (;;) {
        const m = /\r\n|\n|\r/.exec(rest);
        if (!m) break;
        // a lone \r at the very end may be the first half of \r\n: wait for the next piece
        if (m[0] === "\r" && m.index === rest.length - 1) {
          line(rest.slice(0, m.index));
          rest = "";
          afterCr = true;
          break;
        }
        line(rest.slice(0, m.index));
        rest = rest.slice(m.index + m[0].length);
      }
    },
    end() {
      if (rest) line(rest);
      rest = "";
      dispatch();
    },
  };
}
