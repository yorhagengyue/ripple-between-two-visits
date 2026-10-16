/** The store contract (tests/contract/store.contract.ts) against the in-memory store. Always runs. */
import { MemoryStore } from "@/lib/store/memory";
import { describeStoreContract } from "../../contract/store.contract";

describeStoreContract("memory", {
  create: ({ now }) => new MemoryStore({ now }),
  sharedDatabase: false,
});
