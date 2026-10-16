/**
 * GET /api/health/stream — the streaming check (10-15): three `tick` events half a second apart, with the very headers
 * Ripple's streamed answers use (lib/sse/frames.ts EVENT_STREAM_HEADERS), and nothing else. It holds no data of anyone,
 * so it needs no sign-in: it lets the public address be checked for a front (the CDN, the proxy) that would hold a
 * stream back and send it all at once, which the signed-in answers cannot show without an account.
 *   curl -N https://<the app>/api/health/stream      each tick should arrive about 500 ms after the one before
 */
import { EVENT_STREAM_HEADERS, sseFrame } from "@/lib/sse/frames";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TICKS = 3;
const EVERY_MS = 500;

export async function GET(): Promise<Response> {
  const encoder = new TextEncoder();
  const started = Date.now();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (let i = 1; i <= TICKS; i++) {
        controller.enqueue(encoder.encode(sseFrame("tick", { n: i, ms: Date.now() - started })));
        if (i < TICKS) await new Promise((r) => setTimeout(r, EVERY_MS));
      }
      controller.enqueue(encoder.encode(sseFrame("done", { ms: Date.now() - started })));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: EVENT_STREAM_HEADERS });
}
