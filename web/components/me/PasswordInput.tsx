"use client";

/**
 * The draft's password field on the screens under 「我」 (line fe-me): the name above, 「显示密码」 inside the box on the
 * right (the words become 「隐藏密码」 while it shows), the error in red and the hint in grey under it. The foundation's
 * <Field> with the show / hide state; `testId` lands on the <input>. The class rpm-f (me.css) lets the input fill its
 * box, so the thing he taps is as tall as the box he sees.
 */
import { useState, type ReactNode } from "react";
import { Field } from "@/components/ui/Forms";
import "./me.css";

export function PasswordInput({
  id,
  label,
  value,
  onChange,
  words,
  newPassword = false,
  hint,
  error,
  testId,
  autoFocus,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  /** the two words of the button inside the box: 「显示密码」 / 「隐藏密码」 */
  words: { show: string; hide: string };
  newPassword?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
  testId?: string;
  autoFocus?: boolean;
}) {
  const [shown, setShown] = useState(false);
  return (
    <Field
      className="rpm-f"
      id={id}
      label={label}
      type={shown ? "text" : "password"}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      autoComplete={newPassword ? "new-password" : "current-password"}
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      autoFocus={autoFocus}
      hint={hint}
      error={error}
      data-testid={testId}
      end={{ label: shown ? words.hide : words.show, onClick: () => setShown(!shown), pressed: shown }}
    />
  );
}
