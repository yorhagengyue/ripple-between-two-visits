"use client";

/**
 * 「我 · 退出登录」 (real-app 2.23; track C), drawn as the timeline draft's 我-1 has it: a bordered button under the cards,
 * with one grey line saying what it does. The same rules as the button on 「登录和设备」 (track A's DevicesScreen): one tap
 * ends this phone's sign-in (POST /api/auth/logout { everywhere: false }) and goes where the server says (/login);
 * nothing asks "are you sure" (signing out is undone by signing in again); a refusal is said in words under it.
 * 「退出所有设备」 stays on 「登录和设备」.
 *
 * logoutThisPhone is the one place this button signs out: whatever else a sign-out has to do on the phone (other tracks:
 * clearing what the phone kept, dropping its push subscription) belongs in it as well as in DevicesScreen's logout.
 */
import { useState } from "react";
import { Box } from "@/components/ui/Box";
import { ButtonNote, SecondaryButton } from "@/components/ui/Buttons";
import { callAccount } from "@/lib/auth/client-api";
import { accountCopy, errorWords, type AccountLocale } from "@/lib/auth/copy";
import { meCopy } from "@/lib/profile/copy";
// C2 track I (added at integration): signing out takes this phone's push subscription away from him first
import { forgetPushOnSignOut } from "@/lib/push/client";
// C2 track O (added at integration): what this phone forgets at logout (real-app 2.25)
import { forgetThisPhone } from "@/lib/offline/forget";
import "@/components/me/me.css";

/** End this phone's sign-in. Returns where to go (the login page), or the refusal's code. */
export async function logoutThisPhone(): Promise<{ ok: true; next: string } | { ok: false; error: string }> {
  await forgetPushOnSignOut(false); // while his sign-in still counts; never throws (the same call as DevicesScreen's logout)
  const r = await callAccount<{ next: string }>("/api/auth/logout", { everywhere: false });
  if (!r.ok) return { ok: false, error: r.body.error ?? "unavailable" };
  await forgetThisPhone(); // the to-send list, recordings not uploaded, the page cache: only after the server confirmed
  return { ok: true, next: r.body.next || "/login" };
}

export function LogoutRow({ locale }: { locale: AccountLocale }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function logout() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await logoutThisPhone();
    if (!r.ok) {
      setBusy(false);
      return setError(errorWords(r.error, locale));
    }
    window.location.assign(r.next);
  }

  return (
    // the last of 「我」's entries (data-rp="me-entry"), though it is a button and not a row of a card
    <div className="rpu rpm-foot" data-rp="me-entry" data-entry="logout">
      <SecondaryButton pending={busy} onClick={() => void logout()} data-testid="me-logout">
        {accountCopy(locale).logout}
      </SecondaryButton>
      <ButtonNote>{meCopy(locale).logoutStatus}</ButtonNote>
      {error && (
        <Box variant="red">
          <span role="alert" data-testid="me-logout-error">
            {error}
          </span>
        </Box>
      )}
    </div>
  );
}
