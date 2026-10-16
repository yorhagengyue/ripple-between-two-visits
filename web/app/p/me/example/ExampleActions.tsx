"use client";

/**
 * The example account's two buttons (real-app 4.7; track C; the timeline draft's 22-3): 「重新铺一遍示例资料」 and 「清空，
 * 从我自己的开始」 (outlined in red: it deletes). One tap does it (no confirm dialog; the grey line under each button says
 * what goes), then his phone goes to Today, or to setting up.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { P, Said } from "@/components/me/parts";
import { Button, ButtonNote, PrimaryButton, SecondaryButton } from "@/components/ui/Buttons";
import { ActionDock } from "@/components/ui/Screen";
import { sendJson } from "@/lib/profile/client";
import { exampleCopy, type CLocale } from "@/lib/profile/copy";

/**
 * `only`: the screen of one action (/p/me/example?do=…; 「我」 no longer has a row to it, owner's tidy of 10-13): what
 * it does as the screen's sentence, its button at the foot, and 「不动它」 back to 「我」.
 */
export function ExampleActions({ locale, only = null }: { locale: CLocale; only?: "reseed" | "clear" | null }) {
  const c = exampleCopy(locale);
  const router = useRouter();
  const [busy, setBusy] = useState<null | "reseed" | "clear">(null);
  const [failed, setFailed] = useState(false);

  async function run(action: "reseed" | "clear") {
    if (busy) return;
    setBusy(action);
    setFailed(false);
    const r = await sendJson<{ href: string }>("POST", "/api/me/example", { action });
    if (!r.ok) {
      setBusy(null);
      setFailed(true);
      return;
    }
    router.push(r.data.href);
    router.refresh();
  }

  const problem = failed ? <Said tone="problem">{c.failed}</Said> : null;

  if (only) {
    return (
      <div className="rpu" data-rp="example-actions" data-only={only} style={{ display: "flex", flexDirection: "column", flex: 1 }}>
        <div className="rpu-stack">
          <P size="large">{only === "reseed" ? c.reseedHint : c.clearHint}</P>
          {problem}
        </div>
        <ActionDock>
          {only === "reseed" ? (
            <PrimaryButton pending={busy === only} disabled={busy !== null} data-action="example-reseed" onClick={() => void run(only)}>
              {busy === only ? c.working : c.reseed}
            </PrimaryButton>
          ) : (
            <Button variant="danger-outline" pending={busy === only} disabled={busy !== null} data-action="example-clear" onClick={() => void run(only)}>
              {busy === only ? c.working : c.clear}
            </Button>
          )}
          <SecondaryButton href="/p/me" nav="back">{c.keep}</SecondaryButton>
        </ActionDock>
      </div>
    );
  }

  return (
    <div className="rpu rpu-stack" data-rp="example-actions">
      <div>
        <SecondaryButton pending={busy === "reseed"} disabled={busy !== null} data-action="example-reseed" onClick={() => void run("reseed")}>
          {busy === "reseed" ? c.working : c.reseed}
        </SecondaryButton>
        <ButtonNote>{c.reseedHint}</ButtonNote>
      </div>
      <div>
        <Button variant="danger-outline" pending={busy === "clear"} disabled={busy !== null} data-action="example-clear" onClick={() => void run("clear")}>
          {busy === "clear" ? c.working : c.clear}
        </Button>
        <ButtonNote>{c.clearHint}</ButtonNote>
      </div>
      {problem}
    </div>
  );
}
