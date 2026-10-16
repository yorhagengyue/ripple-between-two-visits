"use client";

/**
 * Wei Ling's "no reply after two reminders" card (task M4 item 5), from GET /api/family/alerts. It reaches her only
 * while Mr Tan has family_grant.no_reply_alert on (the API returns nothing otherwise). Refreshed live when a dose is
 * logged (the window closing, the director's "no reply"), the grant changes, the clock moves or the session resets.
 */
import { useEffect, useState } from "react";
import { useLiveEvent, useLiveSession } from "@/components/live/LiveSession";
import type { Locale } from "@/lib/i18n";
import { dt, shortDay } from "@/lib/daily/i18n";
import type { FamilyAlertsResponse } from "@/lib/daily/types";
import { withSession } from "@/lib/session/client";

export function FamilyAlerts({ locale }: { locale: Locale }) {
  const { session } = useLiveSession();
  const [data, setData] = useState<FamilyAlertsResponse | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(withSession("/api/family/alerts", session.id), { credentials: "same-origin", cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<FamilyAlertsResponse>) : null))
      .then((body) => {
        if (!cancelled && body) setData(body);
      })
      .catch(() => {
        // keep what is shown
      });
    return () => {
      cancelled = true;
    };
  }, [session.id, session.story_day, session.story_time, tick]);

  useLiveEvent(() => setTick((n) => n + 1), ["dose.logged", "family_grant.changed", "clock.changed", "session.reset"]);

  const alerts = data?.on ? data.alerts : [];
  if (alerts.length === 0) return <div hidden data-testid="family-alerts" data-on={data ? String(data.on) : "unknown"} data-count={0} />;
  return (
    <section className="rp-card border-2 border-hair-2" data-testid="family-alerts" data-on="true" data-count={alerts.length}>
      <p className="font-bold text-ink-2">{dt(locale, "alerts.title")}</p>
      <ul className="mt-2 flex flex-col gap-2">
        {alerts.map((a) => (
          <li key={a.id} className="text-body" data-testid="family-alert" data-day={a.day} data-medication={a.medication_id}>
            {dt(locale, "alerts.item", { name: a.name, slot: dt(locale, `bp.slot.${a.slot}`), date: shortDay(locale, a.date) })}
          </li>
        ))}
      </ul>
    </section>
  );
}
