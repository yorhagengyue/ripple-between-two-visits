/**
 * The owner's answer policy (owner 10-15: 「写在规则里面完全不好改，应该完全放开」): what Ripple's model may and may not say,
 * in plain words, in one file he can read and edit (answer-policy.md next to this file). Every prompt that words an answer
 * (general.ts: Ripple's own answer; crisis-words.ts: the 995 and self-harm answers) is that file plus a short output format
 * kept in code. Server-only (node:fs).
 *
 * The file is read again whenever it changes (its modification time), so an edit applies to the next question without a
 * restart. When it cannot be read, answerPolicy() is null and no model words an answer: the fixed sentences stand
 * (templates.ts), exactly as offline. Nothing here is a second copy of the rules.
 */
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { findWebRoot } from "@/lib/llm/root";

/** Where the policy lives, relative to web/. */
export const POLICY_FILE = path.join("lib", "safety", "policy", "answer-policy.md");

let cached: { file: string; mtimeMs: number; text: string } | null = null;

/** The policy file's path, or null when web/ cannot be found. */
export function policyPath(): string | null {
  const root = findWebRoot();
  return root ? path.join(root, POLICY_FILE) : null;
}

/** The policy as written (trimmed), or null when the file is missing or empty (the caller then uses its fixed sentences). */
export function answerPolicy(file: string | null = policyPath()): string | null {
  if (!file) return null;
  try {
    const { mtimeMs } = statSync(file);
    if (cached && cached.file === file && cached.mtimeMs === mtimeMs) return cached.text;
    const text = readFileSync(file, "utf8").trim();
    if (!text) return null;
    cached = { file, mtimeMs, text };
    return text;
  } catch (e) {
    console.error(`[policy] the answer policy could not be read (${(e as NodeJS.ErrnoException).code ?? "error"}); fixed sentences only`);
    return null;
  }
}
