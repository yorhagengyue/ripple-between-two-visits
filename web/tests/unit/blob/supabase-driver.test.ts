/**
 * Supabase driver against a fake fetch: the requests it builds (endpoints, headers, bodies), how it
 * reads the answers, and that its errors never carry the key or a signed URL. The real service is
 * covered by supabase.live.test.ts (BLOB_LIVE=1).
 */
import { describe, expect, it } from "vitest";
import { BlobError, BUCKET_CONFIG, createSupabaseBlobStore } from "@/lib/blob";
import { wavBytes, webmBytes } from "./fixtures";

const URL_ = "https://proj.supabase.test/";
const KEY = "fake-service-key-for-tests";

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function fakeFetch(answer: (call: Call) => Response) {
  const calls: Call[] = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = init?.body;
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof raw === "string" ? JSON.parse(raw) : raw,
    };
    calls.push(call);
    return answer(call);
  }) as typeof fetch;
  return { fn, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const make = (answer: (call: Call) => Response) => {
  const f = fakeFetch(answer);
  return { store: createSupabaseBlobStore({ url: URL_, serviceKey: KEY, fetch: f.fn, now: () => Date.UTC(2026, 9, 9) }), calls: f.calls };
};

describe("supabase driver requests", () => {
  it("uploads with upsert and both auth headers", async () => {
    const { store, calls } = make(() => json({ Key: "audio/s/a.wav" }));
    await store.putObject("audio", "s/visits/v1/a.wav", wavBytes(), "audio/wav");
    expect(calls[0].url).toBe("https://proj.supabase.test/storage/v1/object/audio/s/visits/v1/a.wav");
    expect(calls[0].method).toBe("POST");
    expect(calls[0].headers).toMatchObject({ apikey: KEY, authorization: `Bearer ${KEY}`, "content-type": "audio/wav", "x-upsert": "true" });
  });

  it("checks type and bytes before calling Supabase (WebM never leaves the server)", async () => {
    const { store, calls } = make(() => json({}));
    await expect(store.putObject("audio", "s/a.wav", webmBytes(), "audio/wav")).rejects.toMatchObject({ code: "unsupported_content_type" });
    await expect(store.signedUploadUrl("audio", "s/a.wav", "audio/webm", 60)).rejects.toMatchObject({ code: "unsupported_content_type" });
    expect(calls).toHaveLength(0);
  });

  it("downloads, and a missing object (Storage answers 400 + statusCode 404) is null", async () => {
    const { store } = make((c) =>
      c.url.endsWith("/there.wav")
        ? new Response(Buffer.from(wavBytes()), { status: 200, headers: { "content-type": "audio/wav" } })
        : json({ statusCode: "404", error: "not_found", message: "Object not found" }, 400),
    );
    const got = await store.getObject("audio", "s/there.wav");
    expect(got?.contentType).toBe("audio/wav");
    expect(got?.bytes.byteLength).toBe(wavBytes().byteLength);
    expect(await store.getObject("audio", "s/missing.wav")).toBeNull();
  });

  it("a missing bucket is not_configured with a hint, not a silent null", async () => {
    const { store } = make(() => json({ statusCode: "404", error: "Bucket not found", message: "Bucket not found" }, 400));
    await expect(store.getObject("audio", "s/a.wav")).rejects.toMatchObject({ code: "not_configured" });
  });

  it("signed upload link: absolute URL under /storage/v1, upsert, fixed 2 h lifetime", async () => {
    const { store, calls } = make(() => json({ url: "/object/upload/sign/audio/s/a.wav?token=abc", token: "abc" }));
    const link = await store.signedUploadUrl("audio", "s/a.wav", "audio/wav", 600);
    expect(calls[0].url).toBe("https://proj.supabase.test/storage/v1/object/upload/sign/audio/s/a.wav");
    expect(calls[0].headers["x-upsert"]).toBe("true");
    expect(link).toEqual({
      url: "https://proj.supabase.test/storage/v1/object/upload/sign/audio/s/a.wav?token=abc",
      method: "PUT",
      headers: { "content-type": "audio/wav", "x-upsert": "true" },
      expiresAt: "2026-10-09T02:00:00.000Z",
    });
  });

  it("signed read link: asks for the lifetime, returns the absolute URL", async () => {
    const { store, calls } = make(() => json({ signedURL: "/object/sign/labels/s/p.png?token=xyz" }));
    const url = await store.signedReadUrl("labels", "s/p.png", 3600);
    expect(calls[0].url).toBe("https://proj.supabase.test/storage/v1/object/sign/labels/s/p.png");
    expect(calls[0].body).toEqual({ expiresIn: 3600 });
    expect(url).toBe("https://proj.supabase.test/storage/v1/object/sign/labels/s/p.png?token=xyz");
  });

  it("removePrefix walks folders (id null) and deletes in one batch", async () => {
    const tree: Record<string, { name: string; id: string | null }[]> = {
      "sess/": [
        { name: "visits", id: null },
        { name: "top.wav", id: "1" },
      ],
      "sess/visits/": [{ name: "v1", id: null }],
      "sess/visits/v1/": [
        { name: "recording-1.wav", id: "2" },
        { name: "segments", id: null },
      ],
      "sess/visits/v1/segments/": [{ name: "u1.wav", id: "3" }],
    };
    const { store, calls } = make((c) => {
      if (c.url.endsWith("/object/list/audio")) return json(tree[(c.body as { prefix: string }).prefix] ?? []);
      return json((c.body as { prefixes: string[] }).prefixes.map((name) => ({ name })));
    });
    expect(await store.removePrefix("audio", "sess/")).toBe(3);
    const del = calls.find((c) => c.method === "DELETE")!;
    expect(del.url).toBe("https://proj.supabase.test/storage/v1/object/audio");
    expect((del.body as { prefixes: string[] }).prefixes.sort()).toEqual([
      "sess/top.wav",
      "sess/visits/v1/recording-1.wav",
      "sess/visits/v1/segments/u1.wav",
    ]);
    expect(await code(store.removePrefix("audio", ""))).toBe("invalid_path");
  });

  it("ensureBucket creates a private bucket with the content types and size cap, or updates an existing one", async () => {
    const created = make((c) => (c.method === "GET" ? json({ statusCode: "404", error: "Bucket not found" }, 400) : json({ name: "audio" })));
    expect(await created.store.ensureBucket(BUCKET_CONFIG.audio)).toBe("created");
    expect(created.calls[1]).toMatchObject({ method: "POST", url: "https://proj.supabase.test/storage/v1/bucket" });
    expect(created.calls[1].body).toEqual({
      id: "audio",
      name: "audio",
      public: false,
      file_size_limit: 50 * 1024 * 1024,
      allowed_mime_types: ["audio/wav"],
    });
    const existing = make(() => json({ id: "labels", public: false }));
    expect(await existing.store.ensureBucket(BUCKET_CONFIG.labels)).toBe("exists");
    expect(existing.calls[1]).toMatchObject({ method: "PUT", url: "https://proj.supabase.test/storage/v1/bucket/labels" });
    expect((existing.calls[1].body as { allowed_mime_types: string[] }).allowed_mime_types).toEqual(["image/png", "image/jpeg", "image/webp"]);
  });

  it("errors carry the status and Storage's short code, never the key or a token", async () => {
    const { store } = make(() => json({ statusCode: "403", error: "Unauthorized", message: `bad key ${KEY}` }, 403));
    try {
      await store.signedReadUrl("audio", "s/a.wav", 60);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(BlobError);
      expect((err as BlobError).code).toBe("upstream");
      expect((err as Error).message).toBe("Supabase Storage sign read: HTTP 403 (Unauthorized)");
      expect((err as Error).message).not.toContain(KEY);
    }
    const net = createSupabaseBlobStore({ url: URL_, serviceKey: KEY, fetch: (async () => { throw new Error(`boom ${KEY}`); }) as typeof fetch });
    await expect(net.getObject("audio", "s/a.wav")).rejects.toThrow("Supabase Storage download: network error");
  });
});

// ---- C2 track H: the listing the orphan sweep and the account deletion's check use (listPrefixes, listFiles, removeObjects)
describe("supabase driver listing", () => {
  const folder = (name: string) => ({ name, id: null, updated_at: null, created_at: null, last_accessed_at: null, metadata: null });
  const file = (name: string, times: { updated_at?: string; created_at?: string; lastModified?: string } = {}) => ({
    name,
    id: `id-${name}`,
    ...(times.updated_at ? { updated_at: times.updated_at } : {}),
    ...(times.created_at ? { created_at: times.created_at } : {}),
    metadata: times.lastModified ? { lastModified: times.lastModified } : null,
  });
  /** A store over a fixed tree (keyed by the list call's prefix), paged the way Storage pages: limit and offset. */
  const over = (tree: Record<string, unknown[]>, listPage?: number) => {
    const f = fakeFetch((c) => {
      if (c.method === "DELETE") return json((c.body as { prefixes: string[] }).prefixes.filter((p) => !p.includes("never")).map((name) => ({ name })));
      const b = c.body as { prefix: string; limit: number; offset: number };
      return json((tree[b.prefix] ?? []).slice(b.offset, b.offset + b.limit));
    });
    return { store: createSupabaseBlobStore({ url: URL_, serviceKey: KEY, fetch: f.fn, listPage }), calls: f.calls };
  };

  it("listPrefixes lists the bucket's top level (prefix \"\"), 1000 a call, and keeps the folders in name order", async () => {
    const { store, calls } = over({ "": [folder("b-scope"), folder("a-scope"), file("stray.wav"), folder(".hidden"), folder("has space")] });
    expect(await store.listPrefixes("audio")).toEqual(["a-scope", "b-scope"]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: "POST", url: "https://proj.supabase.test/storage/v1/object/list/audio" });
    expect(calls[0].body).toEqual({ prefix: "", limit: 1000, offset: 0, sortBy: { column: "name", order: "asc" } });
    expect(calls[0].headers).toMatchObject({ apikey: KEY, authorization: `Bearer ${KEY}` });
  });

  it("pages by offset until a page comes back short (top level and inside a folder)", async () => {
    const tops = ["s1", "s2", "s3", "s4", "s5"].map(folder);
    const { store, calls } = over({ "": tops, "s1/": [file("a.wav"), file("b.wav"), file("c.wav"), file("d.wav")] }, 2);
    expect(await store.listPrefixes("labels")).toEqual(["s1", "s2", "s3", "s4", "s5"]);
    expect(calls.map((c) => (c.body as { offset: number }).offset)).toEqual([0, 2, 4]);
    expect(calls.every((c) => (c.body as { limit: number }).limit === 2)).toBe(true);
    calls.length = 0;
    expect((await store.listFiles("labels", "s1")).map((f) => f.path)).toEqual(["s1/a.wav", "s1/b.wav", "s1/c.wav", "s1/d.wav"]);
    // four files, two a page: the third call comes back empty and ends it
    expect(calls.map((c) => (c.body as { prefix: string; offset: number }).offset)).toEqual([0, 2, 4]);
    expect(calls.every((c) => (c.body as { prefix: string }).prefix === "s1/")).toBe(true);
  });

  it("listFiles walks the sub-folders and reads the last write: updated_at, else metadata.lastModified, else created_at, else null", async () => {
    const { store } = over({
      "sess/": [folder("visits"), file("top.wav", { updated_at: "2026-10-01T00:00:00.000Z", created_at: "2026-09-01T00:00:00.000Z" }), file(".emptyFolderPlaceholder", { updated_at: "2026-10-01T00:00:00.000Z" })],
      "sess/visits/": [folder("v1")],
      "sess/visits/v1/": [file("recording-1.wav", { lastModified: "2026-10-02T00:00:00.000Z", created_at: "2026-09-02T00:00:00.000Z" }), folder("segments")],
      "sess/visits/v1/segments/": [file("u1.wav", { created_at: "2026-10-03T00:00:00.000Z" }), file("u2.wav"), file("u3.wav", { updated_at: "not a date" })],
    });
    expect(await store.listFiles("audio", "sess/")).toEqual([
      { path: "sess/top.wav", lastModifiedMs: Date.parse("2026-10-01T00:00:00.000Z") },
      { path: "sess/visits/v1/recording-1.wav", lastModifiedMs: Date.parse("2026-10-02T00:00:00.000Z") },
      { path: "sess/visits/v1/segments/u1.wav", lastModifiedMs: Date.parse("2026-10-03T00:00:00.000Z") },
      { path: "sess/visits/v1/segments/u2.wav", lastModifiedMs: null },
      { path: "sess/visits/v1/segments/u3.wav", lastModifiedMs: null },
    ]);
    expect(await code(store.listFiles("audio", ""))).toBe("invalid_path");
  });

  it("removeObjects sends one DELETE with the exact paths and returns how many Storage says went", async () => {
    const { store, calls } = over({});
    expect(await store.removeObjects("audio", ["sess/a.wav", "sess/visits/v1/b.wav", "sess/never.wav", "sess/a.wav"])).toBe(2);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: "DELETE", url: "https://proj.supabase.test/storage/v1/object/audio" });
    expect(calls[0].body).toEqual({ prefixes: ["sess/a.wav", "sess/visits/v1/b.wav", "sess/never.wav"] });
    calls.length = 0;
    expect(await store.removeObjects("audio", [])).toBe(0);
    expect(await code(store.removeObjects("audio", ["sess/../other/a.wav"]))).toBe("invalid_path");
    expect(calls).toHaveLength(0);
  });

  it("a list answer that is not a list, a missing bucket and a refused call are errors, never an empty listing", async () => {
    const odd = make(() => json({ message: "what" }));
    await expect(odd.store.listPrefixes("audio")).rejects.toMatchObject({ code: "upstream", message: "Supabase Storage list: unexpected response" });
    const noBucket = make(() => json({ statusCode: "404", error: "Bucket not found", message: "Bucket not found" }, 400));
    await expect(noBucket.store.listFiles("audio", "sess")).rejects.toMatchObject({ code: "not_configured" });
    const refused = make(() => json({ statusCode: "403", error: "Unauthorized", message: `bad key ${KEY}` }, 403));
    const err = await refused.store.listPrefixes("audio").catch((e: unknown) => e as Error);
    expect((err as Error).message).toBe("Supabase Storage list: HTTP 403 (Unauthorized)");
    expect((err as Error).message).not.toContain(KEY);
  });
});

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (err) {
    return (err as BlobError).code;
  }
}
