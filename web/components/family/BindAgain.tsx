/**
 * Her way back to the form 「填长辈的账号」 (line bind, round two; the integrator, 2026-10-11): /f?bind=1 shows the form
 * whatever links she has (app/f/page.tsx). The quiet 「绑定另一位长辈」 stands on every screen that says a link of hers is
 * over (he stopped, she left, he said it was not her, the link is gone), wherever that screen is drawn: her page, her
 * home once its stream closed, and her other screens (FamilyApp, HerLive, AlertScreen). 「我的」 has the row
 * 「再绑定一位长辈」 with the same address. The form itself refuses an elder who removed her (lib/care/bind.ts).
 */
import { FamilyButton } from "@/components/family-ui";
import { bc } from "@/lib/care/bind-copy";
import type { Locale } from "@/lib/i18n";

/** The form's address for someone who already follows an elder, or did. */
export const BIND_AGAIN_HREF = "/f?bind=1";

export function BindAgainButton({ locale }: { locale: Locale }) {
  return (
    <FamilyButton href={BIND_AGAIN_HREF} variant="quiet" data-testid="ended-bind">
      {bc(locale, "bindAnother")}
    </FamilyButton>
  );
}
