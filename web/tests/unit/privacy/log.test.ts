/**
 * lib/log.ts: the server's log line follows a whitelist (real-app 3.11 日志和审计; C2 track H). Whatever a caller passes,
 * no free text reaches the line: unknown fields are dropped, a value of the wrong shape is "redacted", a user id is
 * hashed, an id in a route becomes ":id", a query string is cut.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanFields, errorCode, log, logLine, userHash } from "@/lib/log";

const R4 = "Please don't change the dose yourself. If your readings are high, write them down and tell me at your next visit.";
const NOTE = "今天在大巴窑中心走了一圈，脚踝有点肿。";
const USER = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";

afterEach(() => vi.restoreAllMocks());

describe("lib/log whitelist", () => {
  it("keeps the whitelisted fields in shape and hashes the user", () => {
    const f = cleanFields({ route: "/api/me/export", method: "post", status: 200, ms: 41.7, code: "export_limit", user: USER, job: "privacy.retention", counts: { files: 3, rows: 120 } });
    expect(f).toEqual({ route: "/api/me/export", method: "POST", status: 200, ms: 42, code: "export_limit", user: userHash(USER), job: "privacy.retention", counts: { files: 3, rows: 120 } });
    expect(userHash(USER)).toMatch(/^[0-9a-f]{16}$/);
    expect(JSON.stringify(f)).not.toContain(USER);
  });

  it("drops anything not on the list and redacts free text in the listed fields", () => {
    const f = cleanFields({
      route: `/api/visits/${USER}/keep?note=${encodeURIComponent(NOTE)}`,
      code: R4,
      job: NOTE,
      counts: { files: 2, [NOTE]: 1, say: "x" as unknown as number, rows: Number.NaN },
      body: { text: NOTE },
      say: R4,
      input: NOTE,
      status: 999,
      method: "TRACE",
      ms: -5,
    } as Record<string, unknown>);
    expect(f).toEqual({ route: "/api/visits/:id/keep", code: "redacted", job: "redacted", counts: { files: 2 } });
    const line = JSON.stringify(f);
    for (const words of [R4, NOTE, "dose", "脚踝"]) expect(line).not.toContain(words);
  });

  it("a route that is not a path is redacted; an event name of the wrong shape becomes \"event\"", () => {
    expect(cleanFields({ route: NOTE }).route).toBe("redacted");
    expect(cleanFields({ route: "https://evil.example/x" }).route).toBe("redacted");
    const line = logLine("info", NOTE, { status: 200 });
    expect(line.startsWith("[ripple] ")).toBe(true);
    const body = JSON.parse(line.slice("[ripple] ".length)) as Record<string, unknown>;
    expect(body).toMatchObject({ level: "info", event: "event", status: 200 });
    expect(Object.keys(body).sort()).toEqual(["event", "level", "status", "t"]);
  });

  it("log() prints one line at the level's console method and never throws", () => {
    const out = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    log("info", "me.export", { status: 200, user: USER });
    log("warn", "me.export", { status: 429 });
    log("error", "me.delete", { status: 503, code: "storage_not_empty", counts: { files: 1 } });
    expect(out).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(err).toHaveBeenCalledTimes(1);
    expect(String(out.mock.calls[0][0])).not.toContain(USER);
    expect(String(err.mock.calls[0][0])).toContain('"code":"storage_not_empty"');
  });

  it("errorCode keeps a shaped code and nothing else", () => {
    expect(errorCode({ code: "session_not_found" })).toBe("session_not_found");
    expect(errorCode(new Error(NOTE))).toBe("error");
    expect(errorCode({ code: R4 })).toBe("error");
    expect(errorCode(null)).toBe("error");
  });
});
