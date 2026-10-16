/**
 * Create the two private Supabase Storage buckets the app uses (spec section 3), if missing:
 *   audio   audio/wav only, 50 MB per object
 *   labels  image/png, image/jpeg, image/webp, 10 MB per object
 * An existing bucket is set to the same settings (private, content types, size cap).
 *
 * Run from web/:  npx tsx scripts/setup-storage.ts
 * Reads web/.env (SUPABASE_URL, SUPABASE_SERVICE_KEY). Prints only bucket names and created / exists;
 * never a key, a URL or a response body. Exit code 1 on any failure.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { createSupabaseBlobStore, supabaseBlobConfig } from "../lib/blob/supabase";
import { BLOB_BUCKETS, BUCKET_CONFIG, BlobError } from "../lib/blob/types";

const WEB = path.resolve(__dirname, "..");

async function main(): Promise<number> {
  const envFile = path.join(WEB, ".env");
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const cfg = supabaseBlobConfig();
  if (!cfg) {
    for (const name of ["SUPABASE_URL", "SUPABASE_SERVICE_KEY"]) {
      console.log(`${name}: ${(process.env[name] ?? "").trim() ? "set" : "not set"}`);
    }
    console.log("Nothing done: both are needed.");
    return 1;
  }
  const store = createSupabaseBlobStore(cfg);
  let failed = 0;
  for (const bucket of BLOB_BUCKETS) {
    try {
      const result = await store.ensureBucket(BUCKET_CONFIG[bucket]);
      const isPublic = await store.bucketIsPublic(bucket);
      if (isPublic !== false) {
        console.log(`${bucket}: ${result}, but it is not private`);
        failed++;
      } else {
        console.log(`${bucket}: ${result}`);
      }
    } catch (err) {
      failed++;
      console.log(`${bucket}: failed (${err instanceof BlobError ? err.message : "unexpected error"})`);
    }
  }
  return failed ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  () => {
    console.log("setup-storage: unexpected error");
    process.exit(1);
  },
);
