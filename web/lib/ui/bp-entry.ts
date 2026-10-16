/**
 * The blood-pressure keypad's state (components/ui/BpKeypad.tsx), kept pure so it is unit-tested: three rows like a
 * home monitor (SYS top number, DIA bottom number, PUL pulse, which may stay empty), digits typed into the active
 * row, "删一个" deletes one digit, "下一个" moves on, tapping a row selects it. Nothing here judges a reading.
 */

export type BpField = "sys" | "dia" | "pul";

export const BP_FIELDS: readonly BpField[] = ["sys", "dia", "pul"];

/** A row holds at most three digits (the monitor shows three). */
export const BP_MAX_DIGITS = 3;

export interface BpEntry {
  sys: string;
  dia: string;
  pul: string;
  active: BpField;
}

export type BpAction =
  | { type: "digit"; digit: string }
  | { type: "delete" }
  | { type: "next" }
  | { type: "select"; field: BpField }
  | { type: "reset"; entry?: Partial<BpEntry> };

export function bpInitial(entry: Partial<BpEntry> = {}): BpEntry {
  return {
    sys: clean(entry.sys),
    dia: clean(entry.dia),
    pul: clean(entry.pul),
    active: entry.active && BP_FIELDS.includes(entry.active) ? entry.active : "sys",
  };
}

function clean(v: string | undefined): string {
  return (v ?? "").replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, BP_MAX_DIGITS);
}

function nextField(field: BpField): BpField {
  return BP_FIELDS[Math.min(BP_FIELDS.indexOf(field) + 1, BP_FIELDS.length - 1)];
}

export function bpReducer(state: BpEntry, action: BpAction): BpEntry {
  switch (action.type) {
    case "digit": {
      if (!/^\d$/.test(action.digit)) return state;
      const current = state[state.active];
      if (current.length >= BP_MAX_DIGITS) return state;
      // a leading zero is never a reading; "0" on an empty row does nothing
      if (current === "" && action.digit === "0") return state;
      const value = current + action.digit;
      const full = value.length >= BP_MAX_DIGITS;
      // a full row moves on by itself, like the next number on the monitor; the pulse row stays
      return { ...state, [state.active]: value, active: full && state.active !== "pul" ? nextField(state.active) : state.active };
    }
    case "delete": {
      const current = state[state.active];
      if (current.length > 0) return { ...state, [state.active]: current.slice(0, -1) };
      // an empty row: step back to the row before and delete there (what a finger expects after an auto-move)
      const i = BP_FIELDS.indexOf(state.active);
      if (i === 0) return state;
      const prev = BP_FIELDS[i - 1];
      return { ...state, active: prev, [prev]: state[prev].slice(0, -1) };
    }
    case "next":
      return { ...state, active: state.active === "pul" ? "sys" : nextField(state.active) };
    case "select":
      return BP_FIELDS.includes(action.field) ? { ...state, active: action.field } : state;
    case "reset":
      return bpInitial(action.entry);
    default:
      return state;
  }
}

/** Both numbers are there: the reading can be saved (the pulse may stay empty). */
export function bpComplete(entry: BpEntry): boolean {
  return entry.sys.length >= 2 && entry.dia.length >= 2;
}

export interface BpReading {
  systolic: number;
  diastolic: number;
  pulse: number | null;
}

export function bpReading(entry: BpEntry): BpReading | null {
  if (!bpComplete(entry)) return null;
  return { systolic: Number(entry.sys), diastolic: Number(entry.dia), pulse: entry.pul ? Number(entry.pul) : null };
}
