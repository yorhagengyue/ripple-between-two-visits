/**
 * Supabase blob driver (BLOB_DRIVER=supabase): Supabase Storage REST API through fetch, no SDK.
 * Server-only: it uses SUPABASE_URL + SUPABASE_SERVICE_KEY from web/.env. The key goes into request
 * headers and nowhere else; errors carry only the operation, HTTP status and Storage's short error
 * code, never a key, a token or a signed URL.
 *
 * Endpoints (relative to <SUPABASE_URL>/storage/v1):
 *   POST   /object/<bucket>/<path>               upload (x-upsert: true)
 *   GET    /object/<bucket>/<path>               download
 *   POST   /object/upload/sign/<bucket>/<path>   signed upload link -> { url }, fixed 2 h lifetime
 *   POST   /object/sign/<bucket>/<path>          signed read link   -> { signedURL }
 *   POST   /object/list/<bucket>                 one folder level ({ prefix: "<folder>/" or "" for the top, limit,
 *                                                offset }); sub-folders come back with id null, files with updated_at
 *   DELETE /object/<bucket>                      { prefixes: [paths] }
 *   GET/POST/PUT /bucket[/<id>]                  bucket setup (scripts/setup-storage.ts)
 *
 * Signed upload links are not tied to a content type, so the buckets themselves carry
 * allowed_mime_types (audio: audio/wav; labels: png, jpeg, webp) and file_size_limit.
 */
import {
  BlobError,
  type BlobBucket,
  type BlobFileInfo,
  type BlobObject,
  type BlobStore,
  type BucketConfig,
  type SignedUpload,
} from "./types";
import {
  assertBucket,
  assertContentType,
  assertExtension,
  assertPath,
  checkWrite,
  clampExpiry,
  isPath,
  normalizePrefix,
} from "./validate";

/** Supabase fixes the lifetime of signed upload links (storage-api default). */
export const SUPABASE_UPLOAD_LINK_SECONDS = 2 * 3600;

export interface SupabaseBlobOptions {
  url: string;
  serviceKey: string;
  fetch?: typeof fetch;
  now?: () => number;
  /** how many entries one list call asks for (tests page through a small folder); default 1000 */
  listPage?: number;
}

/** SUPABASE_URL + SUPABASE_SERVICE_KEY, or null when either is missing. */
export function supabaseBlobConfig(
  env: Record<string, string | undefined> = process.env,
): { url: string; serviceKey: string } | null {
  const url = (env.SUPABASE_URL ?? "").trim();
  const serviceKey = (env.SUPABASE_SERVICE_KEY ?? "").trim();
  return url && serviceKey ? { url, serviceKey } : null;
}

interface ListItem {
  name: string;
  /** null for a sub-folder */
  id: string | null;
  updated_at?: string | null;
  created_at?: string | null;
  metadata?: { lastModified?: string | null } | null;
}

/** When a listed file was last written: updated_at, else the metadata's lastModified, else created_at; null when none parses. */
function lastModifiedOf(item: ListItem): number | null {
  for (const v of [item.updated_at, item.metadata?.lastModified, item.created_at]) {
    const ms = typeof v === "string" ? Date.parse(v) : NaN;
    if (Number.isFinite(ms)) return ms;
  }
  return null;
}

const LIST_PAGE = 1000;
const DELETE_BATCH = 1000;

const shortCode = (value: unknown): string =>
  String(value ?? "")
    .replace(/[^\w .:-]/g, "")
    .slice(0, 60);

export class SupabaseBlobStore implements BlobStore {
  readonly driver = "supabase" as const;
  private readonly base: string;
  private readonly key: string;
  private readonly fetchImpl: typeof fetch;
  private readonly listPage: number;

  constructor(private readonly opts: SupabaseBlobOptions) {
    if (!opts.url || !opts.serviceKey) throw new BlobError("not_configured", "SUPABASE_URL or SUPABASE_SERVICE_KEY not set");
    this.base = `${opts.url.replace(/\/+$/, "")}/storage/v1`;
    this.key = opts.serviceKey;
    this.fetchImpl = opts.fetch ?? fetch;
    this.listPage = opts.listPage && opts.listPage > 0 ? Math.floor(opts.listPage) : LIST_PAGE;
  }

  private now(): number {
    return this.opts.now ? this.opts.now() : Date.now();
  }

  private objectUrl(kind: string, bucket: BlobBucket, path: string): string {
    const encoded = assertPath(path).split("/").map(encodeURIComponent).join("/");
    return `${this.base}/${kind}${kind ? "/" : ""}${assertBucket(bucket)}/${encoded}`;
  }

  private async call(op: string, url: string, init: RequestInit & { headers?: Record<string, string> }): Promise<Response> {
    try {
      return await this.fetchImpl(url, {
        ...init,
        headers: { apikey: this.key, authorization: `Bearer ${this.key}`, ...(init.headers ?? {}) },
      });
    } catch {
      throw new BlobError("upstream", `Supabase Storage ${op}: network error`);
    }
  }

  /** Read Storage's error body (statusCode / error) without echoing anything sensitive. */
  private async problem(res: Response): Promise<{ status: number; code: string; notFound: boolean; bucketMissing: boolean }> {
    let code = "";
    let statusCode = "";
    try {
      // only the short `error` code: `message` is free text and is never echoed
      const body = (await res.json()) as { error?: unknown; statusCode?: unknown };
      code = shortCode(body.error);
      statusCode = shortCode(body.statusCode);
    } catch {
      /* not JSON */
    }
    const notFound = res.status === 404 || statusCode === "404" || /not.?found/i.test(code);
    return { status: res.status, code, notFound, bucketMissing: notFound && /bucket/i.test(code) };
  }

  private async fail(op: string, res: Response): Promise<never> {
    const p = await this.problem(res);
    if (p.bucketMissing) {
      throw new BlobError("not_configured", `Supabase Storage ${op}: bucket missing (run npx tsx scripts/setup-storage.ts)`);
    }
    if (p.notFound) throw new BlobError("not_found", `Supabase Storage ${op}: no such object`);
    if (p.status === 413 || /too.?large|maximum allowed size/i.test(p.code)) {
      throw new BlobError("too_large", `Supabase Storage ${op}: object too large`);
    }
    if (p.status === 415 || /mime|content.?type/i.test(p.code)) {
      throw new BlobError("unsupported_content_type", `Supabase Storage ${op}: content type not allowed by the bucket`);
    }
    throw new BlobError("upstream", `Supabase Storage ${op}: HTTP ${p.status}${p.code ? ` (${p.code})` : ""}`);
  }

  async putObject(bucket: BlobBucket, path: string, bytes: Uint8Array, contentType: string): Promise<void> {
    const ct = checkWrite(bucket, path, bytes, contentType);
    const res = await this.call("upload", this.objectUrl("object", bucket, path), {
      method: "POST",
      headers: { "content-type": ct, "x-upsert": "true", "cache-control": "max-age=3600" },
      body: bytes.slice(),
    });
    if (!res.ok) await this.fail("upload", res);
  }

  async getObject(bucket: BlobBucket, path: string): Promise<BlobObject | null> {
    const res = await this.call("download", this.objectUrl("object", bucket, path), { method: "GET" });
    if (!res.ok) {
      const p = await this.problem(res.clone());
      if (p.notFound && !p.bucketMissing) return null;
      await this.fail("download", res);
    }
    return {
      bytes: new Uint8Array(await res.arrayBuffer()),
      contentType: res.headers.get("content-type") ?? "application/octet-stream",
    };
  }

  async signedUploadUrl(bucket: BlobBucket, path: string, contentType: string, expiresSec: number): Promise<SignedUpload> {
    void expiresSec; // Supabase does not take a lifetime for upload links
    const ct = assertContentType(bucket, contentType);
    assertExtension(path, ct);
    const res = await this.call("sign upload", this.objectUrl("object/upload/sign", bucket, path), {
      method: "POST",
      headers: { "x-upsert": "true" },
    });
    if (!res.ok) await this.fail("sign upload", res);
    const body = (await res.json()) as { url?: string };
    if (!body.url || !body.url.startsWith("/")) throw new BlobError("upstream", "Supabase Storage sign upload: unexpected response");
    return {
      url: `${this.base}${body.url}`,
      method: "PUT",
      headers: { "content-type": ct, "x-upsert": "true" },
      expiresAt: new Date(this.now() + SUPABASE_UPLOAD_LINK_SECONDS * 1000).toISOString(),
    };
  }

  async signedReadUrl(bucket: BlobBucket, path: string, expiresSec: number): Promise<string> {
    const res = await this.call("sign read", this.objectUrl("object/sign", bucket, path), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expiresIn: clampExpiry(expiresSec) }),
    });
    if (!res.ok) await this.fail("sign read", res);
    const body = (await res.json()) as { signedURL?: string; signedUrl?: string };
    const rel = body.signedURL ?? body.signedUrl;
    if (!rel || !rel.startsWith("/")) throw new BlobError("upstream", "Supabase Storage sign read: unexpected response");
    return `${this.base}${rel}`;
  }

  /**
   * One folder level, every page of it (list is one level per call; `folder` "" is the bucket's top level). Pages are
   * asked for by offset in name order until one comes back short.
   */
  private async listLevel(bucket: BlobBucket, folder: string): Promise<ListItem[]> {
    const out: ListItem[] = [];
    for (let offset = 0; ; ) {
      const res = await this.call("list", `${this.base}/object/list/${bucket}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prefix: folder ? `${folder}/` : "", limit: this.listPage, offset, sortBy: { column: "name", order: "asc" } }),
      });
      if (!res.ok) await this.fail("list", res);
      const items = (await res.json().catch(() => null)) as ListItem[] | null;
      if (!Array.isArray(items)) throw new BlobError("upstream", "Supabase Storage list: unexpected response");
      for (const item of items) if (item?.name) out.push(item);
      if (items.length < this.listPage) break;
      offset += items.length;
    }
    return out;
  }

  /** Every object under "<folder>/", depth-first, as Storage names it (also a name this app would never write). */
  private async walk(bucket: BlobBucket, folder: string): Promise<{ path: string; item: ListItem }[]> {
    const out: { path: string; item: ListItem }[] = [];
    for (const item of await this.listLevel(bucket, folder)) {
      const full = `${folder}/${item.name}`;
      if (item.id === null) out.push(...(await this.walk(bucket, full)));
      else out.push({ path: full, item });
    }
    return out;
  }

  /** DELETE { prefixes: [exact object paths] } in batches; how many Storage says went. */
  private async removePaths(bucket: BlobBucket, files: readonly string[]): Promise<number> {
    let removed = 0;
    for (let i = 0; i < files.length; i += DELETE_BATCH) {
      const batch = files.slice(i, i + DELETE_BATCH);
      const res = await this.call("remove", `${this.base}/object/${bucket}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prefixes: batch }),
      });
      if (!res.ok) await this.fail("remove", res);
      const body = (await res.json().catch(() => null)) as unknown[] | null;
      removed += Array.isArray(body) ? body.length : batch.length;
    }
    return removed;
  }

  async removePrefix(bucket: BlobBucket, prefix: string): Promise<number> {
    assertBucket(bucket);
    const folder = normalizePrefix(prefix);
    return this.removePaths(bucket, (await this.walk(bucket, folder)).map((f) => f.path));
  }

  // ------------------------------------------------------------------ listing (C2 track H, only add)

  async listPrefixes(bucket: BlobBucket): Promise<string[]> {
    assertBucket(bucket);
    const names = (await this.listLevel(bucket, "")).filter((i) => i.id === null && isPath(i.name)).map((i) => i.name);
    return [...new Set(names)].sort();
  }

  async listFiles(bucket: BlobBucket, prefix: string): Promise<BlobFileInfo[]> {
    assertBucket(bucket);
    const seen = new Map<string, BlobFileInfo>();
    for (const f of await this.walk(bucket, normalizePrefix(prefix))) {
      // a name outside the path rules (the dashboard's ".emptyFolderPlaceholder") is no object of this app
      if (isPath(f.path)) seen.set(f.path, { path: f.path, lastModifiedMs: lastModifiedOf(f.item) });
    }
    return [...seen.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }

  async removeObjects(bucket: BlobBucket, paths: readonly string[]): Promise<number> {
    assertBucket(bucket);
    const files = [...new Set(paths.map((p) => assertPath(p)))];
    return files.length ? this.removePaths(bucket, files) : 0;
  }

  // ------------------------------------------------------------------ bucket setup

  /**
   * Create the bucket (private, with its content types and size cap) if missing; if it exists, make sure
   * it is private with the same settings. Returns which of the two happened.
   */
  async ensureBucket(cfg: BucketConfig): Promise<"created" | "exists"> {
    const settings = {
      public: false,
      file_size_limit: cfg.maxBytes,
      allowed_mime_types: [...cfg.contentTypes],
    };
    const got = await this.call("get bucket", `${this.base}/bucket/${cfg.id}`, { method: "GET" });
    if (got.ok) {
      const res = await this.call("update bucket", `${this.base}/bucket/${cfg.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!res.ok) await this.fail("update bucket", res);
      return "exists";
    }
    const p = await this.problem(got);
    if (!p.notFound) throw new BlobError("upstream", `Supabase Storage get bucket: HTTP ${p.status}${p.code ? ` (${p.code})` : ""}`);
    const res = await this.call("create bucket", `${this.base}/bucket`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: cfg.id, name: cfg.id, ...settings }),
    });
    if (!res.ok) await this.fail("create bucket", res);
    return "created";
  }

  /** The bucket's privacy flag, or null when it does not exist (live test and setup checks). */
  async bucketIsPublic(bucket: BlobBucket): Promise<boolean | null> {
    const res = await this.call("get bucket", `${this.base}/bucket/${assertBucket(bucket)}`, { method: "GET" });
    if (!res.ok) {
      const p = await this.problem(res);
      if (p.notFound) return null;
      throw new BlobError("upstream", `Supabase Storage get bucket: HTTP ${p.status}`);
    }
    return Boolean(((await res.json()) as { public?: boolean }).public);
  }
}

export function createSupabaseBlobStore(opts: SupabaseBlobOptions): SupabaseBlobStore {
  return new SupabaseBlobStore(opts);
}

