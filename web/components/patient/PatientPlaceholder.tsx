/** Empty shell for a phone screen whose module has not been built yet (M0 builds every route). */
import type { ReactNode } from "react";
import { t, type Locale } from "@/lib/i18n";

export function PatientPlaceholder({
  locale,
  title,
  module,
  testId,
  children,
}: {
  locale: Locale;
  title: string;
  module: string;
  testId: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4" data-testid={testId}>
      <h1 className="text-[28px] font-bold">{title}</h1>
      {children}
      <div className="rp-card" data-testid="shell-placeholder">
        <p className="text-body text-ink-2">{t(locale, "shell.comingIn", { module })}</p>
      </div>
    </div>
  );
}
