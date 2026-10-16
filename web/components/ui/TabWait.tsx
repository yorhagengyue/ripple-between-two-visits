"use client";

/**
 * The tab he tapped while its page is on the way (the timeline draft's 通用-1, the slow-loading sentence). Every page
 * of the app is drawn on the server from his own records, so a tap on the tab bar leaves the old page standing until
 * the server has answered. Then:
 *
 *   at once        the tab he tapped looks chosen (bold, purple, under the 4px bar), the page he is leaving no longer
 *   after 300 ms   one line over the tab bar: 「正在打开今天的记录…」 for 「今天」, 「正在打开……」 for the other four
 *   after 3 s      the line says 「还在打开，网络有点慢。」, so a long wait is never a silent one
 *   until          the page is there (this bar goes with the page it belongs to)
 *
 * No loading boundary is used for this: a boundary makes the page arrive in two parts, and what is under it answers
 * taps later than its frame does (a tap in that first moment fell through to a full page load: the site line's test
 * of its navigation mark failed three times in five with app/p/today/loading.tsx and never without). The thin bar at
 * the top of the screen (components/site/NavProgress.tsx) is the same moment's other sign; it says 「正在打开……」 to a
 * screen reader, so the first line here is for the eyes only and only the slow sentence is announced.
 *
 * `TabWaitScope` wraps the tab bar's links and draws the line; `TabProbe` sits inside each link (next/link tells a
 * link's descendants whether its page is pending). A link whose page has a loading boundary of its own (blood
 * pressure) is pending for an instant only: that page's own outline is the sign of work.
 *
 * Test hooks: tab-wait (data-tab, data-slow), [data-rp="tab-going"] inside the tapped tab.
 */
import { useLinkStatus } from "next/link";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

/** Nothing is said for a page that arrives sooner than this. */
export const TAB_WAIT_SHOW_MS = 300;
/** From here on the line says that it is slow. */
export const TAB_WAIT_SLOW_MS = 3000;

type Report = (tab: string, pending: boolean) => void;
const TabWaitContext = createContext<Report | null>(null);

function WaitLine({ tab, opening, slow }: { tab: string; opening: string; slow: string }) {
  const [stage, setStage] = useState<"quiet" | "opening" | "slow">("quiet");
  useEffect(() => {
    const show = window.setTimeout(() => setStage("opening"), TAB_WAIT_SHOW_MS);
    const late = window.setTimeout(() => setStage("slow"), TAB_WAIT_SLOW_MS);
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(late);
    };
  }, []);
  if (stage === "quiet") return null;
  return (
    <span className="rpu-tabs-wait" data-rp="tab-wait" data-testid="tab-wait" data-tab={tab} data-slow={stage === "slow" ? "true" : "false"}>
      {stage === "slow" ? <span role="status">{slow}</span> : <span aria-hidden="true">{opening}</span>}
    </span>
  );
}

export function TabWaitScope({ opening, slow, children }: { opening: Record<string, string>; slow: string; children?: ReactNode }) {
  const [going, setGoing] = useState<string | null>(null);
  const report = useCallback<Report>((tab, pending) => {
    setGoing((now) => (pending ? tab : now === tab ? null : now));
  }, []);
  return (
    <TabWaitContext.Provider value={report}>
      {children}
      {going ? <WaitLine key={going} tab={going} opening={opening[going] ?? ""} slow={slow} /> : null}
    </TabWaitContext.Provider>
  );
}

/** Inside one tab's link: marks the tab while its page is pending and tells the scope. */
export function TabProbe({ tab }: { tab: string }) {
  const { pending } = useLinkStatus();
  const report = useContext(TabWaitContext);
  useEffect(() => {
    if (!pending || !report) return;
    report(tab, true);
    return () => report(tab, false);
  }, [tab, pending, report]);
  return pending ? <span className="rpu-tab-going" data-rp="tab-going" aria-hidden="true" /> : null;
}
