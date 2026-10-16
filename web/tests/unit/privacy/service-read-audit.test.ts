/**
 * An operator's read of a person's data needs a reason and leaves a row (docs/plan/real-app.md 3.11 日志和审计: 「运维排障：
 * 脚本必须带一句理由，按人写 service_read_log，没有理由就拒绝运行」; 8.9 单元 privacy/service-read-audit; C2 track H):
 *   - auditedRead: no actor, no reason (or not a sentence), no tables: refused, nothing read, nothing logged; with a
 *     reason the row is written first (who, why, whose scope, which tables; never content), then the read runs; a row
 *     that cannot be written means no read
 *   - readPerson (what scripts/ops/read-person.ts runs): one row per person per run, the counts of his tables, the rows
 *     only when asked; an unknown table or an unknown person is refused before anything is read
 *   - the row is his to see: it is in his export (service_reads)
 *   - the scripts: read-person's arguments; scripts/db/inspect.mjs counts rows only with --actor and --reason and
 *     writes its row before counting (scripts/db/audit.mjs)
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { MemoryAuthProvider } from "@/lib/auth";
import { createAccountWithSpace } from "@/lib/auth/dev-accounts";
import { createLocalBlobStore } from "@/lib/blob";
import { buildExport } from "@/lib/privacy/export";
import { MIN_REASON_CHARS, PERSON_TABLES, ServiceReadRefused, auditedRead, checkServiceRead, readPerson } from "@/lib/privacy/service-read";
import { MemoryStore } from "@/lib/store/memory";
import { selfSubject } from "@/lib/subject/resolve";
import { logServiceRead, readReason } from "@/scripts/db/audit.mjs";
import { parseArgs, requestFrom } from "@/scripts/ops/read-person";

const REASON = "fault FB-12: his 9:15 reminder was not sent";
const login = () => `sr${randomUUID().replace(/-/g, "").slice(0, 10)}`;

async function world() {
  const store = new MemoryStore();
  const auth = new MemoryAuthProvider();
  const him = await createAccountWithSpace(store, auth, { login: login(), password: "a long test password", space: "blank" });
  const other = await createAccountWithSpace(store, auth, { login: login(), password: "a long test password", space: "blank" });
  const scope = him.scope!;
  await store.addNote(scope.id, { day: 0, text: "我今天好累。", source: "typed" });
  await store.addBp(scope.id, { day: 0, slot: "morning", systolic: 138, diastolic: 82 });
  await store.addBp(scope.id, { day: 0, slot: "evening", systolic: 134, diastolic: 80 });
  await store.addNote(other.scope!.id, { day: 0, text: "someone else's note", source: "typed" });
  return { store, auth, him, other, scope };
}

describe("auditedRead", () => {
  it("refuses without an actor, without a reason that is a sentence, or without tables: nothing read, nothing logged", async () => {
    const { store, scope } = await world();
    const read = vi.fn(async () => "rows");
    const cases: [Parameters<typeof auditedRead>[1], string][] = [
      [{ actor: "", reason: REASON, scopeId: scope.id, tables: ["notes"] }, "no_actor"],
      [{ actor: "   ", reason: REASON, scopeId: scope.id, tables: ["notes"] }, "no_actor"],
      [{ actor: "gengyue", reason: "", scopeId: scope.id, tables: ["notes"] }, "no_reason"],
      [{ actor: "gengyue", reason: "debug", scopeId: scope.id, tables: ["notes"] }, "no_reason"],
      [{ actor: "gengyue", reason: "............", scopeId: scope.id, tables: ["notes"] }, "no_reason"],
      [{ actor: "gengyue", reason: "   \n  \t   ", scopeId: scope.id, tables: ["notes"] }, "no_reason"],
      [{ actor: "gengyue", reason: REASON, scopeId: scope.id, tables: [] }, "no_tables"],
    ];
    for (const [req, code] of cases) {
      const err = await auditedRead(store, req, read).catch((e: unknown) => e);
      expect(err, code).toBeInstanceOf(ServiceReadRefused);
      expect((err as ServiceReadRefused).code).toBe(code);
      expect((err as Error).message).toMatch(/^refused:/);
    }
    expect(read).not.toHaveBeenCalled();
    expect(await store.listServiceReadLog()).toEqual([]);
    expect(MIN_REASON_CHARS).toBe(12);
    expect(checkServiceRead({ actor: " gengyue ", reason: "  排查  FB-12：提醒没有发出去  ", tables: ["notes"] })).toEqual({ actor: "gengyue", reason: "排查 FB-12：提醒没有发出去" });
  });

  it("with a reason: the row is there before the read runs (who, why, whose scope, which tables), and never any content", async () => {
    const { store, scope } = await world();
    let rowsSeenByRead = 0;
    const out = await auditedRead(store, { actor: "gengyue", reason: REASON, scopeId: scope.id, tables: ["notes", "bp_readings", "notes"] }, async (entry) => {
      rowsSeenByRead = (await store.listServiceReadLog({ session_id: scope.id })).length;
      expect(entry.id).toBeTruthy();
      return (await store.listNotes(scope.id)).length;
    });
    expect(out).toBe(1);
    expect(rowsSeenByRead).toBe(1);
    const log = await store.listServiceReadLog({ session_id: scope.id });
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ actor: "gengyue", reason: REASON, session_id: scope.id, tables: ["bp_readings", "notes"] });
    expect(Object.keys(log[0]).sort()).toEqual(["actor", "created_at", "id", "reason", "session_id", "tables"]);
    expect(JSON.stringify(log)).not.toContain("我今天好累");
  });

  it("a row that cannot be written means no read", async () => {
    const read = vi.fn(async () => 1);
    const down = { addServiceReadLog: async () => Promise.reject(new Error("database down")) };
    await expect(auditedRead(down, { actor: "gengyue", reason: REASON, scopeId: "s", tables: ["notes"] }, read)).rejects.toThrow("database down");
    expect(read).not.toHaveBeenCalled();
  });
});

describe("readPerson", () => {
  it("by his login: one row for him, the counts of his tables, no rows unless asked, nothing of anyone else's", async () => {
    const { store, him, other, scope } = await world();
    const r = await readPerson(store, { actor: "gengyue", reason: REASON, login: him.account.username!, tables: ["notes", "bp_readings", "visits"] });
    expect(r.counts).toEqual({ notes: 1, bp_readings: 2, visits: 0 });
    expect(r.rows).toBeUndefined();
    const log = await store.listServiceReadLog();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ id: r.logId, actor: "gengyue", reason: REASON, session_id: scope.id, tables: ["bp_readings", "notes", "visits"] });
    expect(await store.listServiceReadLog({ session_id: other.scope!.id })).toEqual([]);

    // by user id, with the rows, every table by default: a second run is a second row
    const full = await readPerson(store, { actor: "gengyue", reason: REASON, userId: him.userId, rows: true });
    expect(full.tables.sort()).toEqual(Object.keys(PERSON_TABLES).sort());
    expect((full.rows!.notes as { text: string }[]).map((n) => n.text)).toEqual(["我今天好累。"]);
    expect(JSON.stringify(full.rows)).not.toContain("someone else's note");
    expect(await store.listServiceReadLog({ session_id: scope.id })).toHaveLength(2);
  });

  it("no reason, an unknown table or an unknown person: refused before anything is read or logged", async () => {
    const { store, him } = await world();
    const spy = vi.spyOn(store, "listNotes");
    const lookup = vi.spyOn(store, "getAccountByUsername");
    await expect(readPerson(store, { actor: "gengyue", reason: "", login: him.account.username! })).rejects.toMatchObject({ code: "no_reason" });
    await expect(readPerson(store, { actor: "", reason: REASON, login: him.account.username! })).rejects.toMatchObject({ code: "no_actor" });
    expect(lookup).not.toHaveBeenCalled(); // without a reason not even the person is looked up
    await expect(readPerson(store, { actor: "gengyue", reason: REASON, login: him.account.username!, tables: ["notes", "passwords"] })).rejects.toMatchObject({ code: "unknown_table" });
    await expect(readPerson(store, { actor: "gengyue", reason: REASON, login: "nobody-by-this-name" })).rejects.toMatchObject({ code: "no_such_person" });
    await expect(readPerson(store, { actor: "gengyue", reason: REASON })).rejects.toMatchObject({ code: "no_such_person" });
    // a demo session's id is not a person
    const demo = await store.createSession();
    await expect(readPerson(store, { actor: "gengyue", reason: REASON, userId: demo.id })).rejects.toMatchObject({ code: "no_such_person" });
    expect(spy).not.toHaveBeenCalled();
    expect(await store.listServiceReadLog()).toEqual([]);
  });

  it("the row is his to see: his export lists it, without anyone's id", async () => {
    const { store, auth, him, scope } = await world();
    await readPerson(store, { actor: "gengyue", reason: REASON, userId: him.userId, tables: ["notes"] });
    const blob = createLocalBlobStore({ dir: fileURLToPath(new URL("../../../.data/test-none", import.meta.url)) });
    const file = await buildExport(
      { own: selfSubject(store, scope, him.userId).store, admin: store, auth, blob },
      { userId: him.userId, account: him.account, scope, login: him.account.username, origin: "http://localhost:3590" },
      { nowMs: Date.now(), realNowMs: Date.now() },
    );
    const reads = (file.data as { tables: { service_reads: Record<string, unknown>[] } }).tables.service_reads;
    expect(reads).toHaveLength(1);
    expect(reads[0]).toMatchObject({ actor: "gengyue", reason: REASON, tables: ["notes"] });
    expect(JSON.stringify(reads)).not.toContain(him.userId);
  });
});

describe("the scripts", () => {
  it("read-person: arguments as --name value or --name=value; --rows is a flag", () => {
    const args = parseArgs(["--actor", "gengyue", `--reason=${REASON}`, "--login", "tan88", "--tables", "notes, dose_log", "--rows"]);
    expect(requestFrom(args)).toEqual({ actor: "gengyue", reason: REASON, login: "tan88", userId: undefined, tables: ["notes", "dose_log"], rows: true });
    expect(requestFrom(parseArgs(["--user", "u-1"]))).toMatchObject({ actor: "", reason: "", userId: "u-1", rows: false });
    // a reason left out (the next word is another flag) is no reason
    expect(requestFrom(parseArgs(["--actor", "gengyue", "--reason", "--login", "tan88"]))).toMatchObject({ reason: "", login: "tan88" });
  });

  it("inspect.mjs: row counts need who and why; the audit row is written with the tables, about no one person", async () => {
    expect(readReason(["--counts"], {})).toMatchObject({ ok: false });
    expect(readReason(["--counts", "--actor", "gengyue"], {})).toMatchObject({ ok: false });
    expect(readReason(["--counts", "--actor", "gengyue", "--reason", "check"], {})).toMatchObject({ ok: false });
    expect(readReason(["--counts", "--reason", REASON], {})).toMatchObject({ ok: false });
    expect(readReason(["--counts", "--actor", "gengyue", "--reason", REASON], {})).toEqual({ ok: true, actor: "gengyue", reason: REASON });
    expect(readReason(["--counts", `--actor=gengyue`, `--reason=${REASON}`], {})).toEqual({ ok: true, actor: "gengyue", reason: REASON });
    // a script that calls it can pass both through the environment
    expect(readReason(["--counts"], { RIPPLE_OPS_ACTOR: "release.mjs", RIPPLE_OPS_REASON: "row counts after the release check" })).toMatchObject({ ok: true, actor: "release.mjs" });
    expect((readReason([], {}) as { message: string }).message).toMatch(/^refused:.*service_read_log/);

    const queries: { sql: string; params: unknown[] }[] = [];
    const client = { query: async (sql: string, params: unknown[]) => void queries.push({ sql, params }) };
    const id = await logServiceRead(client, { actor: "gengyue", reason: REASON, tables: ["visit", "note", "visit"] });
    expect(id).toMatch(/^read-[0-9a-f-]{36}$/);
    expect(queries).toHaveLength(1);
    expect(queries[0].sql).toContain("insert into public.service_read_log");
    expect(queries[0].params).toEqual([id, "gengyue", REASON, null, '["note","visit"]']);

    // the script itself: the gate comes before any count, and --counts without a reason exits 2
    const src = readFileSync(fileURLToPath(new URL("../../../scripts/db/inspect.mjs", import.meta.url)), "utf8");
    expect(src.indexOf("readReason(")).toBeGreaterThan(0);
    expect(src.indexOf("logServiceRead(")).toBeGreaterThan(0);
    expect(src.indexOf("logServiceRead(")).toBeLessThan(src.indexOf("select count(*)::int as n from public."));
    expect(src).toMatch(/process\.exit\(2\)/);
    const multi = readFileSync(fileURLToPath(new URL("../../../scripts/db/multi-instance.mjs", import.meta.url)), "utf8");
    expect(multi).toMatch(/inspect\.mjs"\), "--counts", "--actor", "multi-instance\.mjs", "--reason"/);
  });
});
