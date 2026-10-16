/**
 * The account deletion's last check cannot forget a table (C2 track H; real-app 3.11 删除账号 step 4 「每张表按 session_id 或
 * user_id 计数为 0」): the list of columns store.countAccountRows reads (lib/store/account-rows.ts) is compared with the
 * schema itself, read from supabase/migrations/*.sql. Every column that can hold a user id or a scope id must be on the
 * list or among the named exceptions; a new table that names a person and is on neither turns this red.
 * What counts as such a column: one named session_id, scope_id, user_id, patient_id or family_id, and any other uuid
 * column that is not a row's own id or a link id (owner_user_id, by_user_id, family_user_id, entered_by_user_id, ...).
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ACCOUNT_ROW_COLUMNS, ACCOUNT_ROW_EXCEPTIONS, accountRowKeys } from "@/lib/store/account-rows";

const MIGRATIONS = fileURLToPath(new URL("../../../supabase/migrations/", import.meta.url));

/** Every table of schema public with its columns and their types, as the migrations make them. */
function schema(): Map<string, Map<string, string>> {
  const tables = new Map<string, Map<string, string>>();
  const col = (table: string, name: string, type: string) => {
    if (!tables.has(table)) tables.set(table, new Map());
    tables.get(table)!.set(name, type.toLowerCase());
  };
  for (const file of readdirSync(MIGRATIONS).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort()) {
    const sql = readFileSync(path.join(MIGRATIONS, file), "utf8").replace(/--[^\n]*/g, "");
    for (const m of sql.matchAll(/create table (?:if not exists )?public\.(\w+)\s*\(([\s\S]*?)\n\);/g)) {
      for (const raw of m[2].split("\n")) {
        const line = raw.trim().replace(/,$/, "");
        if (!line || /^(constraint|primary key|unique|foreign key|check)\b/i.test(line)) continue;
        const c = /^"?(\w+)"?\s+(\w+)/.exec(line);
        if (c) col(m[1], c[1], c[2]);
      }
    }
    for (const m of sql.matchAll(/alter table public\.(\w+)\s+([\s\S]*?);/g)) {
      for (const c of m[2].matchAll(/add column (?:if not exists )?"?(\w+)"?\s+(\w+)/g)) col(m[1], c[1], c[2]);
    }
  }
  return tables;
}

const NAMES_A_PERSON = /(^|_)(session_id|scope_id|user_id|patient_id|family_id)$/;

/** "table.column" for every column of the schema that can hold a user id or a scope id. */
function personColumns(tables: Map<string, Map<string, string>>): string[] {
  const out: string[] = [];
  for (const [table, cols] of tables) {
    for (const [name, type] of cols) {
      if (NAMES_A_PERSON.test(name) || (type === "uuid" && name !== "id" && name !== "link_id")) out.push(`${table}.${name}`);
    }
  }
  return out.sort();
}

describe("the columns the account deletion checks", () => {
  const tables = schema();

  it("the migrations were read: the tables are there with their columns", () => {
    expect(tables.size).toBeGreaterThanOrEqual(40);
    for (const t of ["session", "visit", "account", "care_link", "reset_request", "bus_event", "bus_seq", "session_member", "translation", "understanding_answer", "account_session"]) {
      expect(tables.has(t), t).toBe(true);
    }
    expect(tables.get("question")!.get("asked_by_user_id")).toBe("uuid");
    expect(tables.get("reminder_clip")!.get("by_user_id")).toBe("uuid");
    expect(tables.get("session")!.get("owner_user_id")).toBe("uuid");
  });

  it("every column of the schema that can hold a user id or a scope id is counted, or is a named exception", () => {
    const counted = new Set(accountRowKeys());
    const missing = personColumns(tables).filter((k) => !counted.has(k) && !(k in ACCOUNT_ROW_EXCEPTIONS));
    expect(missing, `add these to lib/store/account-rows.ts (ACCOUNT_ROW_COLUMNS, or ACCOUNT_ROW_EXCEPTIONS with the reason): ${missing.join(", ")}`).toEqual([]);
  });

  it("nothing on the list is made up: each counted column and each exception exists in the schema", () => {
    for (const [table, cols] of Object.entries(ACCOUNT_ROW_COLUMNS)) {
      expect(tables.has(table), table).toBe(true);
      for (const c of cols) expect(tables.get(table)!.has(c), `${table}.${c}`).toBe(true);
    }
    for (const key of Object.keys(ACCOUNT_ROW_EXCEPTIONS)) {
      const [table, c] = key.split(".");
      expect(tables.get(table)?.has(c), key).toBe(true);
      expect(accountRowKeys()).not.toContain(key);
      expect(ACCOUNT_ROW_EXCEPTIONS[key].length).toBeGreaterThan(20);
    }
    // the scope row itself is found by its own id (an account's scope id is its user id)
    expect(ACCOUNT_ROW_COLUMNS.session).toEqual(["id", "owner_user_id"]);
    // the tables the earlier hand list left out are on it
    for (const k of ["reset_request.user_id", "bus_event.session_id", "bus_seq.session_id", "session_member.session_id"]) expect(accountRowKeys()).toContain(k);
  });

  it("the only table kept on purpose is the operators' audit trail", () => {
    expect(Object.keys(ACCOUNT_ROW_EXCEPTIONS).sort()).toEqual(["account_session.session_id", "service_read_log.session_id"]);
  });
});
