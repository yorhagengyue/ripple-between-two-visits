"use client";

/**
 * One live connection per page: subscribes to GET /api/events for this page's session (Server-Sent
 * Events, spec section 6) and hands every event to the components that ask for it.
 *
 * - The session id comes from the server render and is sent explicitly (`?session=`), so the page
 *   stays on the session it was rendered for even if another tab rewrites the cookie.
 * - `since` is the last event id at render time; the stream replays anything published in between.
 *   On reconnect the browser sends Last-Event-ID and the route replays what was missed.
 * - Events that carry the session row (clock.changed, session.reset, session.filming_mode) update the
 *   day label and filming mode directly from the event.
 * - Components that must react within a second (dose ticks, the reminder card) read the event payload
 *   via useLiveEvent. Everything else is re-read from the server with router.refresh(), debounced.
 * - Connection state is on the DOM as data-live="connecting" | "open" | "closed" (e2e waits for "open").
 */
import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { BusEvent } from "@/lib/bus";
import { withSession } from "@/lib/session/client";
import { REFRESH_EVENT_TYPES, SESSION_ROW_EVENT_TYPES, type SessionEventData } from "@/lib/session/events";
import type { SessionRow } from "@/lib/store/types";

export type LiveState = "connecting" | "open" | "closed";
type Listener = (event: BusEvent) => void;

interface LiveSessionValue {
  session: SessionRow;
  d0: string;
  live: LiveState;
  subscribe(listener: Listener): () => void;
}

const LiveSessionContext = createContext<LiveSessionValue | null>(null);

const REFRESH_DEBOUNCE_MS = 60;

export function LiveSessionProvider({
  session: initialSession,
  d0,
  since,
  refreshOnEvents = true,
  children,
}: {
  session: SessionRow;
  d0: string;
  since: number;
  /** re-read server data (router.refresh) after data events */
  refreshOnEvents?: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const [session, setSession] = useState(initialSession);
  const [live, setLive] = useState<LiveState>("connecting");
  const listeners = useRef(new Set<Listener>());
  const sessionId = initialSession.id;
  const sinceAtMount = useRef(since);

  const subscribe = useCallback((listener: Listener) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  const onEvent = useEffectEvent((event: BusEvent, scheduleRefresh: () => void) => {
    if (SESSION_ROW_EVENT_TYPES.has(event.type)) {
      const row = (event.data as SessionEventData | null)?.session;
      if (row && row.id === sessionId) setSession(row);
    }
    for (const listener of [...listeners.current]) {
      try {
        listener(event);
      } catch (err) {
        console.error("[live] listener failed", err);
      }
    }
    if (refreshOnEvents && REFRESH_EVENT_TYPES.has(event.type)) scheduleRefresh();
  });

  useEffect(() => {
    const seen = new Set<number>();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), REFRESH_DEBOUNCE_MS);
    };
    const source = new EventSource(withSession(`/api/events?since=${sinceAtMount.current}`, sessionId));
    source.onopen = () => setLive("open");
    source.onerror = () => setLive(source.readyState === EventSource.CLOSED ? "closed" : "connecting");
    source.onmessage = (message) => {
      let event: BusEvent;
      try {
        event = JSON.parse(message.data) as BusEvent;
      } catch {
        return;
      }
      if (event.session_id !== sessionId || seen.has(event.id)) return;
      seen.add(event.id);
      onEvent(event, scheduleRefresh);
    };
    return () => {
      source.close();
      if (timer) clearTimeout(timer);
    };
  }, [sessionId, router]);

  const value = useMemo<LiveSessionValue>(() => ({ session, d0, live, subscribe }), [session, d0, live, subscribe]);

  return (
    <LiveSessionContext.Provider value={value}>
      <div className="contents" data-live={live} data-session-id={sessionId}>
        {children}
      </div>
    </LiveSessionContext.Provider>
  );
}

export function useLiveSession(): LiveSessionValue {
  const value = useContext(LiveSessionContext);
  if (!value) throw new Error("useLiveSession must be used inside <LiveSessionProvider>");
  return value;
}

/** Call `handler` for every event of this page's session (optionally only the given types). */
export function useLiveEvent(handler: Listener, types?: readonly string[]): void {
  const { subscribe } = useLiveSession();
  const typeKey = types ? types.join(",") : "";
  const onEvent = useEffectEvent((event: BusEvent) => {
    if (!typeKey || typeKey.split(",").includes(event.type)) handler(event);
  });
  useEffect(() => subscribe((event) => onEvent(event)), [subscribe]);
}
