"use client";

import { Loader2, UserPlus } from "lucide-react";
import { useState } from "react";
import { Field, SimpleSelect } from "@/components/common/fields";
import { useAction } from "@/components/common/use-action";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { UserRole } from "@/generated/prisma/enums";
import { USER_ROLES } from "@/lib/intelligence";
import { cn } from "@/lib/utils";
import { createUser } from "@/server/actions/users";
import { OneTimePasswordDialog } from "./one-time-password";

const MIN_PASSWORD = 12;

export function CreateUserButton({ roles }: { roles: UserRole[] }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole>(roles.includes("TEAM_MEMBER") ? "TEAM_MEMBER" : roles[0]);
  const [mode, setMode] = useState<"generate" | "enter">("generate");
  const [password, setPassword] = useState("");
  const [shown, setShown] = useState<{ password: string; email: string } | null>(null);
  const [who, setWho] = useState("");
  const { pending, run } = useAction();

  const reset = () => {
    setName("");
    setEmail("");
    setPassword("");
    setMode("generate");
  };
  const passwordError = mode === "enter" && password.length > 0 && password.length < MIN_PASSWORD ? `Use at least ${MIN_PASSWORD} characters.` : null;
  const valid = name.trim() && /.+@.+\..+/.test(email.trim()) && (mode === "generate" || password.length >= MIN_PASSWORD);

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <UserPlus aria-hidden /> Add user
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) reset();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add user</DialogTitle>
            <DialogDescription>They sign in with this email. Their role decides what they can open and which sources they can read.</DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!valid) return;
              const res = await run(() => createUser({ name, email, role, password: mode === "enter" ? password : undefined }));
              if (res.ok) {
                setOpen(false);
                if (res.data.oneTimePassword) {
                  setWho(name.trim());
                  setShown({ password: res.data.oneTimePassword, email: email.trim().toLowerCase() });
                }
                reset();
              }
            }}
          >
            <Field label="Name" htmlFor="new-user-name">
              <Input id="new-user-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" required maxLength={120} />
            </Field>
            <Field label="Work email" htmlFor="new-user-email">
              <Input id="new-user-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" required maxLength={200} />
            </Field>
            <Field label="Role" htmlFor="new-user-role" hint={USER_ROLES[role].description}>
              <SimpleSelect id="new-user-role" value={role} onChange={(v) => v && setRole(v as UserRole)} options={roles.map((r) => ({ value: r, label: USER_ROLES[r].label }))} />
            </Field>
            <fieldset className="grid gap-2">
              <legend className="mb-1.5 text-xs font-medium text-ink-2">Password</legend>
              <div className="flex rounded-md border border-border p-0.5" role="radiogroup" aria-label="Password">
                {(["generate", "enter"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={mode === m}
                    onClick={() => setMode(m)}
                    className={cn("flex-1 rounded px-2 py-1 text-xs font-medium", mode === m ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
                  >
                    {m === "generate" ? "Generate one-time password" : "Enter a password"}
                  </button>
                ))}
              </div>
              {mode === "enter" ? (
                <div className="grid gap-1">
                  <Input
                    id="new-user-password"
                    type="password"
                    aria-label="Password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    aria-invalid={Boolean(passwordError) || undefined}
                    maxLength={200}
                  />
                  <p className={cn("text-2xs", passwordError ? "text-critical-ink" : "text-muted-foreground")}>{passwordError ?? `At least ${MIN_PASSWORD} characters. Stored only as a scrypt hash.`}</p>
                </div>
              ) : (
                <p className="text-2xs text-muted-foreground">A strong random password is shown once after you add the user.</p>
              )}
            </fieldset>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !valid}>
                {pending && <Loader2 className="animate-spin" aria-hidden />}
                Add user
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <OneTimePasswordDialog value={shown} who={who} onClose={() => setShown(null)} />
    </>
  );
}
