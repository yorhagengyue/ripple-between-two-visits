/**
 * The filming accounts on /director (C2 track J; journey 21; docs/plan/real-app.md 5.4 step 3). Track E renders it in
 * <div data-slot="filming-account"> for the crew only, with or without a demo session; it checks the crew's cookie again
 * itself, so it can never render for anyone else.
 *
 * It lists the accounts their owners marked as filming accounts on their own phones (lib/crew/filming-account.ts) and
 * gives each one the director's controls (FilmingAccountControls): lay it out to a scene, move its clock forward, pop the
 * reminder, simulate no reply, end filming. Every control is a call to app/api/crew/filming-account/accounts/[ref]; an
 * ordinary account is never listed and cannot be reached from here. Reading the list never fails the page: when it
 * cannot be read, the panel says so.
 *
 * ux pass 10-13: above the accounts, the story sheet (components/director/StorySheet): the story's own details go to
 * the client as plain data (lib/crew/story-edits.ts storySheetBase), and what the crew changes there is sent with every
 * "lay out".
 */
import { FILMING_D0, listFilmingAccounts, type FilmingAccountView } from "@/lib/crew/filming-account";
import { isCrewPage } from "@/lib/crew/gate";
import { storySheetBase } from "@/lib/crew/story-edits";
import { buildSeedTables } from "@/lib/story/seed";
import { FilmingAccountControls } from "./FilmingAccountControls";

export async function FilmingAccountPanel() {
  if (!(await isCrewPage())) return null;
  let accounts: FilmingAccountView[] | null = null;
  try {
    accounts = await listFilmingAccounts();
  } catch (err) {
    console.warn("[director] filming accounts unavailable", err instanceof Error ? err.message.slice(0, 160) : "");
  }
  const sheetBase = storySheetBase(buildSeedTables("story-sheet", `${FILMING_D0}T00:00:00.000Z`, "mr-tan"), FILMING_D0);
  return <FilmingAccountControls initial={accounts ?? []} unavailable={accounts === null} d0={FILMING_D0} sheetBase={sheetBase} />;
}
