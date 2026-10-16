/** Shared setup for the M3 unit tests: a memory-store session, the local blob driver in a temp folder, captured events. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { BusEventType } from "@/lib/bus";
import { createLocalBlobStore } from "@/lib/blob";
import type { MedsDeps } from "@/lib/meds/write";
import { getMemoryStore } from "@/lib/store/memory";
import type { Store } from "@/lib/store/types";

export const FIXTURES = fileURLToPath(new URL("../../../fixtures/", import.meta.url));
export const LABELS = ["amlodipine", "ibuprofen", "relative_box"] as const;
export type LabelName = (typeof LABELS)[number];

export const labelPng = (name: LabelName): Uint8Array => new Uint8Array(readFileSync(path.join(FIXTURES, "labels", `${name}.png`)));
export const expectedLabel = (name: LabelName) => JSON.parse(readFileSync(path.join(FIXTURES, "labels", `${name}.expected.json`), "utf8"));
export const p1Fixture = () =>
  JSON.parse(readFileSync(path.join(FIXTURES, "visits", "p1.utterances.json"), "utf8")).utterances as {
    id: string;
    t_start_ms: number;
    t_end_ms: number;
    speaker_cluster: number;
    lang: string;
    text: string;
  }[];

export interface Published {
  type: BusEventType;
  say: string;
  data: unknown;
}

export interface Ctx {
  store: Store;
  sessionId: string;
  events: Published[];
  deps: MedsDeps;
  /** put a label photo in the session's labels folder, return its path */
  upload(name: LabelName, file?: string): Promise<string>;
}

export async function setup(blobDir: string, day = 29): Promise<Ctx> {
  const store = getMemoryStore();
  const session = await store.createSession({ story_day: day, ttl_hours: 1 });
  const events: Published[] = [];
  const blob = createLocalBlobStore({ dir: blobDir });
  const publish = (_sid: string, type: BusEventType, say: string, data: unknown) => void events.push({ type, say, data });
  const deps: MedsDeps = {
    store,
    blob,
    publish,
    vision: { env: { LLM_PROVIDER: "mock" } },
    ask: { publish, costGuard: null, checker: null, checkerReason: "no checker in unit tests" },
  };
  return {
    store,
    sessionId: session.id,
    events,
    deps,
    async upload(name, file = `${name}-${Math.random().toString(36).slice(2)}.png`) {
      const p = `${session.id}/labels/${file}`;
      await blob.putObject("labels", p, labelPng(name), "image/png");
      return p;
    },
  };
}
