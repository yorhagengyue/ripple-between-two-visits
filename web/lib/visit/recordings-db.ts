/**
 * The name of the browser database his visit recordings are kept in until they are uploaded (C2 track V). One place for
 * it: components/visit/elder/recording-store.ts opens it, lib/offline/forget.ts (track O) deletes it at logout in
 * browsers that cannot list their databases. Client-safe, no imports.
 */
export const RECORDINGS_DB = "ripple-recordings";
