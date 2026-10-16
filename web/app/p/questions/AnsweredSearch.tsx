"use client";

/**
 * The field over 「医生回答过的问题」 (ux pass 10-12, round 3): as he types, only the answered questions whose words hold
 * what he typed stay on the line (his question, the answer word for word, the checked Chinese under an English answer).
 * Nothing is sent anywhere: the page hands in every pair already drawn, with the words to look in. No match: one line
 * says so. The pairs stay direct children of the line (questions.css tells the line's ends by that).
 */
import { Fragment, useState, type ReactNode } from "react";
import { Box, Timeline } from "@/components/ui";

export interface AnsweredItem {
  id: string;
  /** everything that can be looked for in this pair, as one string */
  words: string;
  pair: ReactNode;
}

export function AnsweredSearch({ items, label, none }: { items: AnsweredItem[]; label: string; none: string }) {
  const [typed, setTyped] = useState("");
  const want = typed.trim().toLowerCase();
  const shown = want ? items.filter((it) => it.words.toLowerCase().includes(want)) : items;
  return (
    <>
      <div className="rpu rpu-field rp14q-search">
        <input
          type="text"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          className="rpu-field-input"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder={label}
          aria-label={label}
          data-testid="answered-search"
        />
      </div>
      {shown.length ? (
        <Timeline>
          {shown.map((it) => (
            <Fragment key={it.id}>{it.pair}</Fragment>
          ))}
        </Timeline>
      ) : (
        <Box variant="dash" testId="answered-search-none">
          {none}
        </Box>
      )}
    </>
  );
}
