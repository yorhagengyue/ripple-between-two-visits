/**
 * One string field of a JSON reply, read while the model is still writing it (owner 10-15, SSE). Ripple's own answer
 * (lib/safety/general.ts) and the long press's sentence (lib/explain/verdict.ts) are asked for in JSON mode, so what
 * streams is `{"answer": "口腔溃疡的时候…` in pieces. This reads the pieces and gives back only the decoded words of the
 * one field asked for (`answer`, `verdict`), as soon as each is certain:
 *
 *   - only a key of the outer object counts (a key inside another value, or the same word inside a string, does not);
 *   - escapes are decoded (\" \\ \/ \n \t \r \b \f \uXXXX, a surrogate pair kept together), also when a piece ends in
 *     the middle of one;
 *   - anything before the first `{` (a ``` fence some vendors add) is passed over;
 *   - the field's first value only; a value that is not a string gives nothing.
 * The whole reply, parsed once it is complete (lib/llm/json.ts parseModelJson), stays the truth: this is only what the
 * screen shows while it is written, and the guards read the parsed answer. Pure and client-safe.
 */

export interface FieldReader {
  /** the next piece of the reply; returns the field's words this piece made certain ("" when none) */
  push(chunk: string): string;
  /** everything of the field read so far */
  readonly text: string;
  /** the field's closing quote has been read */
  readonly done: boolean;
}

const ESCAPES: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", n: "\n", t: "\t", r: "\r", b: "\b", f: "\f" };

export function createFieldReader(name: string): FieldReader {
  let depth = 0;
  let inString = false;
  let escape = false;
  /** the hex digits of a \u escape being read */
  let hex: string | null = null;
  /** a high surrogate waiting for its low half */
  let high: number | null = null;
  /** what the string being read is: an outer key, an outer value, or anything else */
  let role: "key" | "value" | "other" = "other";
  let key = "";
  let lastKey: string | null = null;
  /** at depth 1: what comes next */
  let expect: "key" | "colon" | "value" | "comma" = "key";
  let streaming = false;
  let done = false;
  let all = "";

  const put = (ch: string, out: string[]) => {
    if (role === "key") key += ch;
    else if (streaming) out.push(ch);
  };
  const flushHigh = (out: string[]) => {
    if (high === null) return;
    put(String.fromCharCode(high), out);
    high = null;
  };

  return {
    push(chunk: string): string {
      const out: string[] = [];
      for (const c of chunk) {
        if (inString) {
          if (hex !== null) {
            hex += c;
            if (hex.length < 4) continue;
            const code = Number.parseInt(hex, 16);
            hex = null;
            if (!Number.isFinite(code)) continue;
            if (code >= 0xd800 && code <= 0xdbff) {
              flushHigh(out);
              high = code;
            } else if (code >= 0xdc00 && code <= 0xdfff && high !== null) {
              put(String.fromCharCode(high, code), out);
              high = null;
            } else {
              flushHigh(out);
              put(String.fromCharCode(code), out);
            }
            continue;
          }
          if (escape) {
            escape = false;
            if (c === "u") {
              hex = "";
              continue;
            }
            flushHigh(out);
            put(ESCAPES[c] ?? c, out);
            continue;
          }
          if (c === "\\") {
            escape = true;
            continue;
          }
          flushHigh(out);
          if (c === '"') {
            inString = false;
            if (role === "key") {
              lastKey = key;
              expect = "colon";
            } else if (role === "value") {
              expect = "comma";
              if (streaming) {
                streaming = false;
                done = true;
              }
            }
            role = "other";
            continue;
          }
          put(c, out);
          continue;
        }
        if (c === " " || c === "\n" || c === "\r" || c === "\t") continue;
        if (c === "{" || c === "[") {
          depth++;
          if (depth === 1) expect = c === "{" ? "key" : "comma";
          continue;
        }
        if (c === "}" || c === "]") {
          depth = Math.max(0, depth - 1);
          if (depth === 1) expect = "comma";
          continue;
        }
        if (c === '"') {
          inString = true;
          if (depth === 1 && expect === "key") {
            role = "key";
            key = "";
          } else if (depth === 1 && expect === "value") {
            role = "value";
            streaming = !done && lastKey === name;
          } else {
            role = "other";
          }
          continue;
        }
        if (depth !== 1) continue;
        if (c === ":" && expect === "colon") expect = "value";
        else if (c === ",") expect = "key";
        else if (expect === "value") expect = "comma"; // a number, true, false or null
      }
      const got = out.join("");
      all += got;
      return got;
    },
    get text() {
      return all;
    },
    get done() {
      return done;
    },
  };
}
