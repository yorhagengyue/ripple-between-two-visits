import { describe, expect, it } from "vitest";
import { barsFor, DEAD_AFTER_MS } from "@/components/visit/elder/MicCheck";
import { MIC_SILENT_PEAK } from "@/components/visit/useWavRecorder";

describe("the microphone check on the recording screen (10-15)", () => {
  it("five bars from -60 dBFS (none) to -10 dBFS (all)", () => {
    expect(barsFor(0)).toBe(0);
    expect(barsFor(0.001)).toBe(0); // -60 dBFS
    expect(barsFor(10 ** (-30 / 20))).toBe(3); // -30 dBFS
    expect(barsFor(0.5)).toBe(5);
    expect(barsFor(1)).toBe(5);
  });

  it("all zeros for three seconds is a microphone that sends nothing; a quiet room is far above the line", () => {
    expect(DEAD_AFTER_MS).toBe(3000);
    expect(MIC_SILENT_PEAK).toBeLessThan(10 ** (-60 / 20)); // a room's noise at -60 dBFS is heard
    expect(MIC_SILENT_PEAK).toBeGreaterThan(0); // digital silence is not
  });
});
