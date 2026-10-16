/**
 * Track H's routes over HTTP (app/api/me/{export,consent,delete}; journey 15): what his phone gets back. The process-wide
 * memory store and identity, the local blob driver in a temporary folder. Sign-up goes through track A's real route.
 */
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as signupPost } from "@/app/api/auth/signup/route";
import { POST as consentPost, GET as consentGet } from "@/app/api/me/consent/route";
import { POST as deletePost } from "@/app/api/me/delete/route";
import { GET as exportGet, POST as exportPost } from "@/app/api/me/export/route";
import { GET as meGet } from "@/app/api/me/route";
import { CURRENT_CONSENT_VERSIONS } from "@/lib/privacy/consent-texts";

const PASSWORD = "plum blossom tea";
const BASE = "http://localhost:3590";
let dir: string;
const before = process.env.BLOB_LOCAL_DIR;

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "ripple-h-routes-"));
  process.env.BLOB_LOCAL_DIR = dir;
});
afterAll(async () => {
  if (before === undefined) delete process.env.BLOB_LOCAL_DIR;
  else process.env.BLOB_LOCAL_DIR = before;
  await rm(dir, { recursive: true, force: true });
});

class Browser {
  jar = new Map<string, string>();
  keep(res: Response): Response {
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(";");
      const [name, ...rest] = pair.split("=");
      if (attrs.some((a) => /max-age=0\b/i.test(a.trim()))) this.jar.delete(name.trim());
      else this.jar.set(name.trim(), rest.join("="));
    }
    return res;
  }
  req(p: string, init: { method?: string; body?: unknown } = {}): NextRequest {
    const headers: Record<string, string> = { "user-agent": "Mozilla/5.0 (iPhone) Safari/604.1" };
    if (this.jar.size) headers.cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
    if (init.body !== undefined) headers["content-type"] = "application/json";
    return new NextRequest(`${BASE}${p}`, { method: init.method ?? (init.body === undefined ? "GET" : "POST"), headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  }
}

async function signedUp(space: "blank" | "none" = "blank"): Promise<Browser> {
  const b = new Browser();
  const res = b.keep(
    await signupPost(
      b.req("/api/auth/signup", {
        body: {
          login: `h${randomUUID().slice(0, 9)}`,
          password: PASSWORD,
          display_name: "陈先生",
          locale: "zh-Hans",
          assisted: false,
          consents: { terms_privacy: { version: CURRENT_CONSENT_VERSIONS.terms_privacy }, ai_processing: { decision: "granted", version: CURRENT_CONSENT_VERSIONS.ai_processing } },
          space,
        },
      }),
    ),
  );
  expect(res.status).toBe(201);
  return b;
}

describe("POST /api/me/export", () => {
  it("the file as an attachment with today's count and the links' expiry; three a day, then 429 with Retry-After", async () => {
    const b = await signedUp();
    const first = await exportPost(b.req("/api/me/export", { body: {} }));
    expect(first.status).toBe(200);
    expect(first.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(first.headers.get("content-disposition")).toMatch(/^attachment; filename="ripple-export-\d{4}-\d{2}-\d{2}\.json"$/);
    expect(first.headers.get("cache-control")).toBe("private, no-store");
    expect(first.headers.get("x-ripple-export-left")).toBe("2");
    const data = (await first.json()) as { format: string; account: { display_name: string }; tables: Record<string, unknown[]> };
    expect(data).toMatchObject({ format: "ripple-export", account: { display_name: "陈先生" } });
    expect(data.tables.consents.length).toBeGreaterThanOrEqual(2);
    expect(await (await exportGet(b.req("/api/me/export"))).json()).toMatchObject({ limit: 3, used: 1, left: 2 });
    for (const left of ["1", "0"]) expect((await exportPost(b.req("/api/me/export", { body: {} }))).headers.get("x-ripple-export-left")).toBe(left);
    const fourth = await exportPost(b.req("/api/me/export", { body: {} }));
    expect(fourth.status).toBe(429);
    expect(fourth.headers.get("retry-after")).toMatch(/^\d+$/);
    expect(await fourth.json()).toMatchObject({ error: "export_limit" });
  });

  it("signed out: 401; another site's origin: 403", async () => {
    expect((await exportPost(new Browser().req("/api/me/export", { body: {} }))).status).toBe(401);
    const b = await signedUp();
    const req = new NextRequest(`${BASE}/api/me/export`, { method: "POST", headers: { cookie: [...b.jar].map(([k, v]) => `${k}=${v}`).join("; "), origin: "https://evil.example", "content-type": "application/json" }, body: "{}" });
    expect((await exportPost(req)).status).toBe(403);
  });
});

describe("POST /api/me/consent", () => {
  it("off, then on: each a new record; GET says so", async () => {
    const b = await signedUp();
    const off = await consentPost(b.req("/api/me/consent", { body: { kind: "ai_processing", on: false } }));
    expect(off.status).toBe(200);
    expect(await off.json()).toMatchObject({ changed: true, ai: { on: false, decision: "withdrawn", version: CURRENT_CONSENT_VERSIONS.ai_processing } });
    expect(await (await consentGet(b.req("/api/me/consent"))).json()).toMatchObject({ ai: { on: false } });
    const me = (await (await meGet(b.req("/api/me"))).json()) as { consents: { kind: string; decision: string }[] };
    expect(me.consents.find((c) => c.kind === "ai_processing")?.decision).toBe("withdrawn");
    expect(await (await consentPost(b.req("/api/me/consent", { body: { kind: "ai_processing", on: true } }))).json()).toMatchObject({ changed: true, ai: { on: true } });
    expect((await consentPost(b.req("/api/me/consent", { body: { kind: "terms_privacy", on: false } }))).status).toBe(400);
  });
});

describe("POST /api/me/delete", () => {
  it("needs confirm and his password; then 200 with the cookies cleared, and he is nobody", async () => {
    const b = await signedUp();
    expect((await deletePost(b.req("/api/me/delete", { body: { password: PASSWORD } }))).status).toBe(400);
    const wrong = await deletePost(b.req("/api/me/delete", { body: { password: "not it", confirm: true } }));
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual({ error: "wrong_password" });
    const ok = b.keep(await deletePost(b.req("/api/me/delete", { body: { password: PASSWORD, confirm: true } })));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true });
    expect(b.jar.has("rp_at")).toBe(false);
    expect(b.jar.has("rp_rt")).toBe(false);
    expect((await meGet(b.req("/api/me"))).status).toBe(401);
  });

  it("a family member without a space deletes her account the same way (her 「我的」 screen calls it)", async () => {
    const her = await signedUp("none");
    expect((await deletePost(her.req("/api/me/delete", { body: { password: "not it", confirm: true } }))).status).toBe(401);
    const ok = her.keep(await deletePost(her.req("/api/me/delete", { body: { password: PASSWORD, confirm: true } })));
    expect(ok.status).toBe(200);
    expect(her.jar.has("rp_at")).toBe(false);
    expect((await meGet(her.req("/api/me"))).status).toBe(401);
  });
});
