/**
 * /onboard — where setting up starts, or picks up (journey 01; track C): the screen he is on
 * (settings.onboarding_step), or Today once he is set up. No sign-in: the sign-in page, back here after.
 * A demo session has nothing to set up: Today.
 */
import { redirect } from "next/navigation";
import { onboardHref } from "@/lib/profile/onboarding";
import { getPageSubject } from "@/lib/subject";

export const dynamic = "force-dynamic";

export default async function OnboardPage() {
  const ctx = await getPageSubject();
  if (!ctx) redirect(`/login?next=${encodeURIComponent("/onboard")}`);
  if (ctx.subject.kind !== "account" || ctx.subject.relation !== "self") redirect("/p/today");
  redirect(onboardHref(ctx.session));
}
