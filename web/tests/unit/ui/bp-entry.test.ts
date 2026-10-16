/** The blood-pressure keypad's state (lib/ui/bp-entry.ts): like a home monitor, three rows, digits, delete, next. */
import { describe, expect, it } from "vitest";
import { bpComplete, bpInitial, bpReading, bpReducer, type BpAction, type BpEntry } from "@/lib/ui/bp-entry";

const run = (actions: BpAction[], from: BpEntry = bpInitial()) => actions.reduce(bpReducer, from);
const digits = (s: string): BpAction[] => [...s].map((d) => ({ type: "digit", digit: d }));

describe("bp keypad", () => {
  it("starts on the top number, empty", () => {
    expect(bpInitial()).toEqual({ sys: "", dia: "", pul: "", active: "sys" });
  });

  it("a full top number moves on to the bottom number by itself, as on the monitor", () => {
    const s = run(digits("138"));
    expect(s).toMatchObject({ sys: "138", active: "dia" });
    const t = run(digits("82"), s);
    expect(t).toMatchObject({ dia: "82", active: "dia" });
  });

  it("never more than three digits, never a leading zero", () => {
    expect(run(digits("0")).sys).toBe("");
    const s = run([...digits("88"), { type: "next" }, ...digits("1234")]);
    expect(s.dia).toBe("123");
  });

  it("下一个 moves on (pulse wraps back to the top); tapping a row selects it", () => {
    expect(run([{ type: "next" }]).active).toBe("dia");
    expect(run([{ type: "next" }, { type: "next" }, { type: "next" }]).active).toBe("sys");
    expect(run([{ type: "select", field: "pul" }]).active).toBe("pul");
  });

  it("删一个 deletes in the row; on an empty row it steps back and deletes there", () => {
    const s = run([...digits("138"), { type: "delete" }]);
    expect(s).toMatchObject({ sys: "13", dia: "", active: "sys" });
    expect(run([{ type: "delete" }])).toEqual(bpInitial());
  });

  it("saves only with both numbers; the pulse may stay empty", () => {
    const half = run(digits("138"));
    expect(bpComplete(half)).toBe(false);
    expect(bpReading(half)).toBeNull();
    const full = run([...digits("138"), ...digits("82")]);
    expect(bpReading(full)).toEqual({ systolic: 138, diastolic: 82, pulse: null });
    const withPulse = run([{ type: "select", field: "pul" }, ...digits("72")], full);
    expect(bpReading(withPulse)).toEqual({ systolic: 138, diastolic: 82, pulse: 72 });
  });

  it("an initial entry is cleaned (digits only, at most three)", () => {
    expect(bpInitial({ sys: "1a50", dia: "0095", active: "dia" })).toEqual({ sys: "150", dia: "95", pul: "", active: "dia" });
  });
});
