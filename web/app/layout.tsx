import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./ripple-ui.css";
import "./ripple-auth.css"; // fe-auth (only add): the welcome, log-in, sign-up and recovery screens, derived from the iOS app
import "./motion.css"; // the motion pass (owner 10-14, 「仿 iOS」): pages slide, taps dip, sheets rise; after the foundation's rules
// fe-desk (only add): the phone pages on a computer, a column in the middle of a wide window; and the note beside it
import "./desktop.css";
import { DeskNote } from "@/components/desktop/DeskNote";
import { rpFontVariables } from "@/lib/ui/fonts";
// C2 track I (only add): Android's install offer is caught once for the whole app (real-app 2.6 「装到主屏」)
import Script from "next/script";
import { INSTALL_CATCH_SCRIPT } from "@/lib/push/install-script";
import { NavProgress } from "@/components/site/NavProgress"; // fe-12 (only add): the mark that the next page is on its way

export const metadata: Metadata = {
  title: "Ripple · visit companion",
  description:
    "Keeps what the doctor and pharmacist said, restates only cited words at home, and carries questions to the next visit.",
  // track I's web app manifest on every page, so the app installs (and an iPhone can add it to the home screen) from anywhere
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#F5F7F8",
};

// Light theme is the default (v3). Dark tokens exist under [data-theme="dark"] but are not enabled.
// Patient pages set lang="zh-Hans" on their own root (see components/PhoneShell.tsx).
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" data-theme="light" className={`h-full antialiased ${rpFontVariables}`}>
      <body className="min-h-full">
        {/* C2 track I (only add): before any page code, so an offer made on an earlier page is not lost */}
        <Script id="rp-install-catch" strategy="beforeInteractive">
          {INSTALL_CATCH_SCRIPT}
        </Script>
        <NavProgress />
        {children}
        {/* fe-desk (only add): nothing on the server; in a wide window, on a phone page, a note beside the column */}
        <DeskNote />
      </body>
    </html>
  );
}
