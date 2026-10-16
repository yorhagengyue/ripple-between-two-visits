"use client";

/**
 * Her live connection to his day (C2 track D): GET /api/events?link=<her care link>. Her page cannot use the demo's
 * LiveSessionProvider (it names the scope by session id; an account's is never in the page): this opens her own
 * stream through her link and hands every event to the page.
 *
 *   onEvent   a hint or a switch change she may see (lib/family/events.ts filtered it on the server): re-read her view.
 *             The first frame of every connection is her switches as they are now (a family_grant.changed with the
 *             link's grant version and no id): a change she missed while not connected is put right at once
 *   onEnd     care_link.revoked for her link (he stopped sharing, by "patient"; she left, by "family"; his account is
 *             gone, by "gone"): the stream is over (the server ended it); the page shows the ended state at once
 *   onView    a fresh copy of her home, pushed by the stream right after a change of his switches (`event: view`,
 *             lib/care/her-stream.ts): the page does not have to ask for it. Passing this handler is what asks the
 *             server to push (?view=1); only her home does, since the push is logged as a look at his day
 * The connection state is on the returned value and the page puts it on the DOM as data-live (e2e waitLive).
 */
import { useEffect, useEffectEvent, useState } from "react";
import type { BusEvent } from "@/lib/bus";
import type { FamilyHomeData } from "@/lib/care/home-types";
import type { FamilyGrantItems } from "@/lib/store/types";

export type FamilyLive = "connecting" | "open" | "closed";

/** Who ended her link: he stopped sharing, she left, or his account is gone. */
export type EndedBy = "patient" | "family" | "gone";

/** His switches from a family_grant.changed frame, with which change of them it is (null: the frame did not say). */
export function switchesOf(event: BusEvent): { items: FamilyGrantItems; version: number | null } | null {
  if (event.type !== "family_grant.changed") return null;
  const grant = (event.data as { grant?: { items?: FamilyGrantItems; version?: unknown } } | null)?.grant;
  if (!grant?.items) return null;
  return { items: grant.items, version: typeof grant.version === "number" ? grant.version : null };
}

export function useFamilyStream(
  linkId: string | null,
  since: number,
  handlers: { onEvent: (e: BusEvent) => void; onEnd: (by: EndedBy) => void; onView?: (home: FamilyHomeData) => void },
): FamilyLive {
  const [live, setLive] = useState<FamilyLive>("connecting");
  const onEvent = useEffectEvent((e: BusEvent) => handlers.onEvent(e));
  const onEnd = useEffectEvent((by: EndedBy) => handlers.onEnd(by));
  const onView = useEffectEvent((home: FamilyHomeData) => handlers.onView?.(home));
  const wantsView = !!handlers.onView;

  useEffect(() => {
    if (!linkId) return;
    const source = new EventSource(`/api/events?link=${encodeURIComponent(linkId)}&since=${since}${wantsView ? "&view=1" : ""}`);
    let ended = false;
    source.onopen = () => setLive("open");
    source.onerror = () => setLive(source.readyState === EventSource.CLOSED ? "closed" : "connecting");
    source.onmessage = (message) => {
      let event: BusEvent;
      try {
        event = JSON.parse(message.data) as BusEvent;
      } catch {
        return;
      }
      if (event.type === "care_link.revoked" || event.type === "care_link.left") {
        const link = (event.data as { link?: { id?: string; by?: string } } | null)?.link;
        if (link?.id && link.id !== linkId) return;
        ended = true;
        source.close();
        setLive("closed");
        onEnd(link?.by === "family" ? "family" : link?.by === "gone" ? "gone" : "patient");
        return;
      }
      onEvent(event);
    };
    const view = (message: Event) => {
      if (ended) return;
      try {
        onView(JSON.parse((message as MessageEvent<string>).data) as FamilyHomeData);
      } catch {
        // not a copy of her home: the page reads it by itself
      }
    };
    if (wantsView) source.addEventListener("view", view);
    return () => {
      source.removeEventListener("view", view);
      if (!ended) source.close();
    };
  }, [linkId, since, wantsView]);

  return live;
}
