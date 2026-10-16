/**
 * Type fixture for <Said>: compiled by `npm run typecheck` (tsconfig includes tests/**) and by
 * tests/unit/ui/said-source.test.ts. Every @ts-expect-error below must be an error; if <Said> ever
 * accepts a quote without a full source, the directive goes unused and the build fails.
 */
import { Said } from "@/components/ui/Said";

export const withSource = (
  <Said source={{ kind: "doctor", ref: "v2-u08" }} lang="en">
    “Please don&apos;t change the dose yourself.”
  </Said>
);

// @ts-expect-error a quote without a source does not compile
export const noSource = <Said lang="en">“Please don&apos;t change the dose yourself.”</Said>;

// @ts-expect-error source cannot be undefined either
export const undefinedSource = <Said source={undefined} lang="zh-Hans">「爸，早餐吃了吗？」</Said>;

// @ts-expect-error source has to say whose words they are
export const noKind = <Said source={{ ref: "v2-u08" }} lang="en">x</Said>;

// @ts-expect-error source has to name the record that holds the words
export const noRef = <Said source={{ kind: "family" }} lang="zh-Hans">x</Said>;

// @ts-expect-error Ripple's own words are never <Said>
export const rippleWords = <Said source={{ kind: "ripple", ref: "refer_doctor" }} lang="en">x</Said>;
