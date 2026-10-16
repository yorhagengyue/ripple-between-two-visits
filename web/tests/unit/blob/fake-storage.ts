/**
 * An in-memory stand-in for the part of Supabase Storage's REST API the driver uses (lib/blob/supabase.ts), served
 * through a fetch function: upload, download, signed links, one-level listing with limit / offset in name order
 * (a sub-folder comes back with id null, a file with updated_at), and delete by exact paths. C2 track H's tests run
 * the driver's listing and the orphan sweep against it; the real service is covered by supabase.live.test.ts.
 *
 *   const storage = new FakeStorage();
 *   const blob = createSupabaseBlobStore({ url: FAKE_STORAGE_URL, serviceKey: "k", fetch: storage.fetch });
 *   storage.touch("audio", "a/b.wav", Date.now() - 3 * 86_400_000);   // make a file look three days old
 */
import { randomUUID } from "node:crypto";

export const FAKE_STORAGE_URL = "https://proj.supabase.test";

interface Stored {
  id: string;
  bytes: Uint8Array;
  contentType: string;
  createdMs: number;
  updatedMs: number;
  /** leave every time field out of the listing (a file the service cannot date) */
  undated?: boolean;
}

export interface FakeStorageCall {
  method: string;
  /** path after /storage/v1 */
  path: string;
  body: unknown;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const notFound = (what: "object" | "bucket") =>
  json(what === "bucket" ? { statusCode: "404", error: "Bucket not found", message: "Bucket not found" } : { statusCode: "404", error: "not_found", message: "Object not found" }, 400);

export class FakeStorage {
  readonly calls: FakeStorageCall[] = [];
  private readonly buckets = new Map<string, Map<string, Stored>>();
  private readonly now: () => number;

  constructor(opts: { buckets?: string[]; now?: () => number } = {}) {
    for (const b of opts.buckets ?? ["audio", "labels"]) this.buckets.set(b, new Map());
    this.now = opts.now ?? (() => Date.now());
  }

  /** Put an object in directly (also a name the app would never write). */
  seed(bucket: string, path: string, opts: { updatedMs?: number; undated?: boolean } = {}): void {
    const t = opts.updatedMs ?? this.now();
    this.buckets.get(bucket)!.set(path, { id: randomUUID(), bytes: new Uint8Array([1]), contentType: "application/octet-stream", createdMs: t, updatedMs: t, undated: opts.undated });
  }

  /** Make a stored file look as if it was last written at `ms`. */
  touch(bucket: string, path: string, ms: number): void {
    const o = this.buckets.get(bucket)?.get(path);
    if (!o) throw new Error(`fake storage: no such object`);
    o.updatedMs = ms;
    o.createdMs = Math.min(o.createdMs, ms);
  }

  has(bucket: string, path: string): boolean {
    return this.buckets.get(bucket)?.has(path) ?? false;
  }

  paths(bucket: string): string[] {
    return [...(this.buckets.get(bucket)?.keys() ?? [])].sort();
  }

  /** How many requests of one kind were made (for example "list"). */
  count(kind: "list" | "remove"): number {
    return this.calls.filter((c) => (kind === "list" ? c.path.startsWith("/object/list/") : c.method === "DELETE")).length;
  }

  readonly fetch: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const path = url.pathname.replace(/^\/storage\/v1/, "");
    const raw = init?.body;
    const body = typeof raw === "string" ? JSON.parse(raw) : raw;
    this.calls.push({ method, path, body });
    const seg = path.split("/").filter(Boolean).map(decodeURIComponent);
    if (seg[0] !== "object") return json({ statusCode: "404", error: "not_found" }, 404);

    // POST /object/list/<bucket>
    if (seg[1] === "list" && method === "POST") {
      const objects = this.buckets.get(seg[2]);
      if (!objects) return notFound("bucket");
      const { prefix = "", limit = 100, offset = 0 } = body as { prefix?: string; limit?: number; offset?: number };
      const level = new Map<string, Stored | null>();
      for (const [p, o] of objects) {
        if (!p.startsWith(prefix)) continue;
        const rest = p.slice(prefix.length);
        const slash = rest.indexOf("/");
        if (slash < 0) level.set(rest, o);
        else if (!level.has(rest.slice(0, slash))) level.set(rest.slice(0, slash), null);
      }
      const names = [...level.keys()].sort();
      return json(
        names.slice(offset, offset + limit).map((name) => {
          const o = level.get(name);
          if (!o) return { name, id: null, updated_at: null, created_at: null, last_accessed_at: null, metadata: null };
          if (o.undated) return { name, id: o.id };
          const iso = new Date(o.updatedMs).toISOString();
          return { name, id: o.id, updated_at: iso, created_at: new Date(o.createdMs).toISOString(), last_accessed_at: iso, metadata: { size: o.bytes.byteLength, mimetype: o.contentType, lastModified: iso } };
        }),
      );
    }

    // POST /object/sign/<bucket>/<path>, POST /object/upload/sign/<bucket>/<path>
    if (seg[1] === "sign" && method === "POST") {
      const objects = this.buckets.get(seg[2]);
      if (!objects) return notFound("bucket");
      const p = seg.slice(3).join("/");
      return objects.has(p) ? json({ signedURL: `/object/sign/${seg[2]}/${p}?token=fake` }) : notFound("object");
    }
    if (seg[1] === "upload" && seg[2] === "sign" && method === "POST") {
      if (!this.buckets.has(seg[3])) return notFound("bucket");
      return json({ url: `/object/upload/sign/${seg[3]}/${seg.slice(4).join("/")}?token=fake`, token: "fake" });
    }

    const objects = this.buckets.get(seg[1]);
    if (!objects) return notFound("bucket");

    // DELETE /object/<bucket> { prefixes: [exact paths] }
    if (method === "DELETE" && seg.length === 2) {
      const removed: { name: string }[] = [];
      for (const p of (body as { prefixes?: string[] }).prefixes ?? []) if (objects.delete(p)) removed.push({ name: p });
      return json(removed);
    }

    const p = seg.slice(2).join("/");
    // POST /object/<bucket>/<path>: upload (upsert)
    if (method === "POST") {
      const bytes = raw instanceof Uint8Array ? new Uint8Array(raw) : new Uint8Array();
      const t = this.now();
      const before = objects.get(p);
      const headers = (init?.headers ?? {}) as Record<string, string>;
      objects.set(p, { id: before?.id ?? randomUUID(), bytes, contentType: headers["content-type"] ?? "application/octet-stream", createdMs: before?.createdMs ?? t, updatedMs: t });
      return json({ Key: `${seg[1]}/${p}` });
    }
    // GET /object/<bucket>/<path>: download
    if (method === "GET") {
      const o = objects.get(p);
      return o ? new Response(Buffer.from(o.bytes), { status: 200, headers: { "content-type": o.contentType } }) : notFound("object");
    }
    return json({ statusCode: "405", error: "method" }, 405);
  }) as typeof fetch;
}
