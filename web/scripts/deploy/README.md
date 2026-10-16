# Deploying Ripple C2

These scripts put the app on one always-on server: Tencent Lighthouse (Singapore, Ubuntu 24.04) behind EdgeOne, with its own Supabase project in Singapore. The design is `docs/plan/hosting.md`; where that plan and these scripts differ, `web/progress/p.md` lists the differences.

Run every script from `web/`:

```
npx tsx scripts/deploy/<name>.ts [options] --dry-run      print the exact plan, touch nothing
npx tsx scripts/deploy/<name>.ts [options] --yes          do it
```

Rules every script keeps:

- Without `--yes` a script that changes anything prints its plan and stops (exit code 2). `--dry-run` connects to nothing and writes nothing. An option a script does not know stops it.
- Settings come from `web/.env.deploy` only (template: `env.deploy.example`). The scripts print names, never values: a value shows as `<NAME>`, and the output of every tool they start goes through the same hiding.
- The server is the one the deploy file names (`DEPLOY_USER@DEPLOY_HOST`); the database is the one the deploy file names, and never the test project of `web/.env`: a production address, connection string or key equal to the test one stops the script.
- ssh runs in batch mode and sudo with `-n`: a script fails instead of waiting for an answer. File contents and scripts travel through ssh's standard input, never on a command line.
- No script changes the SSH server's configuration or a firewall.

Exit codes: 0 done; 1 a step failed; 2 refused, nothing was done; 3 failed and put back as it was; 4 failed with nothing to put back.

## A first deployment, in order

| # | Who | Step | What it changes | Undo |
|---|---|---|---|---|
| 1 | owner, by hand | In `web/.env.deploy` add `RIPPLE_DEEPSEEK_API_KEY` and `AUTH_USERNAME_DOMAIN` (a name under the app's own domain that receives no mail; it cannot change after the first account). | the local file | edit the file |
| 2 | `check-env.ts` | Says by name what is set, what each step still needs, what is malformed. | nothing | nothing to undo |
| 3 | `check-env.ts --create-secrets --yes` | Creates the secrets this computer can make (origin lock, signing and account secrets, push key pair) and appends them to the deploy file, not showing them. | the local file | delete the appended lines, only before anything was pushed |
| 4 | owner, by hand | Lighthouse console firewall: open TCP 80 and 443 to everyone; TCP 22 only from the owner's address; remove other default rules. | the instance's firewall | remove the rules |
| 5 | owner, by hand | Connect once: `ssh -i <key> ubuntu@<server>` and compare the host key fingerprint with the console's. (Or pass `--accept-new-host-key` to the next step.) | this computer's `known_hosts` | `ssh-keygen -R <server>` |
| 6 | `provision.ts --yes` | On the server: time zone Asia/Singapore, updates, 2 GB swap, Node 24, Caddy, PostgreSQL 17 client, age, rclone, user `ripple`, folders, systemd units, Caddy's configuration, journal limits. Caddy stays stopped, the app is not started. Can be run again. | the server | restore a snapshot or reinstall the instance |
| 7 | owner, by hand | What step 6 printed at its end: SSH key-only login and no root login if not already so; a snapshot in the Lighthouse console. | the server's SSH settings; a snapshot | remove `/etc/ssh/sshd_config.d/60-ripple.conf` and reload ssh |
| 8 | owner says yes, then `prod-db.ts migrate --yes` | Applies every migration to the production database. | the production database | none (a new, empty project: delete and recreate the project) |
| 9 | `prod-db.ts setup-storage --yes` | Creates the private buckets `audio` and `labels`. | the production project's storage | delete the buckets in the dashboard |
| 10 | `prod-db.ts inspect --rls --yes`, `prod-db.ts privileges --yes` | Read the catalog: row level security on every table, no policy, nothing for `anon` / `authenticated`. | nothing | nothing to undo |
| 11 | owner, by hand | Supabase dashboard, Authentication: the settings in "Sign-in service" below. | the production project's sign-in service | set them back |
| 12 | `push-secrets.ts --only edge --yes` | `/etc/caddy/edge.env` (the origin lock); restarts Caddy, which then gets its certificate for the origin name. | the server | `push-secrets.ts --restore-prev --only edge --yes` |
| 13 | `push-env.ts --speech <mock\|whisper\|tencent> --tts <mock\|trtc> --yes` | `/etc/ripple/web.env` and what the app must report. Nothing is restarted before the first release. | the server | `push-env.ts --restore-prev --yes` |
| 14 | `release.ts --commit <sha> --skip-public-check --yes` | Packs the pushed commit (branch `c2-real` unless `--branch`), builds it on the server as `ripple`, switches, restarts, checks health and the build id on the server. | the server: a new version runs | `rollback.ts --yes` once there is an older version; the first one: `sudo systemctl stop ripple-web` on the server |
| 15 | owner, by hand | EdgeOne: the site, the domain and the four rules in "EdgeOne" below. The value of `X-Ripple-Edge` is `EDGE_SECRET`: open `web/.env.deploy` in an editor and copy it. | the EdgeOne site | change or delete the rules |
| 16 | `edge-check.ts --speech <...> --tts <...> --yes` | Eleven checks through the public name. Opens one throwaway demo sandbox (it expires after 48 h). | one sandbox row in the production database | it expires by itself |
| 17 | `prod-db.ts preflight --yes` | The older preflight against the deployment: session, events, a 4 MB upload, the store round trip. Its two model lines describe this computer, not the deployment. | a sandbox (48 h) on the deployment; a session and a small file that it removes again | they expire or are removed by the script |
| 18 | owner, by hand | Two phones in one session, one ticks a dose, the other follows within a second; the main question is answered within four seconds. | nothing | nothing to undo |
| 19 | owner, by hand, then `push-secrets.ts --only backup --yes` | The bucket, the key pair and the heartbeat of "Backups" below, written into the deploy file; then the script puts `/etc/ripple/backup.env` and `/etc/ripple/backup.age.pub` on the server. | the server | `push-secrets.ts --restore-prev --only backup --yes` |
| 20 | owner, by hand | First backup: on the server `sudo systemctl start ripple-backup.service`, then `sudo systemctl start ripple-backup-check.service`; `status.ts` shows both results. | two objects in the bucket | they expire by the bucket's rule |
| 21 | owner, with `backup-verify.ts --file <downloaded .dump.age> --identity <key file> --restore` | The restore drill on the owner's computer. | a scratch database on that computer, dropped again | it cleans up after itself |
| 22 | owner, by hand | An outside monitor that requests `https://<public name>/api/health` every five minutes; CPU and memory alarms in the Lighthouse console. | the monitoring account | delete the checks |

Later releases: `release.ts --commit <sha> --yes` (with the public check). Later migrations: on the server `sudo systemctl start ripple-backup.service` first, then, after the owner's nod, `prod-db.ts migrate --yes`, then the release; `release.ts` stops at a pending migration and never applies one.

## The scripts

| Script | What it does | It refuses |
|---|---|---|
| `check-env.ts [--speech ...] [--tts ...] [--create-secrets --yes]` | Reads the deploy file; names only. | nothing; exit code 1 on a malformed value, a name problem, or the test project |
| `provision.ts [--node-version 24.15.0] [--pg-major 17] [--accept-new-host-key]` | Sends `server/provision.sh` and the files it installs as one bundle and runs it as root. | a missing or malformed way to the server; it never writes the secret files, never changes SSH or a firewall |
| `prod-db.ts <migrate [--status]\|inspect [--rls\|--counts --actor <who> --reason "<why>"]\|setup-storage\|privileges\|preflight>` | Runs the existing database scripts with the production project's four variables in the child's environment. | one of the four missing; any of them equal to the test project's; a connection string for another project than the address; `--counts` without who and why; a `--url` that is not the public name |
| `push-env.ts --speech mock\|whisper\|tencent --tts mock\|trtc [--restore-prev]` | Writes `/etc/ripple/web.env`, keeps the previous copy, restarts, compares `/api/health` with what was pushed, puts the previous file back on a difference. | missing switches; a result the app would not start with or run as intended (checked with the app's own code: store, file driver, sign-in, main model and its key, checker, speech, read-aloud, the account secrets, the origin lock, the push key pair); a value that contradicts what the script writes; the test project; unknown or `[not deployed]` names |
| `push-secrets.ts [--only edge\|backup] [--restore-prev]` | Writes `edge.env`, `backup.env`, `backup.age.pub`, each keeping its previous copy; restarts Caddy and checks it runs. | a short or malformed `EDGE_SECRET`; a public key that is not an age key; incomplete backup settings; a heartbeat address that is not https; the test database |
| `release.ts --commit <sha> [--branch c2-real] [--skip-public-check]` | One release; switches back by itself on failure; keeps five versions. | a modified checkout; a commit that is not on `origin/<branch>`; a pending migration; it never applies a migration |
| `rollback.ts [--to <release>]` | Switches to the version before (or the named one), restarts, checks; switches back if that fails. | an unknown release name; it never touches the database |
| `status.ts` | Reads the server's state (read-only, no `--yes`). | it never opens an environment file |
| `edge-check.ts [--url ...] [--speech ...] [--tts ...]` | The eleven go-live checks. | a `--url` that is not the public name; it never sends the origin lock and never posts to the sign-in service |
| `backup-verify.ts --file <.age> --identity <key file> [--restore]` | Decrypts a downloaded backup on the owner's computer, reads it, optionally restores into a scratch database there. | a private key that is not the pair of the public one; any restore target but this computer |
| `server/backup.mjs`, `server/backup-check.mjs` (on the server, timers at 03:00 and 04:00 Singapore time) | The daily backup of the database (schemas `public` and `auth`) and of the two buckets, encrypted, to COS; the daily check. | a `pg_dump` older than the database; a dump that cannot be read back or has no accounts in it; any delete or overwrite in the bucket. Both say "not configured" and end well until the settings and the public key exist |

The two decisions still open are switches of `push-env.ts`, required on every run, and never assumed:

- `--speech mock`: no transcription service. A recorded visit is saved, and its page says the text comes once a service is connected. `--speech whisper` needs `WHISPER_URL` (https) and `WHISPER_TOKEN`. `--speech tencent` (Tencent Cloud speech recognition, the owner's decision of 2026-10-14) needs `TENCENT_SECRET_ID` and `TENCENT_SECRET_KEY` (the same pair as `--tts trtc`); `TENCENT_ASR_REGION` (default `ap-singapore`) and `TENCENT_ASR_ENGINE` (default `16k_zh_large`) are optional. Check the pair first with `npx tsx scripts/asr/tencent-check.ts` (one short clip, no value printed).
- `--tts mock`: no real voice; accounts get no read-aloud button. `--tts trtc` needs `TRTC_SDK_APP_ID`, `TENCENT_SECRET_ID`, `TENCENT_SECRET_KEY`.

## Only the owner can do these

### Lighthouse

- Firewall of the instance (console): TCP 80 and TCP 443 from everywhere (Caddy needs both to get and renew the origin name's certificate), TCP 22 from the owner's own address only, other default rules (3389) removed. When the owner's address changes, the scripts cannot connect until the rule is updated.
- SSH: key login only, no root login. `provision.sh` prints the current settings and the two commands; it does not run them.
- A snapshot after `provision.ts`, and before every system upgrade.

### DNS

- `app.<domain>`: CNAME to the name EdgeOne gives. `origin.<domain>`: A record to the server's address, not accelerated.

### EdgeOne (Personal plan, CNAME access, acceleration region "Global (excluding Chinese mainland)")

Domain `app.<domain>`:

- origin type IP/Domain: `origin.<domain>`; origin protocol HTTPS, port 443; origin HOST header: use the origin domain;
- HTTPS: the free certificate for `app.<domain>`; HTTP to HTTPS redirect on. HSTS after a stable week.

Rule engine, in this order from top to bottom (a lower rule overrides an upper one for the requests it matches):

| # | Condition | Operation | Value |
|---|---|---|---|
| 1 | HOST equals `app.<domain>` | Origin timeout, HTTP response timeout | 120 seconds (the default of 15 cuts the event stream and long answers: 524) |
| 1 | the same rule | Modify HTTP origin request header: **Set** (not Add) | name `X-Ripple-Edge`, value: the `EDGE_SECRET` of `web/.env.deploy` |
| 2 | HOST equals `app.<domain>` | Node cache | no cache |
| 3 | URL path `/_next/static/*` | Node cache | follow origin (it must sit below rule 2) |
| 4 | URL path `/api/events` | Smart compression | off |

Not switched on: WebSocket, HTTP/2 to the origin, HTTP/3.

Changing `EDGE_SECRET` later: change the value in rule 1 first, then run `push-secrets.ts --only edge --yes` and `push-env.ts ... --yes` at once (the app reads the same value to know which requests came through the edge); between the two every request is answered 403.

### Sign-in service (Supabase dashboard of the production project, Authentication)

| Setting | Value | Checked by |
|---|---|---|
| Allow new users to sign up | off (accounts are created by the app's server only) | `edge-check` signup-closed |
| Anonymous sign-ins | off | `edge-check` signup-closed |
| JWT signing keys | an asymmetric key (ES256) in use; no shared-secret (HS256) key left | `edge-check` auth-keys |
| Access token lifetime | 900 seconds | by eye (the app keeps its own 15 minutes whatever this is) |
| Refresh token rotation | on, reuse interval 10 seconds | by eye |
| Minimum password length | 8 | by eye |

### Backups

- A private COS bucket in the server's region with **versioning switched on first** (it cannot be switched off again), and a lifecycle rule: current versions expire after 14 days, older versions are deleted 7 days after they became old, expired delete markers are removed.
- A sub-account key whose policy covers this bucket only and allows: `PutObject`, the multipart upload actions (`InitiateMultipartUpload`, `UploadPart`, `CompleteMultipartUpload`, `AbortMultipartUpload`, `ListParts`), `HeadObject`, `GetObject`, `GetBucket`, `GetBucketObjectVersions`. No delete action, no bucket configuration action. Build it with the console's policy generator; then try a delete with that key: it must be refused.
- An age key pair made on the owner's computer (`age-keygen -o ripple-backup.key`). The public half (`age1...`) goes into the deploy file as `BACKUP_AGE_RECIPIENT`; the private half stays offline or in a password manager, never on the server, never in the repository.
- A heartbeat check at an outside monitor (it writes to the owner when a day passes without a request): its https address is `BACKUP_HEARTBEAT_URL`.
- Each month, and before every production migration: download the newest `db/...dump.age` from the bucket and run `backup-verify.ts --file ... --identity ... --restore`.

### Accounts and money

- The DeepSeek key and its balance; the Lighthouse instance, the EdgeOne plan, the Supabase project's plan; the outside monitor's account.

## Where things are on the server

| Path | What | Written by |
|---|---|---|
| `/etc/ripple/web.env` (0600 root), `.prev` | the app's environment | `push-env.ts` |
| `/etc/ripple/web.expect.json` | what `/api/health` must answer (provider names) | `push-env.ts` |
| `/etc/caddy/edge.env` (0600 root), `.prev` | the origin lock for Caddy | `push-secrets.ts` |
| `/etc/ripple/backup.env` (0600 root), `/etc/ripple/backup.age.pub` | backup settings and public key | `push-secrets.ts` |
| `/etc/caddy/Caddyfile`, `/etc/systemd/system/ripple-*.{service,timer}`, `/usr/local/lib/ripple/` | configuration, units, the backup scripts | `provision.ts` |
| `/srv/ripple/releases/<time>-<commit>/`, `/srv/ripple/current` | the versions (five kept) and the link to the one running | `release.ts`, `rollback.ts` |
| `/srv/ripple/shared/` | the model spend ledger, the npm cache | the app, `release.ts` |
| `/var/lib/ripple-backup/last.json`, `last-check.json` | the last backup's and the last check's result | the backup services |

Logs: `journalctl -u ripple-web`, `-u caddy`, `-u ripple-backup`, `-u ripple-backup-check` (14 days, at most 1 GB).
