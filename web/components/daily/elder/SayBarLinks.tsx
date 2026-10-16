import type { UiLocale } from "@/lib/ui/tokens";

/**
 * 「按一下说 / 打字」 on his screens other than Today (ux pass 10-12, round 8) is gone (owner's decision of 2026-10-14):
 * asking lives in 就诊 now, the ask screen (/p/ask) keeps its own field, and holding any of his records still opens
 * Ripple's read of it. A page that still hands this to its <Screen sayBar={…}> gets nothing drawn: the screen keeps no
 * room for a strip that is not there (app/ripple-ui.css reserves it only while a .rpu-say is on the screen). The strip
 * itself stays in components/ui/SayBar.tsx (the /design gallery draws it); no screen of his draws it.
 */
export const SayBarLinks: (props: { locale: UiLocale }) => null = () => null;
