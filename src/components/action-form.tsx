"use client";

import { createContext, useActionState, useContext, useEffect, useRef, startTransition, type ReactNode } from "react";
import clsx from "clsx";
import type { ActionState } from "@/lib/types";
import { buttonClass } from "./ui";

const PendingContext = createContext(false);

/**
 * Form bound to a server action returning { error } / { ok }. Submits via a
 * transition (so fields are not auto-reset on validation errors) and passes
 * the clicked submit button's name/value through.
 */
export function ActionForm({
  action,
  children,
  className,
  confirm,
  resetOnSuccess = false,
  hideOk = false,
}: {
  action: (state: ActionState, formData: FormData) => Promise<ActionState>;
  children: ReactNode;
  className?: string;
  confirm?: string;
  resetOnSuccess?: boolean;
  hideOk?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);

  return (
    <PendingContext value={pending}>
      <form
        ref={ref}
        className={className}
        onSubmit={(e) => {
          e.preventDefault();
          const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
          const message = submitter?.dataset.confirm ?? confirm;
          if (message && !window.confirm(message)) return;
          const formData = new FormData(e.currentTarget, submitter);
          startTransition(() => formAction(formData));
        }}
      >
        {children}
        {state?.error && (
          <p role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {state.error}
          </p>
        )}
        {state?.ok && !hideOk && (
          <p role="status" className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {state.ok}
          </p>
        )}
      </form>
    </PendingContext>
  );
}

export function SubmitButton({
  children,
  variant = "primary",
  size = "md",
  className,
  name,
  value,
  confirm,
}: {
  children: ReactNode;
  variant?: Parameters<typeof buttonClass>[0];
  size?: Parameters<typeof buttonClass>[1];
  className?: string;
  name?: string;
  value?: string;
  confirm?: string;
}) {
  const pending = useContext(PendingContext);
  return (
    <button
      type="submit"
      name={name}
      value={value}
      data-confirm={confirm}
      disabled={pending}
      className={buttonClass(variant, size, clsx(className, pending && "cursor-wait"))}
    >
      {pending && (
        <span className="size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden />
      )}
      {children}
    </button>
  );
}
