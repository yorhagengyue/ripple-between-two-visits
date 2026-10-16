import Link from "next/link";
import type { AnchorHTMLAttributes } from "react";
import { navTypes, type NavMotion } from "@/lib/ui/nav-motion";
import { isAppRoute } from "@/lib/ui/props";

export type UiLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string;
  /** how the screen moves when the page opens (lib/ui/nav-motion.ts): deeper, back, or a place of the bottom bar */
  nav?: NavMotion;
};

/**
 * next/link for app pages, a plain <a> for API routes (audio clips), tel:, # and other sites. `nav` says which way the
 * screen moves when the page opens (the next/link's transitionTypes); without it, as on a plain <a>, nothing moves.
 */
export function UiLink({ href, nav, ...rest }: UiLinkProps) {
  if (isAppRoute(href)) return <Link href={href} transitionTypes={navTypes(nav)} {...rest} />;
  return <a href={href} {...rest} />;
}
