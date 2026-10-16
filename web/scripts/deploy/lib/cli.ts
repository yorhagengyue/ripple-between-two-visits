/**
 * What every deploy script shares on the command line (C2 track P; docs/plan/hosting.md 6): the options, the three
 * modes, and an output that cannot print a value of the deploy file.
 *
 *   --dry-run   print the exact plan, touch nothing (no connection, no file written, no child process)
 *   --yes       act. Without it a script that changes anything remote prints the plan and stops (exit code 2)
 *   --deploy-file <path>   default web/.env.deploy   (the production settings; only these scripts read it)
 *   --test-env <path>      default web/.env          (the test project; read only to refuse a production value equal to it)
 *
 * An option a script does not know stops it: a mistyped --dry-run must never turn into a real run.
 *
 * Output: every line goes through Output.say, which replaces any value of the deploy file (and of the test file) by
 * its name in angle brackets, e.g. <SUPABASE_URL>. Commands are also built to be shown by name in the first place;
 * the replacement is the second line of defence.
 */

/** A refusal: the message is safe to print (names only) and the script exits with `code`. */
export class DeployError extends Error {
  constructor(
    message: string,
    readonly code = 2,
  ) {
    super(message);
    this.name = "DeployError";
  }
}

export interface ArgSpec {
  /** options without a value, e.g. "restore-prev" for --restore-prev */
  bool?: readonly string[];
  /** options with a value, e.g. "commit" for --commit <sha> or --commit=<sha> */
  value?: readonly string[];
}

export interface Args {
  positional: string[];
  bool(name: string): boolean;
  value(name: string): string | undefined;
}

const COMMON_BOOL = ["dry-run", "yes", "help"];
const COMMON_VALUE = ["deploy-file", "test-env"];

export function parseArgs(argv: readonly string[], spec: ArgSpec = {}): Args {
  const bools = new Set([...COMMON_BOOL, ...(spec.bool ?? [])]);
  const values = new Set([...COMMON_VALUE, ...(spec.value ?? [])]);
  const seenBool = new Set<string>();
  const seenValue = new Map<string, string>();
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "-h") {
      seenBool.add("help");
      continue;
    }
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = arg.slice(2, eq < 0 ? undefined : eq);
    if (bools.has(name)) {
      if (eq >= 0) throw new DeployError(`--${name} takes no value`);
      seenBool.add(name);
    } else if (values.has(name)) {
      const v = eq >= 0 ? arg.slice(eq + 1) : argv[++i];
      if (v === undefined || v === "" || (eq < 0 && v.startsWith("--"))) throw new DeployError(`--${name} needs a value`);
      if (seenValue.has(name)) throw new DeployError(`--${name} given twice`);
      seenValue.set(name, v);
    } else {
      throw new DeployError(`unknown option --${name} (nothing was done)`);
    }
  }
  return { positional, bool: (n) => seenBool.has(n), value: (n) => seenValue.get(n) };
}

export type Mode = "dry-run" | "refuse" | "act";

/** --dry-run wins over --yes; neither means the plan is printed and nothing is done. */
export function modeOf(args: Args): Mode {
  if (args.bool("dry-run")) return "dry-run";
  return args.bool("yes") ? "act" : "refuse";
}

/** values a deployment file may hold that are ordinary words, not worth hiding (and hiding them would garble the text) */
const ORDINARY = new Set(["ubuntu", "root", "mock", "true", "false", "supabase", "deepseek", "whisper", "memory", "local", "https", "judges", "commercial"]);
const MIN_HIDDEN = 5;

export class Output {
  readonly lines: string[] = [];
  /** [what to find, what to print instead]: a string is found anywhere, a pattern where it says */
  private hidden: Array<[string | RegExp, string]> = [];

  constructor(private readonly sink: (line: string) => void = (line) => console.log(line)) {}

  /**
   * From now on, any of these values is printed as its label. URL values also hide their host, user and password on
   * their own, so a connection string cut into pieces by an error message stays hidden. A short value (2 to 4
   * characters) is hidden where it stands as a word of its own; and the login user, even an ordinary one, is hidden
   * in front of an @ (ssh prints user@host in its errors).
   */
  hide(values: Record<string, string | undefined>, label: (name: string) => string = (name) => `<${name}>`): void {
    const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    for (const [name, raw] of Object.entries(values)) {
      const value = (raw ?? "").trim();
      if (name === "DEPLOY_USER" && value) this.hidden.push([new RegExp(`(?<![A-Za-z0-9_.-])${escape(value)}@`, "g"), `${label(name)}@`]);
      if (value.length < 2 || ORDINARY.has(value.toLowerCase())) continue;
      if (value.length < MIN_HIDDEN) {
        // a short number (a port) is not worth hiding and would garble every count in the output
        if (!/^\d+$/.test(value)) this.hidden.push([new RegExp(`(?<![A-Za-z0-9_])${escape(value)}(?![A-Za-z0-9_])`, "g"), label(name)]);
        continue;
      }
      this.hidden.push([value, label(name)]);
      try {
        const u = new URL(value);
        const parts = [u.host, u.hostname, u.username, u.password, safeDecode(u.username), safeDecode(u.password)];
        for (const part of parts) if (part.length >= MIN_HIDDEN && !ORDINARY.has(part.toLowerCase())) this.hidden.push([part, `${label(name).slice(0, -1)} part>`]);
        // a Supabase project reference on its own (<ref>.supabase.co, the pooler's user postgres.<ref>): error
        // messages name the project by it
        for (const piece of [...u.hostname.split("."), ...safeDecode(u.username).split(".")]) if (/^[a-z0-9]{15,40}$/.test(piece)) this.hidden.push([piece, `${label(name).slice(0, -1)} part>`]);
      } catch {
        // not a URL
      }
    }
    // longest first, so a value that contains another is replaced whole; patterns (short values) last
    const size = (m: string | RegExp) => (typeof m === "string" ? m.length : 0);
    this.hidden.sort((a, b) => size(b[0]) - size(a[0]));
  }

  /** The text with every hidden value replaced by its label. */
  clean(text: string): string {
    let out = text;
    for (const [match, label] of this.hidden) {
      if (typeof match === "string") {
        if (out.includes(match)) out = out.split(match).join(label);
      } else out = out.replace(match, label);
    }
    return out;
  }

  say(text = ""): void {
    for (const line of this.clean(text).split(/\r?\n/)) {
      this.lines.push(line);
      this.sink(line);
    }
  }

  /** Everything said so far, as one text (tests). */
  text(): string {
    return this.lines.join("\n");
  }
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** One step of a plan: what it does (shown as is) and how to do it (run only with --yes). */
export interface Step {
  /** one line: who or what is touched, in plain words */
  title: string;
  /** the exact commands or contents, by name: printed under the title in every mode */
  show?: string[];
  run?: () => Promise<void>;
}

/** Print a plan: numbered titles, the details indented under each. */
export function printPlan(out: Output, heading: string, steps: readonly Step[]): void {
  out.say(heading);
  steps.forEach((step, i) => {
    out.say(`  ${i + 1}. ${step.title}`);
    for (const line of step.show ?? []) out.say(`       ${line}`);
  });
}

/**
 * The three modes for a list of steps. Returns the exit code: 0 after a dry run or a completed run, 2 when --yes is
 * missing. A step that fails throws (DeployError for a refusal); the caller turns that into the exit code.
 */
export async function runPlan(out: Output, mode: Mode, heading: string, steps: readonly Step[]): Promise<number> {
  printPlan(out, heading, steps);
  if (mode === "dry-run") {
    out.say("Dry run: nothing was touched.");
    return 0;
  }
  if (mode === "refuse") {
    out.say("Nothing was done. Run it again with --yes to do the steps above, or with --dry-run to only see them.");
    return 2;
  }
  for (const [i, step] of steps.entries()) {
    if (!step.run) continue;
    out.say(`[${i + 1}/${steps.length}] ${step.title}`);
    await step.run();
  }
  return 0;
}

/** Run a script's main: refusals print their message and give their code; anything else is a crash without details. */
export async function guardMain(out: Output, main: () => Promise<number>): Promise<number> {
  try {
    return await main();
  } catch (err) {
    if (err instanceof DeployError) {
      out.say(`REFUSED: ${err.message}`);
      return err.code;
    }
    out.say(`FAILED: ${err instanceof Error ? err.message : "unexpected error"}`);
    return 1;
  }
}

/**
 * End the process with a script's exit code, without calling process.exit() while the script's last network request
 * is still closing its connection: on Windows Node then aborts with "Assertion failed: !(handle->flags &
 * UV_HANDLE_CLOSING)" and exit code 127, and a release that succeeded reports failure (seen 2026-10-11, the first
 * release that checked the public name). The code is set and the process is left to end by itself; a timer that does
 * not keep it alive ends it after five seconds if something still holds it open.
 */
export function finish(code: number): void {
  process.exitCode = code;
  setTimeout(() => process.exit(code), 5000).unref();
}

/** Was this file started directly (tsx scripts/deploy/<name>.ts), not imported by a test? */
export function startedAs(name: string): boolean {
  const entry = (process.argv[1] ?? "").replace(/\\/g, "/");
  return new RegExp(`/scripts/deploy/${name}\\.[cm]?[jt]s$`).test(entry);
}
