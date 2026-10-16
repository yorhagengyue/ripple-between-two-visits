"use client";

/**
 * 「我 → 登录和设备」 (docs/plan/real-app.md 2.3, 2.23; track A; laid out with the timeline draft's pieces by line
 * fe-me: the draft does not draw this screen): every device he signed in on as a row of one white card, this one first;
 * a sign-in still open on another device can be ended from its row (「退出这台」), and so can every sign-in at once
 * (「退出所有设备」, with one grey line saying what it does). 「退出登录」 ends this one. A second card links to a new
 * password and a new recovery code. Nothing here asks "are you sure": signing out is undone by signing in again.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { RememberLanguage } from "@/components/account/AccountUi";
import { Said } from "@/components/me/parts";
import { ActionDock, Box, Button, ButtonNote, ListCard, ListItem, PageHeader, Screen, SecondaryButton } from "@/components/ui";
import type { DeviceView } from "@/lib/auth/api";
import { callAccount } from "@/lib/auth/client-api";
import { accountCopy, dayAndTime, errorWords, type AccountLocale } from "@/lib/auth/copy";
import { meCopy } from "@/lib/profile/copy";
// C2 track I (only add): signing out takes this phone's push subscription away from him first
import { forgetPushOnSignOut } from "@/lib/push/client";
import { forgetThisPhone } from "@/lib/offline/forget"; // C2 track O: what this phone forgets at logout

export function DevicesScreen({
  locale,
  devices,
}: {
  locale: AccountLocale;
  devices: DeviceView[];
  /** not drawn any more (the language is under 「我 › 语言」); accepted so the page need not change */
  langHref?: string;
}) {
  const router = useRouter();
  const c = accountCopy(locale);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function signOutDevice(ref: string) {
    setBusy(ref);
    setError(null);
    const r = await callAccount<{ ended: number; current: boolean }>("/api/auth/devices/sign-out", { device: ref });
    setBusy(null);
    if (!r.ok) return setError(errorWords(r.body.error ?? "unavailable", locale));
    if (r.body.current) {
      await forgetThisPhone(); // track O: this phone's own sign-in ended
      return window.location.assign("/login");
    }
    router.refresh();
  }

  async function logout(everywhere: boolean) {
    setBusy(everywhere ? "all" : "this");
    setError(null);
    await forgetPushOnSignOut(everywhere); // C2 track I: while his sign-in still counts; never throws
    const r = await callAccount<{ next: string }>("/api/auth/logout", { everywhere });
    if (!r.ok) {
      setBusy(null);
      return setError(errorWords(r.body.error ?? "unavailable", locale));
    }
    await forgetThisPhone(); // track O: the to-send list, recordings not uploaded, the page cache (real-app 2.25)
    window.location.assign(r.body.next || "/login");
  }

  return (
    <Screen locale={locale} fill="viewport">
      <div data-testid="page-me-devices" style={{ display: "flex", flexDirection: "column", flex: 1 }}>
        <PageHeader locale={locale} back={{ href: "/p/me", label: meCopy(locale).me }} title={c.devicesTitle} />
        <RememberLanguage locale={locale} />
        <div className="rpu-stack">
          {devices.length === 0 ? (
            <div data-testid="device-list">
              <Box variant="dash" title={c.devicesNone} />
            </div>
          ) : (
            <ListCard heading={c.devicesLabel} testId="device-list">
              {devices.map((d) => (
                <div key={d.ref} className="rpu-li rpm-device" data-rp="list-item" data-testid="device-row" data-current={d.current ? "true" : undefined} data-signed-in={d.signed_in ? "true" : "false"}>
                  <span className="rpu-li-main">
                    <span className="rpu-li-t">{d.label ?? c.deviceUnknown}</span>
                    <span className="rpu-li-s">
                      {d.current ? c.deviceThis : d.signed_in ? c.deviceSignedIn(dayAndTime(d.last_seen_at, locale)) : c.deviceSignedOut(dayAndTime(d.last_seen_at, locale))}
                      {d.signed_in && d.ephemeral ? ` · ${c.deviceEphemeral}` : ""}
                    </span>
                  </span>
                  {!d.current && d.signed_in && (
                    <Button variant="small" className="rpm-li-action" onClick={() => void signOutDevice(d.ref)} pending={busy === d.ref} data-testid="device-sign-out">
                      {c.deviceSignOut}
                    </Button>
                  )}
                </div>
              ))}
            </ListCard>
          )}
          <ListCard>
            <ListItem href="/p/me/password" title={c.changePassword} chevron attrs={{ "data-rp": "row" }} />
            <ListItem href="/p/me/recovery" title={c.recoveryCode} chevron attrs={{ "data-rp": "row" }} />
          </ListCard>
          {error && (
            <Said tone="problem" testId="devices-error">
              {error}
            </Said>
          )}
        </div>
        <ActionDock>
          <SecondaryButton onClick={() => void logout(false)} pending={busy === "this"} data-testid="logout">
            {c.logout}
          </SecondaryButton>
          <div>
            <SecondaryButton onClick={() => void logout(true)} pending={busy === "all"} data-testid="logout-everywhere">
              {c.logoutAll}
            </SecondaryButton>
            <ButtonNote>{c.logoutAllNote}</ButtonNote>
          </div>
        </ActionDock>
      </div>
    </Screen>
  );
}
