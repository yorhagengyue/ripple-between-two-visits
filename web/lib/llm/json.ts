/**
 * Parse a model's JSON answer: strict JSON, or strict JSON inside one ``` / ```json fence (vendors without a JSON
 * mode sometimes add one). Anything else throws, and every caller treats a throw as "no usable answer" (the
 * generator returns nothing, the classifier says uncertain, the layer-3 checker blocks the sentence).
 */
export function parseModelJson(content: string): unknown {
  const s = content.trim();
  const fence = /^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n?```$/i.exec(s);
  return JSON.parse(fence ? fence[1] : s);
}
