"use client";

import { ViewTransition, type ReactNode } from "react";
import { SCREEN_NAME, SCREEN_SHARE } from "@/lib/ui/nav-motion";

/** Where a view-transition group stands from the top of the window: the groups are placed by their transform alone. */
function topOf(transform: unknown): number {
  if (typeof transform !== "string" || !transform || transform === "none") return 0;
  try {
    return new DOMMatrixReadOnly(transform).m42;
  } catch {
    return 0;
  }
}

/**
 * The old screen's picture stays where it was on the window. The browser draws the old and the new picture of a pair in
 * one group and moves that group from where the old screen stood to where the new one stands: a page he had scrolled
 * down would travel up the window as it slides away. So the group is put where the new screen stands at once, and the
 * old picture is held at its own place by --rpmo-dy (app/motion.css), the difference between the two, read from the
 * group's own first frame. Called once for each screen of the pair (the second call finds nothing left to do); the
 * variable goes when the motion has ended. Without any of this (a browser that does not say), the pictures still move,
 * only a scrolled page's old picture travels with its group.
 */
function holdOldInPlace(): (() => void) | void {
  const root = document.documentElement;
  const group = `::view-transition-group(${SCREEN_NAME})`;
  const morph = root.getAnimations({ subtree: true }).find((a) => a.effect instanceof KeyframeEffect && a.effect.pseudoElement === group);
  if (!morph || !(morph.effect instanceof KeyframeEffect)) return;
  const from = topOf(morph.effect.getKeyframes()[0]?.transform);
  morph.cancel();
  const to = topOf(getComputedStyle(root, group).transform);
  root.style.setProperty("--rpmo-dy", `${from - to}px`);
  return () => root.style.removeProperty("--rpmo-dy");
}

/**
 * The motion between two phone screens (owner, 10-14: 「仿 iOS 的做就可以了」). Wraps a screen's root element; the screen
 * shells do it (components/ui Screen, family-ui FamilyScreen, auth-ui AuthScreen), so every page has it without a line
 * of its own.
 *
 * Every screen carries the same name, so the screen that leaves and the one that arrives in a navigation are a pair
 * (React's "share"), wherever each stands in its page's tree (lib/ui/nav-motion.ts SCREEN_NAME). The class of the pair
 * comes from the navigation's type (a link's `nav`), and app/motion.css animates the two pictures by it. Every other
 * change (a navigation without a type, router.refresh, a server action, the browser's own back, a ?query of the same
 * page) is "none": the page changes as it always did. Nothing is added to the page: <ViewTransition> draws no element
 * of its own, and the screen carries the name only while it moves.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  return (
    <ViewTransition name={SCREEN_NAME} share={SCREEN_SHARE} default="none" onShare={holdOldInPlace}>
      {children}
    </ViewTransition>
  );
}
