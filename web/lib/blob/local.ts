/**
 * Local blob driver (BLOB_DRIVER=local, the default): files under <dir>/<bucket>/<path>, where <dir> is
 * web/.data/blob unless BLOB_LOCAL_DIR says otherwise. Signed links point at our own routes:
 *   PUT /api/blob/upload?token=...   (app/api/blob/upload/route.ts -> acceptUpload)
 *   GET /api/blob/read?token=...     (app/api/blob/read/route.ts   -> readToken + getObject)
 * Links are same-origin paths; a caller that needs an absolute URL prepends the request origin.
 *
 * Works for one long-running server (next dev / next start on one machine). With several instances
 * the files and the random signing secret are not shared: set BLOB_DRIVER=supabase there.
 */
import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import nodePath from "node:path";
import { blobSigningSecret, signToken, verifyToken } from "./token";
import {
  BlobError,
  type BlobBucket,
  type BlobFileInfo,
  type BlobObject,
  type BlobStore,
  type SignedUpload,
} from "./types";
import {
  assertBucket,
  assertContentType,
  assertExtension,
  assertPath,
  baseContentType,
  checkWrite,
  clampExpiry,
  contentTypeForPath,
  isPath,
  normalizePrefix,
} from "./validate";

export const LOCAL_UPLOAD_ROUTE = "/api/blob/upload";
export const LOCAL_READ_ROUTE = "/api/blob/read";

export interface LocalBlobOptions {
  /** root folder; buckets are subfolders */
  dir: string;
  /** fixed secret (tests); default BLOB_SIGNING_SECRET or the per-process random secret */
  secret?: Buffer;
  /** clock in ms (tests) */
  now?: () => number;
}

const isMissing = (err: unknown): boolean => {
  const code = (err as NodeJS.ErrnoException)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
};

export class LocalBlobStore implements BlobStore {
  readonly driver = "local" as const;

  /** The store is cached on globalThis and this module can be bundled more than once: recognise it by its driver. */
  static [Symbol.hasInstance](value: unknown): boolean {
    if (typeof value !== "object" || value === null) return false;
    const s = value as { driver?: unknown; dir?: unknown };
    return s.driver === "local" && typeof s.dir === "string";
  }
  readonly dir: string;

  constructor(private readonly opts: LocalBlobOptions) {
    this.dir = nodePath.resolve(opts.dir);
  }

  private secret(): Buffer {
    return this.opts.secret ?? blobSigningSecret();
  }

  private now(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  /** Absolute file path for an object, guaranteed to stay inside the bucket folder. */
  private file(bucket: BlobBucket, path: string): string {
    const root = nodePath.join(this.dir, assertBucket(bucket));
    const full = nodePath.resolve(root, ...assertPath(path).split("/"));
    if (!full.startsWith(root + nodePath.sep)) throw new BlobError("invalid_path", "path leaves the bucket");
    return full;
  }

  async putObject(bucket: BlobBucket, path: string, bytes: Uint8Array, contentType: string): Promise<void> {
    checkWrite(bucket, path, bytes, contentType);
    const target = this.file(bucket, path);
    await fs.mkdir(nodePath.dirname(target), { recursive: true });
    // write then rename, so a reader never sees half a file
    const tmp = nodePath.join(nodePath.dirname(target), `.${nodePath.basename(target)}.${randomBytes(6).toString("hex")}.tmp`);
    await fs.writeFile(tmp, bytes);
    try {
      await fs.rename(tmp, target);
    } catch (err) {
      await fs.rm(tmp, { force: true });
      throw err;
    }
  }

  async getObject(bucket: BlobBucket, path: string): Promise<BlobObject | null> {
    const target = this.file(bucket, path);
    try {
      const buf = await fs.readFile(target);
      return {
        bytes: new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength),
        contentType: contentTypeForPath(path) ?? "application/octet-stream",
      };
    } catch (err) {
      if (isMissing(err) || (err as NodeJS.ErrnoException)?.code === "EISDIR") return null;
      throw err;
    }
  }

  async signedUploadUrl(bucket: BlobBucket, path: string, contentType: string, expiresSec: number): Promise<SignedUpload> {
    this.file(bucket, path);
    const ct = assertContentType(bucket, contentType);
    assertExtension(path, ct);
    const exp = Math.floor(this.now() / 1000) + clampExpiry(expiresSec);
    const token = signToken(this.secret(), { v: 1, op: "put", b: bucket, p: path, ct, exp });
    return {
      url: `${LOCAL_UPLOAD_ROUTE}?token=${token}`,
      method: "PUT",
      headers: { "content-type": ct },
      expiresAt: new Date(exp * 1000).toISOString(),
    };
  }

  async signedReadUrl(bucket: BlobBucket, path: string, expiresSec: number): Promise<string> {
    const target = this.file(bucket, path);
    const stat = await fs.stat(target).catch((err) => {
      if (isMissing(err)) return null;
      throw err;
    });
    if (!stat?.isFile()) throw new BlobError("not_found", "no such object");
    const exp = Math.floor(this.now() / 1000) + clampExpiry(expiresSec);
    return `${LOCAL_READ_ROUTE}?token=${signToken(this.secret(), { v: 1, op: "get", b: bucket, p: path, exp })}`;
  }

  async removePrefix(bucket: BlobBucket, prefix: string): Promise<number> {
    const folder = this.file(bucket, normalizePrefix(prefix));
    const stat = await fs.stat(folder).catch((err) => {
      if (isMissing(err)) return null;
      throw err;
    });
    if (!stat?.isDirectory()) return 0;
    const entries = await fs.readdir(folder, { recursive: true, withFileTypes: true });
    const count = entries.filter((e) => e.isFile() && !e.name.endsWith(".tmp")).length;
    await fs.rm(folder, { recursive: true, force: true });
    return count;
  }

  // ------------------------------------------------------------------ listing (C2 track H, only add)

  async listPrefixes(bucket: BlobBucket): Promise<string[]> {
    const root = nodePath.join(this.dir, assertBucket(bucket));
    try {
      const names = await fs.readdir(root, { withFileTypes: true });
      return names
        .filter((d) => d.isDirectory() && isPath(d.name))
        .map((d) => d.name)
        .sort();
    } catch (err) {
      if (isMissing(err)) return []; // the bucket folder is made by the first write
      throw err;
    }
  }

  async listFiles(bucket: BlobBucket, prefix: string): Promise<BlobFileInfo[]> {
    const rel = normalizePrefix(prefix);
    const out: BlobFileInfo[] = [];
    const walk = async (abs: string, relPath: string): Promise<void> => {
      let names: import("node:fs").Dirent[];
      try {
        names = await fs.readdir(abs, { withFileTypes: true });
      } catch (err) {
        if (isMissing(err)) return;
        throw err;
      }
      for (const d of names) {
        // putObject's half-written ".name.<random>.tmp" starts with a dot: not an object, and not a usable path
        if (!isPath(d.name)) continue;
        const childAbs = nodePath.join(abs, d.name);
        const childRel = `${relPath}/${d.name}`;
        if (d.isDirectory()) await walk(childAbs, childRel);
        else if (d.isFile()) {
          const stat = await fs.stat(childAbs).catch((err) => {
            if (isMissing(err)) return null; // removed while we were listing
            throw err;
          });
          if (stat && isPath(childRel)) out.push({ path: childRel, lastModifiedMs: Math.round(stat.mtimeMs) });
        }
      }
    };
    await walk(this.file(bucket, rel), rel);
    return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }

  async removeObjects(bucket: BlobBucket, paths: readonly string[]): Promise<number> {
    const root = nodePath.join(this.dir, assertBucket(bucket));
    let removed = 0;
    for (const p of paths) {
      const target = this.file(bucket, p);
      const stat = await fs.stat(target).catch((err) => {
        if (isMissing(err)) return null;
        throw err;
      });
      if (!stat?.isFile()) continue; // not there, or a folder: this call only takes whole object paths
      await fs.rm(target, { force: true });
      removed += 1;
      // a folder that held only this file goes with it (Supabase Storage has no empty folders either), up to the bucket
      for (let dir = nodePath.dirname(target); dir.startsWith(root + nodePath.sep); dir = nodePath.dirname(dir)) {
        try {
          await fs.rmdir(dir);
        } catch {
          break; // not empty (or just written to)
        }
      }
    }
    return removed;
  }

  // ------------------------------------------------------------------ used by the two local routes

  /**
   * PUT /api/blob/upload: the token must be a valid, unexpired upload token, and the request's
   * content-type must be the one the token was issued for (so a link issued for audio/wav cannot carry
   * audio/webm). The bytes are then checked like any server-side write.
   */
  async acceptUpload(
    token: string | null,
    contentTypeHeader: string | null,
    bytes: Uint8Array,
  ): Promise<{ bucket: BlobBucket; path: string; contentType: string; bytes: number }> {
    const payload = verifyToken(this.secret(), token, "put", this.now());
    const bucket = assertBucket(payload.b);
    const declared = baseContentType(contentTypeHeader);
    if (declared !== payload.ct) {
      // an unsupported type (audio/webm) reads as such; a supported but different type is a mismatch
      assertContentType(bucket, declared);
      throw new BlobError("content_mismatch", `this link is for ${payload.ct}`);
    }
    await this.putObject(bucket, payload.p, bytes, declared);
    return { bucket, path: payload.p, contentType: declared, bytes: bytes.byteLength };
  }

  /** GET /api/blob/read: which object a read token points at. */
  readToken(token: string | null): { bucket: BlobBucket; path: string } {
    const payload = verifyToken(this.secret(), token, "get", this.now());
    return { bucket: assertBucket(payload.b), path: assertPath(payload.p) };
  }
}

export function createLocalBlobStore(opts: LocalBlobOptions): LocalBlobStore {
  return new LocalBlobStore(opts);
}
