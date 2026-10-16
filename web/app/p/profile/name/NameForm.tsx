"use client";

/**
 * 「称呼」: one field (the draft's `f`: its name above, what is wrong in red under it), and at the foot 「不改了」 and the
 * filled 「改好了」 side by side (track C). PATCH /api/profile { name }, then back to 「我」.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Said } from "@/components/me/parts";
import { ButtonRow, PrimaryButton, SecondaryButton } from "@/components/ui/Buttons";
import { Field } from "@/components/ui/Forms";
import { ActionDock } from "@/components/ui/Screen";
import { sendJson } from "@/lib/profile/client";
import { meCopy, type CLocale } from "@/lib/profile/copy";

const MAX = 40;

export function NameForm({ locale, initial }: { locale: CLocale; initial: string }) {
  const c = meCopy(locale);
  const router = useRouter();
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  // what is wrong with the name is said under the field; a save that did not get through in a box of its own
  const [problem, setProblem] = useState<{ text: string; at: "field" | "screen" } | null>(null);

  async function submit() {
    if (busy) return;
    const words = name.trim();
    if (!words) return setProblem({ text: c.nameEmpty, at: "field" });
    if ([...words].length > MAX) return setProblem({ text: c.nameTooLong, at: "field" });
    setBusy(true);
    setProblem(null);
    const r = await sendJson("PATCH", "/api/profile", { name: words });
    if (!r.ok) {
      setBusy(false);
      return setProblem(r.data.error === "text_too_long" ? { text: c.nameTooLong, at: "field" } : r.data.error === "text_empty" ? { text: c.nameEmpty, at: "field" } : { text: c.failed, at: "screen" });
    }
    router.push("/p/me");
    router.refresh();
  }

  return (
    <form
      className="rpu"
      data-rp="name-form"
      style={{ display: "flex", flexDirection: "column", flex: 1 }}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="rpu-stack">
        <Field
          className="rpm-f"
          id="rpc-name"
          label={c.nameLabel}
          data-testid="me-name-input"
          value={name}
          placeholder={c.namePlaceholder}
          onChange={(e) => setName(e.target.value)}
          autoComplete="off"
          error={problem?.at === "field" ? <span data-rp="form-problem">{problem.text}</span> : undefined}
        />
        {problem?.at === "screen" && (
          <div data-rp="form-problem">
            <Said tone="problem">{problem.text}</Said>
          </div>
        )}
      </div>
      <ActionDock>
        <ButtonRow cols={2}>
          <SecondaryButton href="/p/me" nav="back">{c.cancel}</SecondaryButton>
          <PrimaryButton type="submit" pending={busy} disabled={!name.trim()} data-testid="me-name-save">
            {c.save}
          </PrimaryButton>
        </ButtonRow>
      </ActionDock>
    </form>
  );
}
