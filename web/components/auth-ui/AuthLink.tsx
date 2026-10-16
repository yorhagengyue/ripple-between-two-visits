import Link from "next/link";
import type { AnchorHTMLAttributes } from "react";
import { navTypes, type NavMotion } from "@/lib/ui/nav-motion";
import { isAppRoute } from "@/lib/ui/props";

export type AuthLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string;
  /** how the screen moves when the page opens (lib/ui/nav-motion.ts): deeper, or back */
  nav?: NavMotion;
};

/** next/link for the app's own pages; a plain <a> for API routes (the language cookie), other sites and a new tab. */
export function AuthLink({ href, nav, ...rest }: AuthLinkProps) {
  if (isAppRoute(href) && rest.target !== "_blank") return <Link href={href} transitionTypes={navTypes(nav)} {...rest} />;
  return <a href={href} {...rest} />;
}
