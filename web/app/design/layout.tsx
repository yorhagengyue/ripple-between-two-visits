import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./design.css";

export const metadata: Metadata = {
  title: "Ripple UI · design",
  description: "Component sheet of the approved minimal direction (docs/design/direction.md).",
  robots: { index: false, follow: false },
};

/** /design and /design/today/*: the component gallery. Not linked from any navigation. */
export default function DesignLayout({ children }: { children: ReactNode }) {
  return children;
}
