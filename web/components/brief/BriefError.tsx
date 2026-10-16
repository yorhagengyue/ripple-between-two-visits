"use client";

/**
 * What /p/brief shows when an account's brief could not be put together (the timeline design's 通用-2: the screen's own
 * header, a box with the red border that says what happened and what still holds, 「再试一次」 and a way to Today). The
 * words are the app's fixed ones for a page that could not be read (lib/subject/unavailable.ts; real-app 2.25): never an
 * error's own text, never a page built from a guess.
 *
 * <BriefErrorBoundary> wraps the part of the page that reads his records (app/p/brief/page.tsx). It is Next's own
 * boundary (next/error catchError): 「再试一次」 asks the server for the page again, and a redirect thrown inside is not
 * caught here. Errors before that part (who the page is for) are the app's error screen's (app/error.tsx), as before.
 */
import { catchError, type ErrorInfo } from "next/error";
import { Box, PageHeader, PrimaryButton, Screen, SecondaryButton, TabBar } from "@/components/ui";
import type { Locale } from "@/lib/i18n";
import { STORE_UNAVAILABLE_WORDS } from "@/lib/subject/unavailable";
import { bt } from "@/lib/summary/i18n";

function BriefErrorScreen({ locale, doctor }: { locale: Locale; doctor: boolean }, { retry }: ErrorInfo) {
  const w = STORE_UNAVAILABLE_WORDS[locale];
  return (
    // his own page keeps its header and the tab bar; the page in the doctor's hands has neither
    <Screen locale={locale} tabBar={doctor ? undefined : <TabBar active="visit" locale={locale} />} tabBarPlacement="fixed">
      {doctor ? null : <PageHeader locale={locale} back={{ href: "/p/today" }} title={bt(locale, "brief.title")} />}
      <div className="rpu-stack" data-testid="brief-error" role="alert">
        <Box variant="red" title={w.title}>
          {w.body}
        </Box>
        <PrimaryButton onClick={() => retry()} data-testid="brief-error-retry">
          {w.retry}
        </PrimaryButton>
        <SecondaryButton href="/p/today">{bt(locale, "brief.err.today")}</SecondaryButton>
      </div>
    </Screen>
  );
}

export const BriefErrorBoundary = catchError(BriefErrorScreen);
