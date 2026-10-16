"use client";

/**
 * 「家人能看到什么」 on Mr Tan's phone (task M6 item 2): one switch per item, changeable any time. Each tap posts
 * POST /api/family/grants; Wei Ling's open /f follows from the family_grant.changed event (1 s; up to 2 s for a
 * section switched on under STORE=supabase this wave, see components/family/FamilyView.tsx). The
 * switches also follow changes made on another of his devices, and a session reset (back to the seed's defaults).
 * Only Mr Tan may change them: a 403 shows "only Mr Tan can change this" and the switch goes back.
 *
 * No silent failure: a tap that fails (non-2xx, no answer within 8 s) puts the switch back and says so; a reload of
 * the switches after a reset that fails says the switches shown may be out of date and tries again by itself (1 s,
 * 2 s, 4 s, 8 s, then every 15 s) until it reads them.
 */
import { useEffect, useRef, useState } from "react";
import { useLiveEvent, useLiveSession } from "@/components/live/LiveSession";
import { isGrantsResponse, requestJson, retryDelayMs } from "@/lib/family/fetch";
import { ft, type FamilyKey } from "@/lib/family/i18n";
import { GRANT_KEYS, NO_GRANTS, type FamilyGrantChangedData, type GrantKey, type GrantsResponse } from "@/lib/family/types";
import { t, type Locale, type MessageKey } from "@/lib/i18n";
import { withSession } from "@/lib/session/client";
import type { FamilyGrantItems } from "@/lib/store/types";

export function GrantSwitches({ locale, initial }: { locale: Locale; initial: FamilyGrantItems }) {
  const { session } = useLiveSession();
  const [items, setItems] = useState<FamilyGrantItems>({ ...NO_GRANTS, ...initial });
  const [busy, setBusy] = useState<GrantKey | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** bumped to (re)read the switches from the server: a reset, or the next automatic try after a failed read */
  const [reload, setReload] = useState(0);
  const [loadFailed, setLoadFailed] = useState(false);
  const failures = useRef(0);

  useLiveEvent((event) => {
    if (event.type === "family_grant.changed") {
      const data = event.data as FamilyGrantChangedData;
      if (data?.grant?.items) {
        setItems({ ...NO_GRANTS, ...data.grant.items });
        // the event carries the whole row: what is shown is current again
        failures.current = 0;
        setLoadFailed(false);
        setReload(0);
      }
      return;
    }
    // session.reset: back to the seed's defaults
    setReload((n) => n + 1);
  }, ["family_grant.changed", "session.reset"]);

  useEffect(() => {
    if (reload === 0) return;
    const ctrl = new AbortController();
    let retry: ReturnType<typeof setTimeout> | null = null;
    void requestJson<GrantsResponse>(withSession("/api/family/grants", session.id), { signal: ctrl.signal, check: isGrantsResponse }).then((r) => {
      if (r.ok) {
        failures.current = 0;
        setLoadFailed(false);
        setItems({ ...NO_GRANTS, ...r.data.items });
        return;
      }
      if (r.problem === "aborted") return;
      console.warn("[family/grants] reading the switches failed", r.problem, r.status ?? "", r.code ?? "");
      setLoadFailed(true);
      retry = setTimeout(() => setReload((n) => n + 1), retryDelayMs(failures.current));
      failures.current += 1;
    });
    return () => {
      ctrl.abort();
      if (retry) clearTimeout(retry);
    };
  }, [reload, session.id]);

  async function toggle(key: GrantKey) {
    const next = !items[key];
    const before = items;
    setItems({ ...items, [key]: next });
    setBusy(key);
    setError(null);
    const r = await requestJson<GrantsResponse>(withSession("/api/family/grants", session.id), { method: "POST", json: { items: { [key]: next } }, check: isGrantsResponse });
    if (r.ok) {
      setItems({ ...NO_GRANTS, ...r.data.items });
    } else {
      setItems(before);
      setError(r.problem === "http" && r.status === 403 ? ft(locale, "g.denied") : ft(locale, "g.error"));
    }
    setBusy(null);
  }

  return (
    <section className="flex flex-col gap-3" data-testid="grant-switches" data-load-failed={loadFailed ? "true" : "false"}>
      {loadFailed ? (
        <p className="text-body text-ink-2" role="status" data-testid="grant-load-error">
          {ft(locale, "g.error.load")}
        </p>
      ) : null}
      <ul className="rp-card flex flex-col p-0">
        {GRANT_KEYS.map((key) => {
          const on = items[key];
          return (
            <li key={key} className="flex items-center justify-between gap-3 border-b border-hair px-4 py-3 last:border-b-0">
              <div className="min-w-0">
                <p className="text-body font-semibold" id={`grant-label-${key}`}>
                  {t(locale, `grant.${key}` as MessageKey)}
                </p>
                <p className="text-body text-ink-2">{ft(locale, `g.desc.${key}` as FamilyKey)}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-labelledby={`grant-label-${key}`}
                disabled={busy === key}
                onClick={() => void toggle(key)}
                data-testid={`grant-${key}`}
                data-on={on ? "true" : "false"}
                className="flex min-h-12 shrink-0 items-center gap-2 rounded-full px-1 py-1"
              >
                <span className={`relative inline-block h-8 w-14 rounded-full transition-colors ${on ? "bg-ink" : "bg-hair-2"}`} aria-hidden="true">
                  <span className={`absolute top-1 h-6 w-6 rounded-full bg-surface shadow transition-all ${on ? "left-7" : "left-1"}`} />
                </span>
                <span className="w-8 text-left text-body font-semibold">{t(locale, on ? "grant.on" : "grant.off")}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {error ? (
        <p className="text-body text-ink-2" role="status" data-testid="grant-error">
          {error}
        </p>
      ) : null}
    </section>
  );
}
