/**
 * Where a signed-in person's pages send them (docs/plan/real-app.md 3.7 页面跳转; track A): someone who only helps a
 * family member has no space of her own, so his pages (/p/*) send her to /f instead of offering her a demo sandbox.
 * The layout is rendered as a server component with the request's cookies mocked, so no proxy is in front.
 */
import { randomUUID } from "node:crypto";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const jar = vi.hoisted(() => ({ cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)! } : undefined) }),
  headers: async () => new Headers(),
}));

import PatientLayout from "@/app/p/layout";
import { getAuthProvider } from "@/lib/auth";
import { createAccountWithSpace } from "@/lib/auth/dev-accounts";
import { getMemoryStore } from "@/lib/store/memory";
import { signedInWithoutSpace } from "@/lib/subject/account";

const store = getMemoryStore();
const account = (space: "example" | "none") => createAccountWithSpace(store, getAuthProvider(), { login: `pr${randomUUID().slice(0, 9)}`, password: "a long test password", space });

/** What rendering the layout does: the element it returns, or the redirect it throws (Next's NEXT_REDIRECT digest). */
async function render(): Promise<{ element: ReactElement | null; redirect: string | null }> {
  try {
    const element = (await PatientLayout({ children: null, params: Promise.resolve({}) } as never)) as ReactElement;
    return { element, redirect: null };
  } catch (err) {
    const digest = (err as { digest?: string }).digest ?? "";
    if (!digest.startsWith("NEXT_REDIRECT")) throw err;
    return { element: null, redirect: digest.split(";")[2] ?? null };
  }
}

afterEach(() => jar.cookies.clear());

describe("/p/* for someone signed in", () => {
  it("a family member with no space of her own is sent to /f", async () => {
    const her = await account("none");
    jar.cookies.set("rp_at", her.tokens.access_token);
    expect(await signedInWithoutSpace()).toBe(true);
    expect(await render()).toEqual({ element: null, redirect: "/f" });
  });

  it("he, with his own space, gets his pages; nobody signed in is not redirected here (the proxy sends them to the login)", async () => {
    const him = await account("example");
    jar.cookies.set("rp_at", him.tokens.access_token);
    expect(await signedInWithoutSpace()).toBe(false);
    const mine = await render();
    expect(mine.redirect).toBeNull();
    expect(mine.element).not.toBeNull();
    jar.cookies.clear();
    expect(await signedInWithoutSpace()).toBe(false);
    const nobody = await render();
    expect(nobody.redirect).toBeNull();
    expect(nobody.element).not.toBeNull();
    // a token that does not verify is nobody too
    jar.cookies.set("rp_at", `${him.tokens.access_token.slice(0, -6)}AAAAAA`);
    expect(await signedInWithoutSpace()).toBe(false);
    expect((await render()).redirect).toBeNull();
  });
});
