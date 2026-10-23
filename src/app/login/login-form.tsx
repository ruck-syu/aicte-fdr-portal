"use client";

import { useSearchParams } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Field } from "@/components/ui";
import { signIn } from "../auth-actions";

export function LoginForm() {
  const next = useSearchParams().get("next") ?? "";
  return (
    <ActionForm action={signIn} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <Field label="Email" htmlFor="email">
        <input id="email" name="email" type="email" autoComplete="username" required className="input" />
      </Field>
      <Field label="Password" htmlFor="password">
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="input"
        />
      </Field>
      <SubmitButton className="w-full">Sign in</SubmitButton>
    </ActionForm>
  );
}
