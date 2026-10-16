/**
 * The shapes in which an id can sit in a text (C2 track G's guard tests; real-app 5.6 H1: an account's answers, links
 * and events never carry its scope id): as it is, and inside base64 or base64url text at any of the three byte
 * alignments (a token whose payload is JSON carries an id that way, where a search for the id itself finds nothing).
 *
 *   idNeedles("0d1f...")   -> [the id, and its base64 forms]
 *   findId(text, id)       -> the forms found in the text ("plain", "base64"), empty when there is none
 */

/** The base64 pieces that must be in any base64 text that encodes something containing `id`. */
export function base64Needles(id: string): string[] {
  const out = new Set<string>();
  for (let k = 0; k < 3; k++) {
    const bytes = Buffer.concat([Buffer.alloc(k), Buffer.from(id, "utf8")]);
    const b64 = bytes.toString("base64").replace(/=+$/, "");
    // the first characters mix in the bytes before the id, the last one the byte after it: leave both out
    const from = k === 0 ? 0 : k + 1;
    const to = bytes.length % 3 === 0 ? b64.length : b64.length - 1;
    const piece = b64.slice(from, to);
    if (piece.length >= 16) {
      out.add(piece);
      out.add(piece.replace(/\+/g, "-").replace(/\//g, "_"));
    }
  }
  return [...out];
}

export function idNeedles(id: string): string[] {
  return [id, ...base64Needles(id)];
}

/** In which forms `id` is in `text`: "plain", "base64", both, or neither. */
export function findId(text: string, id: string): ("plain" | "base64")[] {
  if (!id) return [];
  const found: ("plain" | "base64")[] = [];
  if (text.toLowerCase().includes(id.toLowerCase())) found.push("plain");
  if (base64Needles(id).some((n) => text.includes(n))) found.push("base64");
  return found;
}
