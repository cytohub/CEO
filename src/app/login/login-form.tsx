"use client";

import { AlertCircle, Loader2 } from "lucide-react";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { login, type LoginState } from "@/server/actions/auth";

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, undefined);
  return (
    <form action={action} className="mt-6 space-y-4" noValidate>
      {next && <input type="hidden" name="next" value={next} />}
      <div className="space-y-1.5">
        <Label htmlFor="email">Work email</Label>
        <Input className="h-10" id="email" name="email" type="email" autoComplete="username" required defaultValue={state?.email} autoFocus={!state?.email} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input className="h-10" id="password" name="password" type="password" autoComplete="current-password" required autoFocus={Boolean(state?.email)} />
      </div>
      {state?.error && (
        <p role="alert" className="flex items-start gap-1.5 rounded-md bg-critical-soft px-2.5 py-2 text-[14px] text-critical-ink">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {state.error}
        </p>
      )}
      <Button type="submit" className="h-10 w-full" disabled={pending}>
        {pending && <Loader2 className="animate-spin" />}
        Sign in
      </Button>
    </form>
  );
}
