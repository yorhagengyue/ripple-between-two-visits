import { describe, expect, it } from "vitest";
import { DEFAULT_PATIENT_LOCALE, messages, otherLocale, t, toLocale, translator } from "@/lib/i18n";

describe("i18n", () => {
  it("defaults to English (owner 10-15: 「每次登录都默认英文，除非用户自己修改」) and has every key in both languages", () => {
    expect(DEFAULT_PATIENT_LOCALE).toBe("en");
    const enKeys = Object.keys(messages.en).sort();
    expect(Object.keys(messages["zh-Hans"]).sort()).toEqual(enKeys);
    for (const key of enKeys) expect(messages["zh-Hans"][key as keyof typeof messages.en]).not.toBe("");
  });

  it("looks up and fills placeholders", () => {
    expect(t("zh-Hans", "nav.meds")).toBe("我的药");
    expect(t("en", "nav.meds")).toBe("My medicines");
    expect(t("en", "common.dayN", { n: 29 })).toBe("Day 29");
    expect(t("zh-Hans", "common.dayN", { n: 29 })).toBe("第29天");
    expect(t("en", "common.dayN")).toBe("Day {n}");
    expect(translator("zh-Hans")("source.label")).toBe("药品标签");
  });

  it("normalises locale strings", () => {
    expect(toLocale("zh-SG", "en")).toBe("zh-Hans");
    expect(toLocale("en-SG", "zh-Hans")).toBe("en");
    expect(toLocale("fr", "zh-Hans")).toBe("zh-Hans");
    expect(toLocale(undefined, "en")).toBe("en");
    expect(otherLocale("zh-Hans")).toBe("en");
  });
});
