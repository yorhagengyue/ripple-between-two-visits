/**
 * Production builds bundle lib/store, lib/blob and lib/subject into many chunks while the stores live on globalThis, so
 * an error a store throws can be an instance of another copy of its class (track H found POST /api/me/delete answering
 * 500 instead of 404). The classes recognise their errors by name; storeErrorResponse maps them the same way.
 */
import { describe, expect, it } from "vitest";
import { BlobError } from "@/lib/blob/types";
import { LocalBlobStore } from "@/lib/blob/local";
import { storeErrorResponse } from "@/lib/session/http";
import { isStoreError, StoreError } from "@/lib/store/types";
import { ScopeViolation } from "@/lib/subject/scoped-store";

/** What another chunk's copy of the class produces: same name and fields, a different prototype. */
function foreign(name: string, fields: Record<string, unknown>): Error {
  return Object.assign(new Error("from another copy"), { name, ...fields });
}

describe("errors from another copy of a module are still recognised", () => {
  it("StoreError: instanceof, isStoreError and storeErrorResponse", async () => {
    const err = foreign("StoreError", { code: "not_found" });
    expect(err instanceof StoreError).toBe(true);
    expect(isStoreError(err, "not_found")).toBe(true);
    expect(isStoreError(err, "invalid")).toBe(false);
    expect(new StoreError("invalid") instanceof StoreError).toBe(true);
    expect(new Error("x") instanceof StoreError).toBe(false);
    expect(foreign("StoreError", {}) instanceof StoreError).toBe(false);
    const res = storeErrorResponse(err);
    expect(res.status).toBe(404);
    expect(storeErrorResponse(foreign("StoreError", { code: "invalid" })).status).toBe(400);
  });

  it("BlobError, ScopeViolation and LocalBlobStore", () => {
    expect(foreign("BlobError", { code: "not_found" }) instanceof BlobError).toBe(true);
    expect(new Error("x") instanceof BlobError).toBe(false);
    expect(foreign("ScopeViolation", { method: "m", why: "w" }) instanceof ScopeViolation).toBe(true);
    expect(() => storeErrorResponse(foreign("ScopeViolation", {}))).toThrow();
    expect({ driver: "local", dir: "D:/x" } instanceof LocalBlobStore).toBe(true);
    expect({ driver: "supabase" } instanceof LocalBlobStore).toBe(false);
  });
});
