import type { ReactNode } from "react";
import { ListCard } from "@/components/ui/List";
import "./me.css";

/**
 * One white card of rows on 「我」 (the draft's `list`): a few <MeEntry> rows that belong together, a hairline between
 * them. `heading` is the grey label over the card, when a group needs a name.
 */
export function MeGroup({ heading, children, testId }: { heading?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <ListCard heading={heading} testId={testId}>
      {children}
    </ListCard>
  );
}
