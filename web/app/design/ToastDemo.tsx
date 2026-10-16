"use client";

import { useState } from "react";
import { PrimaryButton, UndoToast } from "@/components/ui";
import type { UiLocale } from "@/lib/ui/tokens";

/** A live undo bar in the gallery: tap the button, the bar runs its 12 s, 撤销 undoes. (e2e/ui-design.spec.ts drives it.) */
export function ToastDemo({ locale }: { locale: UiLocale }) {
  const [run, setRun] = useState(0);
  const [note, setNote] = useState("");
  const en = locale === "en";
  return (
    <div>
      <PrimaryButton
        data-testid={`toast-demo-${locale}`}
        onClick={() => {
          setRun((n) => n + 1);
          setNote("");
        }}
      >
        {en ? "Taken" : "吃了"}
      </PrimaryButton>
      <p className="rpd-demo-note" aria-live="polite">
        {note}
      </p>
      {run > 0 && (
        <UndoToast
          key={run}
          placement="inline"
          locale={locale}
          message={en ? "Logged: taken" : "已记下：吃了"}
          onUndo={() => setNote(en ? "Undone. Nothing was logged." : "撤销了，没有记。")}
          onExpire={() => setNote(en ? "Kept: taken." : "记好了：吃了。")}
        />
      )}
    </div>
  );
}
