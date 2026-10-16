/**
 * The not-found page (front-end line fe-12; real-app 2.25 line 351 「不是他的东西：他的路上只有他自己的范围，404，不说存不
 * 存在」). One page for every address that cannot be opened: one that never existed, and a visit, a medicine or a family
 * link that is someone else's (the pages call notFound() for both, and so does the crew's door for anyone who is not
 * the crew). So it says one plain sentence, the same for all of them, and names nothing of what was asked for: no
 * address, no id, no "does not exist", no code, no apology. The answer is still 404.
 *
 * Then what he can do next, one button:
 *   his own account, or a phone in a demo session   「回到今天」 to /p/today
 *   a family member with no space of her own         「回到首页」 to /f, her home
 *   nobody signed in                                 「回到首页」 to the front door
 *
 * A root not-found file is drawn inside the root layout only (Next.js 16; node_modules/next/dist/docs/01-app/
 * 03-api-reference/03-file-conventions/not-found.md): no tab bar, no account header, none of /p's providers; so it is
 * a whole screen of its own. His, and a visitor's, in the elder design's pieces; a family member's in her own dark look
 * (components/family-ui: the one large sentence and her solid button), because every other screen she has is that one.
 * Language as the rest of the app reads it: a signed-in person's rp_lang cookie (else 华语), a visitor's cookie, then
 * the browser's languages (lib/auth/page-locale.ts). If the store cannot be read while it looks who is asking, it does
 * not guess: the button leads to the front door.
 *
 * Test hooks: not-found (the screen; lang), not-found-way (data-way "today" | "family" | "front", data-look "elder" |
 * "family"), not-found-words, not-found-on.
 */
import { unstable_rethrow } from "next/navigation";
import { FamilyButton, FamilyDock, FamilyHero, FamilyScreen, FamilyTop } from "@/components/family-ui";
import { Box, PageHeader, PrimaryButton, Screen } from "@/components/ui";
import { siteWords } from "@/components/site/copy";
import { pageLocale } from "@/lib/auth/page-locale";
import { getPatientLocale } from "@/lib/session/server";
import { getPageSubject } from "@/lib/subject";
import { signedInWithoutSpace } from "@/lib/subject/account";

// No `metadata` here on purpose: the tab's title is then the app's own (app/layout.tsx) for an address that matches no
// page and for a page that called notFound() alike. A title of its own would apply to the first kind only, and the
// crew's doors would be told from an address that leads nowhere by their tab.

type Way = "today" | "family" | "front";

/** Who is asking, as far as the way on needs it. A read that fails is not an answer: the front door. */
async function wayOn(): Promise<Way> {
  try {
    if (await getPageSubject()) return "today";
    if (await signedInWithoutSpace()) return "family";
  } catch (err) {
    // the framework's own signals are not answers of ours (reading the cookies is how it learns this page is per request)
    unstable_rethrow(err);
    // the store or the identity provider did not answer: the front door says so itself when he gets there
  }
  return "front";
}

const HREF: Record<Way, string> = { today: "/p/today", family: "/f", front: "/" };

export default async function NotFound() {
  const way = await wayOn();
  const locale = way === "front" ? await pageLocale() : await getPatientLocale();
  const w = siteWords(locale);
  if (way === "family") {
    return (
      // the two hooks stand around her screen without a box of their own, so her screen's own layout is untouched
      <div className="contents" lang={locale} data-testid="not-found">
        <div className="contents" data-way={way} data-look="family" data-testid="not-found-way">
          <FamilyScreen locale={locale}>
            <FamilyTop brand locale={locale} />
            <FamilyHero tone="quiet" title={<span data-testid="not-found-words">{w.notFound}</span>} />
            <FamilyDock foot="e">
              <FamilyButton href={HREF[way]} data-testid="not-found-on">
                {w.toFront}
              </FamilyButton>
            </FamilyDock>
          </FamilyScreen>
        </div>
      </div>
    );
  }
  return (
    <Screen locale={locale} foot="plain" data-testid="not-found">
      <PageHeader title={<span translate="no">Ripple</span>} locale={locale} />
      <div className="rpu-stack" data-way={way} data-look="elder" data-testid="not-found-way">
        <Box variant="line" title={w.notFound} testId="not-found-words" />
        <PrimaryButton href={HREF[way]} data-testid="not-found-on">
          {way === "today" ? w.backToToday : w.toFront}
        </PrimaryButton>
      </div>
    </Screen>
  );
}
