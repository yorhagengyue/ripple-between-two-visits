/**
 * Recovery codes (docs/plan/real-app.md 2.4, 3.6). Server-only.
 *
 *   the code      12 symbols from a 32-symbol alphabet without 0, O, 1 and I (no look-alikes), shown as XXXX-XXXX-XXXX:
 *                 60 bits, from the system's random source; shown once, never stored
 *   the hash      salted scrypt (lib/auth/memory.ts hashPassword) of RECOVERY_PEPPER + the code, compared in constant
 *                 time; one per account (account_recovery), replaced when it is used or made again
 *   what he types spaces, dashes and lower case are fine; anything that cannot be a code still costs a hash comparison,
 *                 so the answer time says nothing
 */
import { randomBytes } from "node:crypto";
import type { Env } from "@/lib/dev/enabled";
import { hashPassword, verifyPassword } from "./memory";
import { formatRecoveryCode, normalizeRecoveryCode, RECOVERY_ALPHABET, RECOVERY_CODE_LENGTH } from "./recovery-code";
import { authSecret } from "./secrets";

export { formatRecoveryCode, normalizeRecoveryCode, RECOVERY_ALPHABET, RECOVERY_CODE_LENGTH };

/** A new code, formatted "XXXX-XXXX-XXXX". 256 is a multiple of 32, so every symbol is equally likely. */
export function newRecoveryCode(): string {
  const bytes = randomBytes(RECOVERY_CODE_LENGTH);
  let raw = "";
  for (const b of bytes) raw += RECOVERY_ALPHABET[b & 31];
  return formatRecoveryCode(raw);
}

function peppered(code12: string, env: Env): string {
  return `${authSecret("RECOVERY_PEPPER", env)}:${code12}`;
}

/** The stored form of a code (a formatted or typed code is normalised first). */
export async function hashRecoveryCode(code: string, env: Env = process.env): Promise<string> {
  const n = normalizeRecoveryCode(code);
  if (!n) throw new Error("not a recovery code");
  return hashPassword(peppered(n, env));
}

let dummy: Promise<string> | null = null;

/** Does what he typed match the stored hash? Always does one hash comparison (no hint from the time it takes). */
export async function recoveryCodeMatches(input: string, storedHash: string | null | undefined, env: Env = process.env): Promise<boolean> {
  const n = normalizeRecoveryCode(input);
  dummy ??= hashPassword(peppered(RECOVERY_ALPHABET.slice(0, RECOVERY_CODE_LENGTH), env));
  const target = n && storedHash ? storedHash : await dummy;
  const ok = await verifyPassword(peppered(n ?? RECOVERY_ALPHABET.slice(-RECOVERY_CODE_LENGTH), env), target);
  return ok && !!n && !!storedHash;
}
