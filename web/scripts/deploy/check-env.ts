/**
 * npx tsx scripts/deploy/check-env.ts [--speech mock|whisper|tencent] [--tts mock|trtc] [--create-secrets --yes]
 *
 * Reads the deploy file (web/.env.deploy) and says, by name only: what is there, what each step of a deployment still
 * needs, and what is malformed. It connects to nothing. Exit code 0 when no step is blocked by a malformed value or a
 * name problem (missing values are reported, they do not fail the check), 1 otherwise.
 *
 * --create-secrets --yes   creates the secrets this computer can make (the edge lock, the signing and account secrets,
 *                          the push key pair) and appends them to the deploy file, never showing them. Without --yes
 *                          it only says which it would create. An existing value is never replaced.
 *
 * C2 track P; docs/plan/hosting.md 5.5, 6.
 */
import { webRoot } from "@/lib/llm/root";
import { finish, guardMain, modeOf, Output, parseArgs, startedAs } from "./lib/cli";
import {
  BACKUP_NAMES,
  CREATABLE,
  createSecrets,
  DB_FOUR,
  type DeployContext,
  DOMAIN_NAMES,
  loadContext,
  missingCreatable,
  OWNER_ONLY,
  projectRefOfUrl,
  readEnvFile,
  refuseTestDatabase,
  sha8,
  shapeProblem,
  SSH_NAMES,
} from "./lib/deploy-file";

export interface Stage {
  name: string;
  needs: string[];
  /** said after the names: what cannot be read from the file */
  note?: string;
}

const SERVER = [...SSH_NAMES, ...DOMAIN_NAMES];

/** What each step reads from the deploy file. The two open decisions are switches here too. */
export function stages(speech: string | undefined, tts: string | undefined): Stage[] {
  const pushEnv = [...SERVER, "SUPABASE_URL", "SUPABASE_SERVICE_KEY", "SUPABASE_ANON_KEY", "RIPPLE_DEEPSEEK_API_KEY", "AUTH_USERNAME_DOMAIN", ...CREATABLE];
  if (speech === "whisper") pushEnv.push("WHISPER_URL", "WHISPER_TOKEN");
  if (speech === "tencent") pushEnv.push("TENCENT_SECRET_ID", "TENCENT_SECRET_KEY");
  if (tts === "trtc") pushEnv.push("TRTC_SDK_APP_ID", ...["TENCENT_SECRET_ID", "TENCENT_SECRET_KEY"].filter((n) => !pushEnv.includes(n)));
  return [
    { name: "provision", needs: SERVER },
    { name: "prod-db", needs: [...DB_FOUR] },
    { name: "push-secrets (edge lock)", needs: [...SERVER, "EDGE_SECRET"] },
    { name: "push-env", needs: pushEnv, note: speech && tts ? `for --speech ${speech} --tts ${tts}` : "also needs --speech and --tts: pass them here to see what each choice adds" },
    { name: "release", needs: [...SERVER, ...DB_FOUR] },
    { name: "edge-check", needs: [...DOMAIN_NAMES, "SUPABASE_URL", "SUPABASE_ANON_KEY"] },
    { name: "push-secrets (backup)", needs: [...SERVER, "SUPABASE_DB_URL", ...BACKUP_NAMES] },
    { name: "backup-verify", needs: ["BACKUP_AGE_RECIPIENT"], note: "and, on the owner's computer only, the private half of that key pair" },
    { name: "rollback, status", needs: SERVER },
  ];
}

export interface EnvCheck {
  present: string[];
  /** name → what is wrong with its shape */
  malformed: Record<string, string>;
  stages: Array<{ name: string; ready: boolean; missingOwner: string[]; missingCreatable: string[]; missingOther: string[]; malformed: string[]; note?: string }>;
}

export function checkEnv(ctx: DeployContext, speech?: string, tts?: string): EnvCheck {
  const v = ctx.deploy.values;
  const malformed: Record<string, string> = {};
  for (const name of Object.keys(v)) {
    const p = shapeProblem(name, v[name], v);
    if (p) malformed[name] = p;
  }
  const creatable = new Set<string>(missingCreatable(v));
  return {
    present: Object.keys(v).sort(),
    malformed,
    stages: stages(speech, tts).map((s) => {
      const missing = s.needs.filter((n) => !v[n]);
      const bad = s.needs.filter((n) => malformed[n]);
      return {
        name: s.name,
        ready: !missing.length && !bad.length,
        missingOwner: missing.filter((n) => OWNER_ONLY[n]),
        missingCreatable: missing.filter((n) => creatable.has(n)),
        missingOther: missing.filter((n) => !OWNER_ONLY[n] && !creatable.has(n)),
        malformed: bad,
        note: s.note,
      };
    }),
  };
}

export async function main(argv: readonly string[], out: Output, webDir: string = webRoot()): Promise<number> {
  return guardMain(out, async () => {
    const args = parseArgs(argv, { value: ["speech", "tts"], bool: ["create-secrets"] });
    if (args.bool("help")) {
      out.say("usage: npx tsx scripts/deploy/check-env.ts [--speech mock|whisper|tencent] [--tts mock|trtc] [--create-secrets --yes] [--deploy-file <path>] [--test-env <path>]");
      return 0;
    }
    const ctx = loadContext(args, webDir, out);

    if (args.bool("create-secrets")) {
      const wanted = missingCreatable(ctx.deploy.values);
      if (!wanted.length) out.say("create-secrets: nothing to create, every secret this computer can make is already in the deploy file.");
      else if (modeOf(args) !== "act") out.say(`create-secrets: would create and append to the deploy file: ${wanted.join(", ")}. Nothing was written (add --yes).`);
      else {
        const made = createSecrets(ctx.deploy);
        ctx.deploy = readEnvFile(ctx.deploy.path);
        out.hide(ctx.deploy.values);
        out.say(`create-secrets: created and appended to the deploy file (values not shown): ${made.join(", ")}.`);
        if (made.includes("EDGE_SECRET")) out.say("  EDGE_SECRET is the value the owner pastes into the EdgeOne rule (README, step 6): open the deploy file in an editor to copy it.");
      }
    }

    const result = checkEnv(ctx, args.value("speech"), args.value("tts"));
    out.say(`Deploy file: ${result.present.length} names with a value.`);
    out.say(`  set: ${result.present.join(", ") || "(none)"}`);
    const prodRef = ctx.deploy.values.SUPABASE_URL ? projectRefOfUrl(ctx.deploy.values.SUPABASE_URL) : null;
    if (prodRef) out.say(`  production project (sha256 of its reference, first 8): ${sha8(prodRef)}`);

    let failed = false;
    try {
      const note = refuseTestDatabase(ctx);
      out.say(note ? `  NOTE: ${note}` : "  the production project is not the test project of web/.env: ok");
    } catch (err) {
      failed = true;
      out.say(`  BAD: ${(err as Error).message}`);
    }
    const bad = Object.entries(result.malformed);
    if (bad.length) {
      failed = true;
      out.say("Malformed:");
      for (const [name, why] of bad) out.say(`  BAD  ${name} ${why}`);
    }

    out.say("What each step still needs:");
    for (const s of result.stages) {
      out.say(`  ${s.ready ? "ready  " : "blocked"}  ${s.name}${s.note ? `  (${s.note})` : ""}`);
      if (s.missingOwner.length) out.say(`             only the owner can supply: ${s.missingOwner.join(", ")}`);
      if (s.missingCreatable.length) out.say(`             created here on first use (or now: --create-secrets --yes): ${s.missingCreatable.join(", ")}`);
      if (s.missingOther.length) out.say(`             missing: ${s.missingOther.join(", ")}`);
      if (s.malformed.length) out.say(`             malformed: ${s.malformed.join(", ")}`);
    }
    const ownerNames = [...new Set(result.stages.flatMap((s) => s.missingOwner))];
    if (ownerNames.length) {
      out.say("Only the owner can supply:");
      for (const n of ownerNames) out.say(`  ${n}: ${OWNER_ONLY[n]}`);
    }
    return failed ? 1 : 0;
  });
}

if (startedAs("check-env")) {
  void main(process.argv.slice(2), new Output()).then(finish);
}
