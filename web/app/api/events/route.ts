/**
 * GET /api/events — Server-Sent Events for one session (spec section 6).
 * Session: ?session=<id> or cookie rp_session. 400 without one, 404 if the session does not exist.
 * Each message is one BusEvent as JSON on the default "message" event, with the SSE id set,
 * so `new EventSource("/api/events").onmessage = (e) => JSON.parse(e.data)` is all a page needs.
 * On reconnect the browser sends Last-Event-ID and missed events are replayed from the bus history
 * (`?since=<id>` does the same for clients that manage it themselves).
 *
 * STORE=supabase (several instances): the stream tails the bus_event table through lib/bus.ts, so an
 * event published on another instance arrives here too. Ids are the session's own sequence.
 *   - Resume point: Last-Event-ID (exact), else ?since=<n> when n > 0 (the page render's last id), else the
 *     newest stored id at connect time. The route sends that point as a bare `id:` line first, so even a
 *     stream that ends before its first event gives the browser a Last-Event-ID to come back with.
 *   - Events are sent strictly in id order; a gap (an id that is not cursor + 1) is filled from the table
 *     before going on, so nothing published while the browser reconnects is lost.
 *   - BUS_STREAM_MAX_MS (C2 track L: 5 minutes when unset, with either store; lib/guard/stream.ts): the stream ends
 *     itself after this long, first telling the browser to come straight back; EventSource reconnects and resumes
 *     with Last-Event-ID, and the new request passes the proxy, which renews the sign-in (real-app 3.4).
 *
 * Wei Ling's phone (family role, M6 privacy): the bus carries his notes, readings, what he asked, every safety
 * step, visit transcripts and cards, word for word. Her stream goes through lib/family/events.ts: his switches
 * (followed in stream order), the session row, this morning's dose state while he shares it, and content-free
 * "read /f again" hints for the sections he shares; nothing at all is sent for every other event (not even its
 * `id:` line, so she cannot see when hidden events happen). Her switches cannot be read: every switch off.
 * A family phone naming a session that is not its own, and a device with no row in a session she has joined (her
 * phone with its cookies dropped, for one), get 403 and no stream (lib/family/identity.ts).
 *
 * Her real account (C2 track D, ?link=<her care link>): the same filter, with his switches for her link only (a
 * change to another family member's switches is dropped); care_link.revoked / care_link.left for her link goes out as
 * { link: { id, status, by } } and the stream ends right after it (real-app 2.22: her page follows within a second);
 * her link and her switches are re-read every few seconds as well, in case an event was missed, and, where events come
 * from the shared table (STORE=supabase), before anything read from the table is sent to her (real-app 3.10 「流在每次
 * 读表时也再查一次链接」): a link that ended closes the stream there and then, whatever happened to its own event. A
 * reconnect then gets 403 link_not_active, which stops EventSource for good.
 * The one-second rule on a database that is a round trip away (10-11; lib/care/her-stream.ts has the whole account):
 * what takes something away from her screen, his switch change and the end of her link, is sent the moment this
 * instance knows of it: straight from publish() before the event is stored (lib/bus.ts subscribeEarly), and never held
 * back for the link re-read. The stream's first frame is her switches as they are now. After a switch change a stream
 * that asked for it (?view=1, her home) gets her home pushed as `event: view`, so her page does not have to ask.
 */
import type { NextRequest } from "next/server";
import { getBus, toSseFrame, type Bus, type BusEvent } from "@/lib/bus";
import { herSide, LINK_CHECK_MS, type HerCheck, type HerSide } from "@/lib/care/her-stream";
import { createFamilyStream, familyStreamFor, StreamDenied, type FamilyStream } from "@/lib/family/events";
import { NO_GRANTS } from "@/lib/family/types";
import { MEMBER_REQUIRED_DETAIL } from "@/lib/family/role";
import { RENEW_FRAME, streamMaxMs } from "@/lib/guard/stream";
import { requireSubject } from "@/lib/subject";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEEPALIVE_MS = 20_000;
/** when the caller's role cannot be read: come back after this long */
const ROLE_RETRY_MS = 2000;

const HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  // C2 track L: private, no-store like every answer of a signed-in person (real-app 3.4); no-transform kept so nothing
  // in between buffers or compresses the stream. The proxy leaves this header alone (web/proxy.ts OWN_CACHE_RULE).
  "Cache-Control": "private, no-store, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

/** Session events that never concern an account (the demo's story clock and devices): not sent on an account's stream. */
const DEMO_ONLY_TYPES = new Set<string>(["clock.changed", "session.reset", "session.filming_mode", "session.member_joined"]);

/**
 * An account's frame: no `say` (the backstage sentence quotes him and names story days), session_id "" and the scope
 * id nowhere in it (C2: no scope id in an account's pages, links or events; H4). "": nothing is sent.
 */
function accountFrame(event: BusEvent, scopeId: string, family: FamilyStream | null): string {
  if (DEMO_ONLY_TYPES.has(event.type)) return "";
  const shown = family ? family.view(event).event : event;
  if (!shown) return "";
  const text = toSseFrame({ ...shown, session_id: "", say: "" });
  return scopeId ? text.split(scopeId).join("") : text;
}

/**
 * C2 track D, her stream only: `ended` after each frame (her link's close event went out); `her` is everything else her
 * side of the stream does (lib/care/her-stream.ts: the first frame, what goes out early, the re-read of her link and
 * switches every LINK_CHECK_MS, her home pushed after a switch change).
 */
interface StreamEnd {
  ended?: () => boolean;
  her?: HerSide;
}

/**
 * What both kinds of stream do for her beyond passing events on. `send` and `close` are the stream's own; `closed` says
 * whether it is over.
 */
function herWiring(end: StreamEnd, send: (chunk: string) => void, close: () => void, closed: () => boolean) {
  const her = end.her;
  /** her home as it is now, after a change of his switches (only a stream that asked: ?view=1) */
  const pushView = () => {
    if (!her?.pushView) return;
    void her.view().then(
      (text) => send(text),
      () => {}, // could not be read: her page reads it by itself when no copy comes
    );
  };
  /** the result of a re-read of her link and switches; true when the stream is over */
  const applyCheck = (r: HerCheck | null): boolean => {
    if (closed()) return true;
    if (!r) return false;
    send(r.frame);
    if (r.end) {
      close();
      return true;
    }
    if (r.changed) pushView();
    return false;
  };
  return {
    her,
    pushView,
    applyCheck,
    /** after a frame went out: end the stream when it closed her link, push her home when it moved her switches */
    after(versionBefore: number | undefined): void {
      if (end.ended?.()) return close();
      if (her && her.version() !== versionBefore) pushView();
    },
    /** the timer that reads her link and switches again */
    watch(): ReturnType<typeof setInterval> | null {
      if (!her) return null;
      return setInterval(() => {
        void her.check().then(applyCheck, () => {});
      }, LINK_CHECK_MS);
    },
  };
}

export async function GET(req: NextRequest): Promise<Response> {
  // her care link (?link=) reads his stream, filtered by his switches for her
  const found = await requireSubject(req, { allowFamily: true });
  if (!found.ok) return found.res;
  const session = found.session;
  const sessionId = session.id;
  if (found.subject.kind === "account") {
    let family: FamilyStream | null = null;
    let end: StreamEnd = {};
    if (found.subject.relation === "family" && found.subject.link) {
      // C2 track D: her switches for HER link only; her link's end (care_link.revoked / left) closes the stream
      const linkId = found.subject.link.id;
      const grant = await found.store.getFamilyGrant(session.id, linkId).catch(() => null);
      // the family texts asked again (lib/care/reconsent.ts): the switches his events carry are cut as her store cuts hers
      const stream = createFamilyStream(grant?.items ?? { ...NO_GRANTS }, { linkId, version: grant?.version ?? 0, switches: found.store.switches });
      family = stream;
      const her = herSide({ store: found.store, scope: session, link: found.subject.link, userId: found.subject.userId ?? "", stream, grant, pushView: req.nextUrl.searchParams.get("view") === "1", consent: found.subject.consent ?? null });
      end = { ended: () => stream.closed(), her };
    }
    const accountBus = getBus();
    const accountFrameOf = (event: BusEvent) => accountFrame(event, sessionId, family);
    return accountBus.isRemote ? tailStream(req, accountBus, sessionId, accountFrameOf, "", end) : memoryStream(req, accountBus, sessionId, accountFrameOf, "", end);
  }
  // null unless the caller is Wei Ling's phone; then every frame goes through her filter. When the device's member
  // row cannot be read nobody can tell whose phone this is: never an unfiltered stream. The answer is an empty
  // stream that ends at once with `retry`, so EventSource comes back in 2 s (a non-200 would stop it for good).
  // A device that may not have this session's stream at all gets 403 (EventSource stops for good, which is right).
  let family: FamilyStream | null;
  try {
    family = await familyStreamFor(req, session, found.store);
  } catch (err) {
    if (err instanceof StreamDenied) {
      const detail = err.code === "member_required" ? MEMBER_REQUIRED_DETAIL : "Wei Ling's phone can only open the session it joined.";
      return Response.json({ error: err.code, detail }, { status: 403 });
    }
    console.warn("[events] could not read the device's role", err instanceof Error ? err.message.slice(0, 160) : "");
    return new Response(`retry: ${ROLE_RETRY_MS}\n: role unavailable\n\n`, { headers: HEADERS });
  }
  const frame = (event: BusEvent) => (family ? family.frame(event) : toSseFrame(event));

  const bus = getBus();
  if (bus.isRemote) return tailStream(req, bus, session.id, frame, session.id);
  return memoryStream(req, bus, sessionId, frame, session.id);
}

/** C2 track L: how long one stream lives: BUS_STREAM_MAX_MS, 5 minutes when it is not set (lib/guard/stream.ts). */
const lifetimeMs = (): number => streamMaxMs({ BUS_STREAM_MAX_MS: process.env.BUS_STREAM_MAX_MS });

/** The in-process stream (STORE=memory). `label` follows ": connected" (the demo's session id; "" for an account). */
function memoryStream(req: NextRequest, bus: Bus, sessionId: string, frame: (event: BusEvent) => string, label: string, end: StreamEnd = {}): Response {
  const resumeRaw = req.headers.get("last-event-id") ?? req.nextUrl.searchParams.get("since");
  const resumeFrom = resumeRaw !== null && resumeRaw !== "" ? Number(resumeRaw) : NaN;

  const encoder = new TextEncoder();
  let cleanup: () => void = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (chunk: string) => {
        if (closed || !chunk) return; // "": an event her filter dropped, nothing is sent
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      // C2 track D: after the frame that ends her link, the stream ends; after one that moved her switches, her home follows
      const wiring = herWiring(end, send, () => cleanup(), () => closed);
      const sendEvent = (event: BusEvent) => {
        const was = wiring.her?.version();
        send(frame(event));
        wiring.after(was);
      };

      send(`retry: 1000\n: connected${label ? ` ${label}` : ""}\n\n`);
      // her switches as they are now, before anything else (a change she missed while not connected is put right)
      if (wiring.her) send(wiring.her.hello);
      if (Number.isFinite(resumeFrom)) {
        for (const event of bus.recent(sessionId, { sinceId: resumeFrom })) {
          if (closed) break;
          sendEvent(event);
        }
      }

      const unsubscribe = bus.subscribe(sessionId, (event) => sendEvent(event));
      const keepalive = setInterval(() => send(": ping\n\n"), KEEPALIVE_MS);
      // C2 track L: the stream ends itself on time; the browser comes straight back (lib/guard/stream.ts)
      const lifetime = setTimeout(() => {
        send(RENEW_FRAME);
        cleanup();
      }, lifetimeMs());
      const watcher = wiring.watch();

      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(keepalive);
        clearTimeout(lifetime);
        if (watcher) clearInterval(watcher);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed by the runtime
        }
      };
      req.signal.addEventListener("abort", () => cleanup(), { once: true });
      // her link may have ended in the replayed events, before cleanup existed
      if (end.ended?.()) cleanup();
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, { headers: HEADERS });
}

// ------------------------------------------------------------------ STORE=supabase

function parseId(raw: string | null): number | null {
  const v = (raw ?? "").trim();
  return /^\d{1,15}$/.test(v) ? Number(v) : null;
}

function tailStream(req: NextRequest, bus: Bus, sessionId: string, frame: (event: BusEvent) => string, label: string, end: StreamEnd = {}): Response {
  const fromHeader = parseId(req.headers.get("last-event-id"));
  const since = parseId(req.nextUrl.searchParams.get("since"));
  const start = fromHeader ?? (since !== null && since > 0 ? since : null);
  const maxMs = lifetimeMs();
  const encoder = new TextEncoder();
  let cleanup: () => void = () => {};

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let cursor = -1; // last id sent; -1 until the resume point is known
      let pumping = false;
      let catchUp = true;
      const queue: BusEvent[] = [];
      let retryTimer: ReturnType<typeof setTimeout> | null = null;
      // C2 track D: her link was read again after everything now waiting arrived (an event that arrives later needs
      // its own read: one that came in while an earlier batch was being sent must not ride on that batch's check)
      let checked = false;

      const send = (chunk: string) => {
        if (closed || !chunk) return; // "": an event her filter dropped, nothing is sent
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      // C2 track D: her side of the stream (the first frame, what goes out early, the re-read, her home pushed)
      const wiring = herWiring(end, send, () => cleanup(), () => closed);
      const sendEvent = (event: BusEvent) => {
        // her filter may drop the event (nothing is sent); this stream's cursor advances either way (no gap to fill)
        const was = wiring.her?.version();
        send(frame(event));
        cursor = event.id;
        // C2 track D: after the frame that ends her link, the stream ends; after one that moved her switches, her home follows
        wiring.after(was);
      };

      /**
       * C2 track D (real-app 3.10 「流在每次读表时也再查一次链接」): her link (and her switches), read again before what
       * came from the table goes to her. Ended: the closing frame is sent and the stream is over (true); the events
       * just read are not sent.
       */
      const linkEnded = async (): Promise<boolean> => {
        if (!wiring.her) return false;
        return wiring.applyCheck(await wiring.her.check());
      };

      /**
       * Everything after the cursor from the shared table, in pages. Her link is read after each page and before any
       * of it is sent (not before the read: a link that ended in between would let the page through), unless the page
       * holds only what takes something away from her screen. False when the stream ended.
       */
      const fill = async (): Promise<boolean> => {
        for (;;) {
          const batch = await bus.after(sessionId, cursor, 200);
          const fresh = batch.filter((event) => event.id > cursor);
          if (fresh.some((event) => !wiring.her?.urgent(event)) && (await linkEnded())) return false;
          for (const event of fresh) if (!closed && event.id > cursor) sendEvent(event);
          if (closed) return false;
          if (batch.length < 200) return true;
        }
      };

      const pump = async () => {
        if (pumping || closed) return;
        pumping = true;
        try {
          if (cursor < 0) {
            cursor = start ?? (await bus.head(sessionId));
            send(`id: ${cursor}\n\n`); // sets the browser's Last-Event-ID before any event
          }
          // one check per read of the table: the tailer hands over what one poll found, and a catch-up reads it itself
          while (!closed) {
            if (catchUp) {
              catchUp = false;
              if (!(await fill())) return;
              continue;
            }
            const event = queue[0];
            if (!event) break;
            if (event.id <= cursor) {
              queue.shift();
              continue;
            }
            if (event.id !== cursor + 1) {
              catchUp = true; // something in between: read it from the table first
              continue;
            }
            // C2 track D: what takes something away from her screen (his switch change, the end of her link) is not
            // held back for the re-read of her link: the event is the news. Everything else waits for it.
            if (!checked && !wiring.her?.urgent(event)) {
              checked = true; // for what is waiting now; an arrival during the read clears it again
              if (await linkEnded()) return;
              continue; // the queue may have moved while her link was read
            }
            queue.shift();
            sendEvent(event);
          }
        } catch (err) {
          catchUp = true;
          console.warn(`[events] could not read the event table: ${(err as Error).message.slice(0, 160)}`);
          if (!closed && !retryTimer) {
            retryTimer = setTimeout(() => {
              retryTimer = null;
              void pump();
            }, Math.max(1000, bus.pollMs));
          }
        } finally {
          pumping = false;
        }
        if (!closed && (queue.length || catchUp) && !retryTimer) void pump();
      };

      send(`retry: 1000\n: connected${label ? ` ${label}` : ""}\n\n`);
      // her switches as they are now, before anything else (a change she missed while not connected is put right)
      if (wiring.her) send(wiring.her.hello);
      const unsubscribe = bus.subscribe(sessionId, (event) => {
        queue.push(event);
        checked = false;
        void pump();
      });
      // C2 track D: his switch change and the end of her link, straight from this instance's publish, before the event
      // is stored (one round trip sooner); the stored copy follows through the queue and her filter drops it
      const her = wiring.her;
      const unEarly = her
        ? bus.subscribeEarly(sessionId, (event) => {
            if (closed) return;
            const was = her.version();
            const text = her.early(event);
            if (!text) return;
            send(text);
            wiring.after(was);
          })
        : () => {};
      const keepalive = setInterval(() => send(": ping\n\n"), KEEPALIVE_MS);
      // C2 track L: always a lifetime (5 minutes by default), ending with the "come straight back" frame
      const lifetime = setTimeout(() => {
        send(RENEW_FRAME);
        cleanup();
      }, maxMs);
      const watcher = wiring.watch();

      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(keepalive);
        if (watcher) clearInterval(watcher);
        clearTimeout(lifetime);
        if (retryTimer) clearTimeout(retryTimer);
        unsubscribe();
        unEarly();
        try {
          controller.close();
        } catch {
          // already closed by the runtime
        }
      };
      req.signal.addEventListener("abort", () => cleanup(), { once: true });
      void pump();
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, { headers: HEADERS });
}
