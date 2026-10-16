/**
 * The web/ folder (the package named "ripple-web"), wherever a process was started from. The spend ledger and the
 * cassettes live under it, so a script started from the repository root, from web/scripts, from web/ itself or from a
 * folder outside the repository shares one ledger (the US$ cap) and one cassette folder with `next dev` and the eval.
 * Server-only (node:fs).
 *
 * Search order: from the start folder upwards, a package.json named ripple-web, or a web/package.json named ripple-web
 * next to it (a process started from the repository root); then the same from this module's own folder upwards (a
 * script started outside the repository still runs this file from web/lib/llm). Fix round 1 (10-09): before, a process
 * started outside the repository fell back to its own working folder, so a live script run from there kept a fresh,
 * empty ledger and the 24 h cap started again from 0. Now findWebRoot() answers null when web/ cannot be found, and the
 * spend ledger refuses paid calls instead (lib/llm/spend.ts, "ledger_unavailable" no_web_root).
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const WEB_PACKAGE_NAME = "ripple-web";

function isWebRoot(dir: string): boolean {
  const file = path.join(dir, "package.json");
  if (!existsSync(file)) return false;
  try {
    return (JSON.parse(readFileSync(file, "utf8")) as { name?: unknown }).name === WEB_PACKAGE_NAME;
  } catch {
    return false;
  }
}

function searchUp(start: string): string | null {
  for (let dir = path.resolve(start); ; dir = path.dirname(dir)) {
    if (isWebRoot(dir)) return dir;
    if (isWebRoot(path.join(dir, "web"))) return path.join(dir, "web");
    if (path.dirname(dir) === dir) return null;
  }
}

/** This module's own folder (ESM: import.meta.url; CommonJS, as tsx runs the scripts: __filename), or null. */
export function moduleDir(): string | null {
  try {
    const url = (import.meta as { url?: unknown }).url;
    if (typeof url === "string" && url.startsWith("file:")) return path.dirname(fileURLToPath(url));
  } catch {
    // not an ES module
  }
  try {
    if (typeof __filename === "string" && __filename) return path.dirname(__filename);
  } catch {
    // not CommonJS either
  }
  return null;
}

const cache = new Map<string, string | null>();

/**
 * The web/ folder for a start folder (default: the process's working folder), else the one above this module, else
 * null. `fromModule` is for tests (null: do not look from the module's folder).
 */
export function findWebRoot(start: string = process.cwd(), fromModule: string | null = moduleDir()): string | null {
  const key = `${path.resolve(start)}|${fromModule ?? ""}`;
  if (cache.has(key)) return cache.get(key)!;
  const found = searchUp(start) ?? (fromModule ? searchUp(fromModule) : null);
  cache.set(key, found);
  return found;
}

/**
 * The web/ folder (findWebRoot), or the start folder itself when there is none (for paths that only read: the cassette
 * folder, the .env the key check reports on). The spend ledger uses findWebRoot and fails closed instead.
 */
export function webRoot(start: string = process.cwd()): string {
  return findWebRoot(start) ?? path.resolve(start);
}
