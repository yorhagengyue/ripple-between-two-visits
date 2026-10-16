/**
 * provision (C2 track P; docs/plan/hosting.md 5.6): the bundle that is sent, Caddy's configuration, what the script
 * refuses to do, and what the files that run on the server say. provision.sh itself is run, with stand-in commands,
 * in provision-sandbox.test.ts.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { webRoot } from "@/lib/llm/root";
import { parseArgs } from "@/scripts/deploy/lib/cli";
import { loadContext } from "@/scripts/deploy/lib/deploy-file";
import { serverFile } from "@/scripts/deploy/lib/exec";
import { buildBundle, BUNDLE_FILES, main as provision, renderCaddyfile } from "@/scripts/deploy/provision";
import { APP_DOMAIN, APP_EXTRA, expectNoLeak, fakeFiles, fakeRunner, fullDeploy, ORIGIN_DOMAIN, quietOutput } from "./helpers";

const WEB = webRoot();
const SERVER = path.join(WEB, "scripts", "deploy", "server");

describe("Caddy's configuration", () => {
  const template = serverFile(WEB, "Caddyfile.tmpl");

  it("serves the origin name only to requests that carry the origin lock, and answers 403 to the rest", () => {
    const text = renderCaddyfile(template, ORIGIN_DOMAIN, APP_DOMAIN);
    expect(text).not.toMatch(/__[A-Z]+__/);
    expect(text).toContain(`\n${ORIGIN_DOMAIN} {\n\t@edge header X-Ripple-Edge {$EDGE_SECRET}\n\thandle @edge {\n\t\treverse_proxy 127.0.0.1:3200 {`);
    expect(text).toContain(`header_up Host ${APP_DOMAIN}`);
    expect(text).toContain(`header_up X-Forwarded-Host ${APP_DOMAIN}`);
    expect(text).toContain("\thandle {\n\t\trespond 403\n\t}");
    // the public name is not served directly unless someone removes the comment marks on purpose
    const live = text.split("\n").filter((l) => !l.trimStart().startsWith("#"));
    expect(live.join("\n")).not.toContain(`${APP_DOMAIN} {`);
    expect(live.filter((l) => /^\S.*\{$/.test(l))).toEqual([`${ORIGIN_DOMAIN} {`]);
    // no access log: a URL can carry a sandbox id
    expect(live.join("\n")).not.toMatch(/\blog\b/);
  });

  it("adds the certificate contact only when one is given, and refuses names that are not plain host names", () => {
    expect(renderCaddyfile(template, ORIGIN_DOMAIN, APP_DOMAIN).split("\n").filter((l) => !l.startsWith("#"))[0]).toBe(`${ORIGIN_DOMAIN} {`);
    expect(renderCaddyfile(template, ORIGIN_DOMAIN, APP_DOMAIN, "ops@fake-ripple-zz.example")).toContain("{\n\temail ops@fake-ripple-zz.example\n}\n");
    expect(() => renderCaddyfile(template, "origin.example.com {\n respond 200\n}", APP_DOMAIN)).toThrow(/plain host names/);
    expect(() => renderCaddyfile(template, ORIGIN_DOMAIN, APP_DOMAIN, "ops@example.com }\n:80 {")).toThrow(/e-mail/);
  });
});

describe("the bundle", () => {
  const ctxOf = (f: ReturnType<typeof fakeFiles>) => loadContext(parseArgs(f.flags), WEB, quietOutput());
  const decode = (script: string) => {
    const files: Record<string, string> = {};
    for (const m of script.matchAll(/base64 -d > "\$D\/([^"]+)" <<'RIPPLE_B64'\n([\s\S]*?)\nRIPPLE_B64/g)) files[m[1]] = Buffer.from(m[2].replace(/\n/g, ""), "base64").toString("utf8");
    return files;
  };

  it("carries provision.sh and every file it installs, byte for byte, and runs it on the last line", () => {
    const bundle = buildBundle(ctxOf(fakeFiles()), "24.15.0", "17");
    const files = decode(bundle.script);
    expect(Object.keys(files).sort()).toEqual([...BUNDLE_FILES, "Caddyfile"].sort());
    for (const name of BUNDLE_FILES) expect(files[name], name).toBe(serverFile(WEB, name));
    expect(files.Caddyfile).toBe(bundle.caddyfile);
    const lines = bundle.script.trimEnd().split("\n");
    expect(lines.at(-1)).toBe("ripple_bundle 24.15.0 17");
    // one function, called last: bash has read everything before anything runs
    expect(lines.filter((l) => l === "ripple_bundle() {")).toHaveLength(1);
    expect(bundle.script).toContain('bash "$D/provision.sh" "$@" </dev/null');
  });

  it("holds nothing secret, whatever the deploy file has", () => {
    const f = fullDeploy();
    const bundle = buildBundle(ctxOf(f), "24.15.0", "17");
    const everything = bundle.script + Object.values(decode(bundle.script)).join("\n");
    for (const [name, value] of Object.entries({ ...APP_EXTRA, SUPABASE_SERVICE_KEY: f.values.SUPABASE_SERVICE_KEY, SUPABASE_DB_URL: f.values.SUPABASE_DB_URL })) expect(everything.includes(value), name).toBe(false);
  });

  it("refuses versions that are not version numbers (they end up on a command line)", () => {
    const ctx = ctxOf(fakeFiles());
    expect(() => buildBundle(ctx, "24; rm -rf /", "17")).toThrow(/--node-version/);
    expect(() => buildBundle(ctx, "24.15.0", "17 && true")).toThrow(/--pg-major/);
  });

  it("every file of the server folder that provision.sh installs is in the bundle", () => {
    const installed = [...serverFile(WEB, "provision.sh").matchAll(/^\s*(?:if )?put \d{4} (\S+) /gm)].map((m) => m[1]).filter((n) => !n.startsWith('"'));
    const looped = /for unit in ([^;]+); do/.exec(serverFile(WEB, "provision.sh"))![1].trim().split(/\s+/);
    for (const name of [...installed, ...looped]) expect([...BUNDLE_FILES, "Caddyfile"], name).toContain(name);
  });
});

describe("provision (the local starter)", () => {
  const go = async (f: ReturnType<typeof fakeFiles>, argv: string[]) => {
    const out = quietOutput();
    const r = fakeRunner();
    const code = await provision([...argv, ...f.flags], out, r.run, WEB);
    return { code, text: out.text(), calls: r.calls };
  };

  it("does nothing without --yes and nothing in a dry run; the plan names values, the owner's part is spelled out", async () => {
    const f = fakeFiles();
    const refused = await go(f, []);
    expect(refused.code).toBe(2);
    expect(refused.calls).toHaveLength(0);
    const dry = await go(f, ["--dry-run"]);
    expect(dry.code).toBe(0);
    expect(dry.calls).toHaveLength(0);
    expect(dry.text).toContain('ssh -i <DEPLOY_SSH_KEY> <DEPLOY_USER>@<DEPLOY_HOST> "sudo -n bash -s"');
    expect(dry.text).toContain("<DEPLOY_ORIGIN_DOMAIN> {");
    expect(dry.text).toContain("header_up Host <DEPLOY_APP_DOMAIN>");
    expect(dry.text).toMatch(/never changes the SSH server's configuration and never touches a firewall/);
    expect(dry.text).toMatch(/Lighthouse console firewall: TCP 80 and TCP 443 open to everyone/);
    expect(dry.text).toMatch(/PasswordAuthentication no/);
    expectNoLeak(dry.text, f);
  });

  it("with --yes: one ssh command as the deploy file's user to its host, the bundle on standard input", async () => {
    const f = fakeFiles();
    const res = await go(f, ["--yes"]);
    expect(res.code).toBe(0);
    expect(res.calls).toHaveLength(1);
    const call = res.calls[0];
    expect(call.bin).toBe("ssh");
    expect(call.args.at(-1)).toBe("sudo -n bash -s");
    expect(call.args.at(-2)).toBe(`${f.values.DEPLOY_USER}@${f.values.DEPLOY_HOST}`);
    expect(call.args).toEqual(expect.arrayContaining(["-i", f.values.DEPLOY_SSH_KEY, "BatchMode=yes", "IdentitiesOnly=yes"]));
    expect(call.args.join(" ")).not.toContain("StrictHostKeyChecking");
    expect(String(call.stdin)).toContain("ripple_bundle 24.15.0 17");
    const first = await go(f, ["--yes", "--accept-new-host-key", "--pg-major", "18"]);
    expect(first.calls[0].args).toContain("StrictHostKeyChecking=accept-new");
    expect(String(first.calls[0].stdin)).toContain("ripple_bundle 24.15.0 18");
  });

  it("refuses when the way to the server is missing or malformed, and when --host names another server", async () => {
    const noHost = await go(fakeFiles({ DEPLOY_HOST: null }), ["--yes"]);
    expect(noHost.code).toBe(2);
    expect(noHost.text).toMatch(/DEPLOY_HOST is not set/);
    const noKey = await go(fakeFiles({ DEPLOY_SSH_KEY: "/no/such/key-zz.pem" }), ["--yes"]);
    expect(noKey.text).toMatch(/DEPLOY_SSH_KEY names a file that does not exist/);
    const badDomain = await go(fakeFiles({ DEPLOY_ORIGIN_DOMAIN: "origin.example.com/path" }), ["--yes"]);
    expect(badDomain.text).toMatch(/DEPLOY_ORIGIN_DOMAIN is not a host name/);
    const other = await go(fakeFiles(), ["--yes", "--host", "198.51.100.9"]);
    expect(other.text).toMatch(/--host is not the DEPLOY_HOST/);
    for (const res of [noHost, noKey, badDomain, other]) expect(res.calls).toHaveLength(0);
  });
});

describe("the files that run on the server", () => {
  const names = readdirSync(SERVER).filter((n) => !n.startsWith("."));

  it("have Unix line ends as the scripts read them, and the folder asks git for them", () => {
    for (const name of names) expect(serverFile(WEB, name).includes("\r"), name).toBe(false);
    expect(readFileSync(path.join(SERVER, ".gitattributes"), "utf8")).toMatch(/^\* text eol=lf$/m);
  });

  it("provision.sh mentions SSH settings and firewalls only in what it prints for the owner, or to read them", () => {
    const lines = serverFile(WEB, "provision.sh").split("\n");
    const touchy = lines.filter((l) => /sshd|ssh_config|PasswordAuthentication|PermitRootLogin|\bufw\b|iptables|nft\b|firewall/i.test(l));
    expect(touchy.length).toBeGreaterThan(3);
    for (const line of touchy) {
      const t = line.trim();
      const printed = t.startsWith("#") || t.startsWith('say "');
      const readOnly = /^\(sshd -T /.test(t);
      expect(printed || readOnly, t).toBe(true);
    }
  });

  it("provision.sh never writes one of the secret files", () => {
    const lines = serverFile(WEB, "provision.sh").split("\n");
    const about = lines.filter((l) => /web\.env|backup\.env|backup\.age\.pub|edge\.env/.test(l));
    for (const line of about) {
      const t = line.trim();
      const harmless = t.startsWith("#") || t.startsWith('say "') || /^if \[ -f "\$R\/etc\/caddy\/edge\.env" \] && grep -Eq /.test(t);
      expect(harmless, t).toBe(true);
    }
  });

  it("the app's unit listens on the loopback address only, as the service user, with the environment file root reads", () => {
    const unit = serverFile(WEB, "ripple-web.service");
    expect(unit).toContain("ExecStart=/usr/local/bin/node node_modules/next/dist/bin/next start -p 3200 -H 127.0.0.1");
    expect(unit).toContain("User=ripple");
    expect(unit).toContain("EnvironmentFile=/etc/ripple/web.env");
    expect(unit).toContain("WorkingDirectory=/srv/ripple/current");
    expect(unit).toMatch(/ProtectSystem=strict[\s\S]*ReadWritePaths=\/srv\/ripple/);
    expect(unit).toContain("TZ=Asia/Singapore");
  });

  it("Caddy cannot start without a usable origin lock", () => {
    const dropIn = serverFile(WEB, "caddy-ripple.conf");
    // no "-" in front: a missing file stops the unit
    expect(dropIn).toMatch(/^EnvironmentFile=\/etc\/caddy\/edge\.env$/m);
    expect(dropIn).toMatch(/^ExecStartPre=\/usr\/local\/lib\/ripple\/check-edge-secret\.sh$/m);
    // the packaged unit's --environ would print the origin lock into the journal: the drop-in starts Caddy without it
    expect(dropIn).toMatch(/^ExecStart=\nExecStart=\/usr\/bin\/caddy run --config \/etc\/caddy\/Caddyfile$/m);
    expect(dropIn).not.toContain("--environ ");
  });

  it("a Caddy apt source that cannot be read is taken out again, and Ubuntu's package is installed (first real run, 2026-10-11)", () => {
    const sh = serverFile(WEB, "provision.sh");
    const step = sh.slice(sh.indexOf("5. Caddy"), sh.indexOf("6. the PostgreSQL client"));
    // the source is only kept when apt could read it; otherwise both of its files go before anything else uses apt
    expect(step).toMatch(/&& apt-get update -q <\/dev\/null; then/);
    expect(step).toMatch(/else\n\s+rm -f "\$CADDY_KEY" "\$CADDY_LIST"\n\s+apt-get update -q <\/dev\/null\n/);
    expect(step.indexOf('rm -f "$CADDY_KEY" "$CADDY_LIST"')).toBeLessThan(step.indexOf("apt_install caddy"));
    // second real run: the list left by the failed run broke the script's first update; that step retries without it
    const updates = sh.slice(sh.indexOf("2. updates"), sh.indexOf("3. swap"));
    expect(updates).toMatch(/if ! apt-get update -q <\/dev\/null; then\n\s+if \[ -f "\$CADDY_LIST" \]; then\n\s+rm -f "\$CADDY_KEY" "\$CADDY_LIST"\n[^\n]*\n\s+apt-get update -q <\/dev\/null\n\s+else\n[^\n]*\n\s+exit 1/);
  });

  it("the timers run at 03:00 and 04:00 Singapore time and the check waits for the backup", () => {
    expect(serverFile(WEB, "ripple-backup.timer")).toContain("OnCalendar=*-*-* 03:00:00 Asia/Singapore");
    expect(serverFile(WEB, "ripple-backup-check.timer")).toContain("OnCalendar=*-*-* 04:00:00 Asia/Singapore");
    expect(serverFile(WEB, "ripple-backup-check.service")).toMatch(/^After=.*ripple-backup\.service/m);
  });
});
