"use client";

import { AlertCircle, Loader2 } from "lucide-react";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changePassword, type PasswordState } from "@/server/actions/auth";

export function PasswordForm({ next, email }: { next?: string; email: string }) {
  const [state, action, pending] = useActionState<PasswordState, FormData>(changePassword, undefined);
  const invalid = (field: NonNullable<PasswordState>["field"]) => (state?.field === field ? true : undefined);
  return (
    <form action={action} className="mt-6 space-y-4" noValidate>
      {next && <input type="hidden" name="next" value={next} />}
      {/* Lets password managers file the new password under the right account. */}
      <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
      <div className="space-y-1.5">
        <Label htmlFor="current">Current password</Label>
        <Input className="h-10" id="current" name="current" type="password" autoComplete="current-password" required autoFocus aria-invalid={invalid("current")} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">New password</Label>
        <Input className="h-10" id="password" name="password" type="password" autoComplete="new-password" required minLength={12} aria-invalid={invalid("password")} aria-describedby="password-hint" />
        <p id="password-hint" className="text-2xs text-muted-foreground">
          At least 12 characters. A short sentence is easy to remember.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirm">Confirm new password</Label>
        <Input className="h-10" id="confirm" name="confirm" type="password" autoComplete="new-password" required aria-invalid={invalid("confirm")} />
      </div>
      {state?.error && (
        <p role="alert" className="flex items-start gap-1.5 rounded-md bg-critical-soft px-2.5 py-2 text-[13px] text-critical-ink">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {state.error}
        </p>
      )}
      <Button type="submit" className="h-10 w-full" disabled={pending}>
        {pending && <Loader2 className="animate-spin" />}
        Save new password
      </Button>
    </form>
  );
}
