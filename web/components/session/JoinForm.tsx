"use client";

/**
 * /join: enter the join code shown on the director screen and pick what this device is (no role is pre-selected: the
 * button stays off until one is chosen).
 * POST /api/session/join sets the cookies; then a full page load opens the role's home page.
 * (QR scanning needs a library; see web/PROGRESS.md "needed deps". The URL /join?code=XXXXXX
 * pre-fills the code, so a QR made elsewhere can point at it.)
 *
 * A refused join says why, from the API's error code (joinErrorMessage below; 10-10): a wrong or expired code, Mr
 * Tan's phone already in the session, the film crew's key, a judge's sandbox, Wei Ling's phone, a device not in the
 * session, member rows that cannot be read. Anything else keeps the general "could not join". The words live here
 * until lib/i18n takes them (the designer's pass on this page); the rules behind them are lib/family/join.ts.
 */
import { useState } from "react";
import { t, type Locale, type MessageKey } from "@/lib/i18n";

const ROLES: { role: "patient" | "family" | "backstage" | "director"; key: MessageKey }[] = [
  { role: "patient", key: "role.patient" },
  { role: "family", key: "role.family" },
  { role: "backstage", key: "role.backstage" },
  { role: "director", key: "role.director" },
];

/** Why POST /api/session/join refused, grouped by what the person can do about it. */
export type JoinFailure =
  | "code"
  | "patient_exists"
  | "crew_key_required"
  | "crew_key_wrong"
  | "crew_key_attempts"
  | "role_not_joinable"
  | "patient_only"
  | "member_required"
  | "role_unavailable"
  | "other";

/**
 * The refusal behind an answer of the join route (lib/family/join.ts, its crew key check lib/session/crew-key.ts) or
 * of the proxy gate in front of it (lib/family/gate.ts, lib/family/role.ts). Pure.
 *   404 join_code_not_found: no live session has the code (a wrong code, or its session ended: an expired sandbox is
 *   not found by its code); 400 invalid_body: a code shorter than 4 characters.
 */
export function joinFailure(status: number, error: unknown): JoinFailure {
  const code = typeof error === "string" ? error : "";
  switch (code) {
    case "join_code_not_found":
    case "invalid_body":
      return "code";
    case "patient_exists":
    case "crew_key_required":
    case "crew_key_wrong":
    case "crew_key_attempts":
    case "role_not_joinable":
    case "patient_only":
    case "member_required":
    case "role_unavailable":
      return code;
  }
  return status === 404 ? "code" : "other";
}

/** Each refusal in his (zh-Hans) and the crew's (en) words. "other" is the general lib/i18n join.failed. */
const FAILURE_WORDS: Record<Locale, Record<Exclude<JoinFailure, "other">, string>> = {
  en: {
    code: "Check the letters, or ask for a new code: a code stops working when its session ends.",
    patient_exists: "This session already has Mr Tan's phone, and the code cannot add a second phone as him. Choose another role; a different phone for Mr Tan needs a new session.",
    crew_key_required: "Joining as the director or backstage needs the film crew's key. Enter it once in this browser at /backstage/crew, then join again.",
    crew_key_wrong: "The film crew's key in this browser is not the current one. Enter it again at /backstage/crew, then join again.",
    crew_key_attempts: "Too many wrong crew keys were tried from this network. Wait 10 minutes, then try again.",
    role_not_joinable: "A judge's sandbox opens from the judge's link; it cannot be joined with a code.",
    patient_only: "This phone is already Wei Ling's, so it can join as family only.",
    member_required: "This device is not in this session yet. Check the code and join again.",
    role_unavailable: "Could not check this session's devices just now. Try again in a moment.",
  },
  "zh-Hans": {
    code: "请核对一下字母和数字，或者要一个新的加入码：场次结束以后，码就不能用了。",
    patient_exists: "这个场次已经有陈先生的手机了，加入码不能再把另一台手机当成他。请选别的身份；陈先生换手机，要开一个新场次。",
    crew_key_required: "以导演或后台身份加入，要拍摄组口令。先在这个浏览器上打开 /backstage/crew 输一次口令，再加入。",
    crew_key_wrong: "这个浏览器上的拍摄组口令不是现在用的那个。请到 /backstage/crew 重新输入，再加入。",
    crew_key_attempts: "这个网络输错拍摄组口令的次数太多了。请等 10 分钟再试。",
    role_not_joinable: "评委的沙盒从评委链接打开，不能用加入码加入。",
    patient_only: "这台手机已经是女儿 Wei Ling 的，只能以家属身份加入。",
    member_required: "这台设备还不在这个场次里。请核对加入码，再加入一次。",
    role_unavailable: "现在查不到这个场次里的设备，请稍后再试。",
  },
};

/** Under the button while no role is chosen yet (the button stays off until one is). */
const CHOOSE_FIRST: Record<Locale, string> = { en: "Choose who this device is first.", "zh-Hans": "先选这台设备是谁的。" };

/** What the join page says for this answer of POST /api/session/join (status and its `error` code). */
export function joinErrorMessage(locale: Locale, status: number, error: unknown): string {
  const why = joinFailure(status, error);
  if (why === "other") return t(locale, "join.failed");
  const words = FAILURE_WORDS[locale][why];
  // a wrong or expired code starts with the page's own "no session has this code"
  if (why !== "code") return words;
  return locale === "en" ? `${t(locale, "join.notFound")} ${words}` : `${t(locale, "join.notFound")}${words}`;
}

export function JoinForm({ locale, initialCode }: { locale: Locale; initialCode: string }) {
  const [code, setCode] = useState(initialCode.toUpperCase());
  // no role is chosen for him (real-app 2.20, 5.2: 「加入页默认勾『陈先生』」): the device says who it is before it joins
  const [role, setRole] = useState<(typeof ROLES)[number]["role"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!role) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/session/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim(), role }),
        credentials: "same-origin",
      });
      const data = (await res.json().catch(() => ({}))) as { next?: string; error?: unknown };
      if (res.ok && data.next) window.location.assign(data.next);
      else setError(joinErrorMessage(locale, res.status, data.error));
    } catch {
      setError(joinErrorMessage(locale, 0, null));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="mt-6 flex flex-col gap-5"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      data-testid="join-form"
    >
      <label className="flex flex-col gap-2 text-body font-semibold">
        {t(locale, "join.code")}
        <input
          className="rounded-2xl border border-hair-2 bg-surface px-4 py-3 font-mono text-[28px] uppercase tracking-[0.2em]"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          autoComplete="off"
          autoCapitalize="characters"
          inputMode="text"
          maxLength={12}
          required
          data-testid="join-code-input"
        />
      </label>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-body font-semibold">{t(locale, "join.role")}</legend>
        {ROLES.map((r) => (
          <label
            key={r.role}
            className={`flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border px-4 text-body ${
              role === r.role ? "border-ink/40 bg-surface font-semibold" : "border-hair bg-surface"
            }`}
          >
            <input
              type="radio"
              name="role"
              value={r.role}
              checked={role === r.role}
              onChange={() => setRole(r.role)}
              required
              className="h-5 w-5"
              data-testid={`join-role-${r.role}`}
            />
            {t(locale, r.key)}
          </label>
        ))}
      </fieldset>
      {error ? (
        <p className="text-body font-semibold" role="alert" data-testid="join-error">
          {error}
        </p>
      ) : null}
      <button type="submit" className="rp-btn rp-btn-accent min-h-14 text-body" disabled={busy || !role} aria-describedby={role ? undefined : "join-role-first"} data-testid="join-submit">
        {t(locale, "join.submit")}
      </button>
      {role ? null : (
        <p className="text-body text-ink-2" id="join-role-first" data-testid="join-role-first">
          {CHOOSE_FIRST[locale]}
        </p>
      )}
    </form>
  );
}
