"use client";

/**
 * 「填家人的账号」 (line bind): the direct way on 「邀请家人」, above the invitation. He types the account his family
 * member signed up with and 「绑定」 links the two at once (POST /api/family/bind, lib/care/bind.ts): she can see the
 * four items listed under the field, and he lands on his switches for her, those four on. His visit recordings and his
 * notes stay off until he turns them on himself.
 *
 * Drawn with the foundation's pieces as the invitation's own form is: a section title, the grey line, the field (a
 * refusal is said in red under it and changes nothing), the four items as a list with ticks, and the one solid button.
 * The invitation follows below as the second way (components/family/HisFamily InviteMaker).
 */
import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { BodyText, Field, ListCard, ListItem, PrimaryButton, SectionTitle } from "@/components/ui";
import { clockTime } from "@/lib/auth/copy";
import { bc, bindRefusal } from "@/lib/care/bind-copy";
import { switchTitle } from "@/lib/care/copy";
import type { Locale } from "@/lib/i18n";
import type { FamilyGrantItems } from "@/lib/store/types";
import "./his-family.css";
import "./his-bind.css";

/** The four items a directly bound link starts with (lib/care/bind.ts DIRECT_GRANTS), in the order of his switches. */
const FOUR: readonly (keyof FamilyGrantItems)[] = ["dose_summary", "bp_summary", "questions_count", "no_reply_alert"];

export function BindFamily({ locale }: { locale: Locale }) {
  const router = useRouter();
  const ids = useId();
  const [account, setAccount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const typed = account.trim();
    if (!typed) return setError(bc(locale, "hisEmpty"));
    setPending(true);
    let status = 0;
    let body: { next?: unknown; error?: string; until?: string } = {};
    try {
      const res = await fetch("/api/family/bind", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ account: typed }), credentials: "same-origin", cache: "no-store" });
      status = res.status;
      body = (await res.json().catch(() => ({}))) as typeof body;
    } catch {
      // offline: said below like any other failure
    }
    if (status === 200 && typeof body.next === "string" && body.next.startsWith("/p/family/")) {
      // his switches for her, the four on
      router.push(body.next);
      router.refresh();
      return;
    }
    setPending(false);
    setError(bindRefusal(locale, "patient", body.error, clockTime(body.until, locale)));
  }

  return (
    <form className="rpu-stack rphb-direct" noValidate onSubmit={submit} data-testid="bind-family">
      <SectionTitle>{bc(locale, "hisTitle")}</SectionTitle>
      <BodyText variant="lede">{bc(locale, "hisBody")}</BodyText>
      <Field
        id={`${ids}-account`}
        label={bc(locale, "hisField")}
        value={account}
        onChange={(e) => {
          setAccount(e.target.value);
          if (error) setError(null);
        }}
        error={error ? <span data-testid="bind-error">{error}</span> : undefined}
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        maxLength={254}
        data-testid="bind-account"
      />
      <ListCard testId="bind-four">
        {FOUR.map((k) => (
          <ListItem key={k} mark="ok" title={switchTitle(k, locale)} attrs={{ "data-item": k }} />
        ))}
      </ListCard>
      <PrimaryButton type="submit" pending={pending} data-testid="bind-submit">
        {bc(locale, "bind")}
      </PrimaryButton>
    </form>
  );
}
