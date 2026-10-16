/**
 * The one "account" field (lib/auth/login-name.ts; C2 F1 item F, real-app 3.4): an address with an @ is an e-mail
 * login, anything else a username mapped to <username>@AUTH_USERNAME_DOMAIN (a domain that never receives mail).
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_USERNAME_DOMAIN, parseLoginName, RESERVED_USERNAMES, usernameDomain, usernameOfEmail } from "@/lib/auth/login-name";

const ok = (input: string, env: Record<string, string | undefined> = {}) => {
  const r = parseLoginName(input, env);
  if (!r.ok) throw new Error(`${input}: ${r.error}`);
  return r.login;
};
const err = (input: string, env: Record<string, string | undefined> = {}) => {
  const r = parseLoginName(input, env);
  return r.ok ? "ok" : r.error;
};

describe("e-mail logins", () => {
  it("trimmed and lower case", () => {
    expect(ok("  Wei.Ling@Example.COM ")).toEqual({ kind: "email", email: "wei.ling@example.com" });
  });

  it("one @ and a dot in the domain", () => {
    for (const bad of ["a@b", "@example.com", "a@", "a@@example.com", "a b@example.com", "a@exa mple.com"]) expect(err(bad), bad).toBe("email_invalid");
    expect(err(`${"a".repeat(250)}@example.com`)).toBe("email_invalid");
  });

  it("never an address on the internal username domain (nobody signs up as someone's username)", () => {
    expect(err(`tan123@${DEFAULT_USERNAME_DOMAIN}`)).toBe("email_reserved_domain");
    expect(err(`tan123@sub.${DEFAULT_USERNAME_DOMAIN}`)).toBe("email_reserved_domain");
    expect(err("tan123@accounts.example.invalid", { AUTH_USERNAME_DOMAIN: "accounts.example.invalid" })).toBe("email_reserved_domain");
  });
});

describe("usernames", () => {
  it("lower case, mapped to the internal domain", () => {
    expect(ok("TanAhKow")).toEqual({ kind: "username", username: "tanahkow", email: `tanahkow@${DEFAULT_USERNAME_DOMAIN}` });
    expect(ok("tan.ah-kow_2")).toMatchObject({ username: "tan.ah-kow_2" });
  });

  it("full-width letters and digits (a Chinese keyboard) are the plain ones", () => {
    expect(ok("ｔａｎ１２３")).toMatchObject({ kind: "username", username: "tan123" });
  });

  it("digits only (a phone number) are allowed", () => {
    expect(ok("91234567")).toMatchObject({ kind: "username", username: "91234567" });
  });

  it("3 to 32 characters of a-z 0-9 . _ -, starting with a letter or digit", () => {
    for (const bad of ["ab", "-abc", ".abc", "_abc", "a b c", "tan!", "陈先生", "x".repeat(33)]) expect(err(bad), bad).toBe("username_invalid");
    expect(err("x".repeat(32))).toBe("ok");
    expect(err("abc")).toBe("ok");
  });

  it("the reserved names are refused in any case", () => {
    for (const name of RESERVED_USERNAMES) {
      expect(err(name), name).toBe("username_reserved");
      expect(err(name.toUpperCase()), name).toBe("username_reserved");
    }
  });

  it("an empty field", () => {
    expect(err("")).toBe("login_empty");
    expect(err("   ")).toBe("login_empty");
  });
});

describe("the internal domain", () => {
  it("AUTH_USERNAME_DOMAIN, lower case, without a leading @; the default otherwise", () => {
    expect(usernameDomain({})).toBe(DEFAULT_USERNAME_DOMAIN);
    expect(DEFAULT_USERNAME_DOMAIN.endsWith(".invalid")).toBe(true);
    expect(usernameDomain({ AUTH_USERNAME_DOMAIN: " @Accounts.Example.Invalid " })).toBe("accounts.example.invalid");
    expect(ok("tan123", { AUTH_USERNAME_DOMAIN: "accounts.example.invalid" })).toMatchObject({ email: "tan123@accounts.example.invalid" });
  });

  it("usernameOfEmail reads the username back, and is null for a real address", () => {
    expect(usernameOfEmail(`tan123@${DEFAULT_USERNAME_DOMAIN}`, {})).toBe("tan123");
    expect(usernameOfEmail("wei.ling@example.com", {})).toBeNull();
  });
});
