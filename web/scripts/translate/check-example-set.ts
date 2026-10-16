/**
 * The second check over the checked-in example translations (C2 track S, round 2; real-app 12; lib/translate/example-set.ts).
 *
 *   cd web && npx tsx --env-file=.env scripts/translate/check-example-set.ts            check what has no valid stamp yet
 *   cd web && npx tsx --env-file=.env scripts/translate/check-example-set.ts --all      check every line again
 *   cd web && npx tsx scripts/translate/check-example-set.ts --dry                      list what would be checked, call nothing
 *
 * web/fixtures/translations/example.zh.json holds one Chinese translation for each fixed English line the doctor and the
 * pharmacist say in the four sample visits. An example account shows a line only when both checks of lib/translate hold
 * for it. Check one (the same numbers, medicine names, units, frequencies and times, a negation kept) is deterministic and
 * is recomputed whenever the file is loaded. Check two needs the checker model, which the offline build that wrote the
 * file could not call: this script asks it, once per line, the same question the run-time path asks (lib/translate
 * checkMeaning: {"same": true} only, literally), and stamps the answer into the line: pass or not, the checker and its
 * model, the time, and a hash of the exact pair of texts it saw (editing either text voids the stamp).
 *
 * It needs the checker this deployment uses (web/.env: CHECKER_PROVIDER and its key; lib/llm createChecker). It refuses
 * to stamp with the offline mock or a replay cassette: those are not a check. Every call goes through the spend ledger
 * like any other paid call (about 30 short calls). A line the checker could not be reached for keeps no stamp and is
 * tried again next time; a line it says no to is stamped pass false and is never shown (fix the Chinese, run again).
 * Exit codes: 0 every line now holds both checks; 1 some line does not (listed); 2 no usable checker, or usage.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createChecker } from "@/lib/llm";
import { checkMeaning } from "@/lib/translate";
import { lineChecked, pairHash, type ExampleLine } from "@/lib/translate/example-set";
import { sameFacts } from "@/lib/translate/facts";

const FILE = path.resolve(__dirname, "..", "..", "fixtures", "translations", "example.zh.json");

interface SetFile {
  about: string;
  version: string;
  direction: string;
  lines: ExampleLine[];
}

async function main(): Promise<number> {
  const args = new Set(process.argv.slice(2));
  for (const a of args) {
    if (!["--all", "--dry"].includes(a)) {
      process.stderr.write("usage: npx tsx scripts/translate/check-example-set.ts [--all] [--dry]\n");
      return 2;
    }
  }
  const file = JSON.parse(readFileSync(FILE, "utf8")) as SetFile;
  const todo = file.lines.filter((l) => args.has("--all") || !l.meaning || l.meaning.pair !== pairHash(l.en, l.zh));
  const factsFailed = file.lines.filter((l) => !sameFacts(l.en, l.zh, "en>zh-Hans").pass);
  for (const l of factsFailed) process.stdout.write(`facts check fails: ${l.id} (${sameFacts(l.en, l.zh, "en>zh-Hans").reasons.join(", ")})\n`);
  process.stdout.write(`${file.lines.length} lines, ${file.lines.filter(lineChecked).length} hold both checks, ${todo.length} to send to the checker\n`);
  if (args.has("--dry")) {
    for (const l of todo) process.stdout.write(`  ${l.id}\n`);
    return factsFailed.length || todo.length ? 1 : 0;
  }

  if (todo.length) {
    const { client, reason } = createChecker();
    if (!client || client.provider === "mock" || client.provider.startsWith("replay")) {
      process.stderr.write(`no usable checker: ${reason ?? `${client?.provider ?? "none"} is not a check`}. Set CHECKER_PROVIDER and its key in web/.env.\n`);
      return 2;
    }
    for (const l of todo) {
      if (!sameFacts(l.en, l.zh, "en>zh-Hans").pass) {
        l.meaning = null;
        continue;
      }
      const same = await checkMeaning(client, "en>zh-Hans", l.en, l.zh);
      if (same === null) {
        process.stdout.write(`  ${l.id}: the checker could not be reached, no stamp\n`);
        l.meaning = null;
        continue;
      }
      l.meaning = { pass: same, checker: client.provider, model: client.model, at: new Date().toISOString(), pair: pairHash(l.en, l.zh) };
      process.stdout.write(`  ${l.id}: ${same ? "same meaning" : "NOT the same meaning"}\n`);
    }
    writeFileSync(FILE, `${JSON.stringify(file, null, 2)}\n`, "utf8");
  }

  const open = file.lines.filter((l) => !lineChecked(l));
  for (const l of open) process.stdout.write(`not shown: ${l.id}${l.meaning && !l.meaning.pass ? " (the checker said the meaning differs)" : ""}\n`);
  process.stdout.write(`${file.lines.length - open.length} of ${file.lines.length} lines hold both checks\n`);
  return open.length ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    process.stderr.write(`failed: ${err instanceof Error ? err.message.slice(0, 160) : "error"}\n`);
    process.exit(1);
  },
);
