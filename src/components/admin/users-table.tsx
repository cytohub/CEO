"use client";

import { KeyRound, Loader2, Lock, MoreHorizontal, ShieldCheck, Unlock, UserCheck, UserX } from "lucide-react";
import { useState } from "react";
import { Field, SimpleSelect } from "@/components/common/fields";
import { StatusPill } from "@/components/common/status";
import { useAction } from "@/components/common/use-action";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { UserRole } from "@/generated/prisma/enums";
import { formatDateTime, timeAgo } from "@/lib/dates";
import { USER_ROLES } from "@/lib/intelligence";
import { changeUserRole, resetUserPassword, setUserActive, unlockUser } from "@/server/actions/users";
import type { UserRow } from "@/server/queries/users";
import { OneTimePasswordDialog } from "./one-time-password";

type Pending = { kind: "role" | "deactivate" | "reactivate" | "reset"; user: UserRow } | null;

export function UsersTable({ users, now, timezone }: { users: UserRow[]; now: Date; timezone: string }) {
  const [dialog, setDialog] = useState<Pending>(null);
  // Open state is separate so a closing dialog keeps its content while it animates out.
  const [dialogOpen, setDialogOpen] = useState(false);
  const [role, setRole] = useState<UserRole | null>(null);
  const [shown, setShown] = useState<{ password: string; email: string; who: string } | null>(null);
  const { pending, run } = useAction();
  const openDialog = (next: NonNullable<Pending>) => {
    setDialog(next);
    setDialogOpen(true);
  };
  const close = () => setDialogOpen(false);

  return (
    <div className="panel">
      <div className="relative overflow-x-auto scrollbar-thin">
        <table className="w-full min-w-[820px] text-[13px]">
          <caption className="sr-only">Users and their roles</caption>
          <thead>
            <tr className="border-b border-hairline text-left text-2xs font-medium text-muted-foreground">
              <th scope="col" className="px-4 py-2 font-medium">User</th>
              <th scope="col" className="px-2 py-2 font-medium">Role</th>
              <th scope="col" className="px-2 py-2 font-medium">Status</th>
              <th scope="col" className="px-2 py-2 font-medium">Last sign-in</th>
              <th scope="col" className="px-2 py-2 text-right font-medium">Sessions</th>
              <th scope="col" className="w-12 px-4 py-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {users.map((u) => {
              const any = u.allowed.changeRole || u.allowed.deactivate || u.allowed.reactivate || u.allowed.resetPassword || u.allowed.unlock;
              return (
                <tr key={u.id} className="align-top hover:bg-muted/40" data-user-email={u.email}>
                  <td className="max-w-[320px] px-4 py-2">
                    <div className="truncate font-medium text-foreground">
                      {u.name}
                      {u.isSelf && <span className="ml-1.5 text-2xs font-normal text-muted-foreground">(you)</span>}
                    </div>
                    <div className="truncate text-2xs text-muted-foreground">{u.email}</div>
                  </td>
                  <td className="px-2 py-2">
                    <span className="inline-flex items-center gap-1 text-ink-2" title={USER_ROLES[u.role].description}>
                      {u.role === "CEO" && <ShieldCheck className="size-3.5 text-ink-3" aria-hidden />}
                      {USER_ROLES[u.role].label}
                    </span>
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex flex-wrap gap-1">
                      <StatusPill tone={u.active ? "good" : "neutral"} label={u.active ? "Active" : "Deactivated"} />
                      {u.locked && <StatusPill tone="serious" label="Locked" />}
                      {!u.hasPassword && <StatusPill tone="warning" label="No password" />}
                      {u.hasPassword && u.mustChangePassword && <StatusPill tone="neutral" label="Temporary password" />}
                    </div>
                    {u.locked && u.lockedUntil && <div className="mt-0.5 text-2xs text-muted-foreground">until {formatDateTime(u.lockedUntil, timezone)}</div>}
                    {!u.locked && u.failedLogins > 0 && <div className="mt-0.5 text-2xs text-muted-foreground">{u.failedLogins} failed sign-in{u.failedLogins === 1 ? "" : "s"}</div>}
                  </td>
                  <td className="px-2 py-2 text-xs whitespace-nowrap">
                    {u.lastLoginAt ? (
                      <span title={formatDateTime(u.lastLoginAt, timezone)} className="text-ink-2">
                        {timeAgo(u.lastLoginAt, now)}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Never</span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right text-xs text-ink-2 tabular">{u.activeSessions}</td>
                  <td className="px-4 py-1.5 text-right">
                    {any ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${u.name}`}>
                            <MoreHorizontal aria-hidden />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52">
                          {u.allowed.changeRole && (
                            <DropdownMenuItem
                              onSelect={() => {
                                setRole(u.assignableRoles[0] ?? null);
                                openDialog({ kind: "role", user: u });
                              }}
                            >
                              <ShieldCheck aria-hidden /> Change role…
                            </DropdownMenuItem>
                          )}
                          {u.allowed.resetPassword && (
                            <DropdownMenuItem onSelect={() => openDialog({ kind: "reset", user: u })}>
                              <KeyRound aria-hidden /> Reset password…
                            </DropdownMenuItem>
                          )}
                          {u.allowed.unlock && (
                            <DropdownMenuItem onSelect={() => run(() => unlockUser(u.id))}>
                              <Unlock aria-hidden /> Unlock sign-in
                            </DropdownMenuItem>
                          )}
                          {(u.allowed.deactivate || u.allowed.reactivate) && <DropdownMenuSeparator />}
                          {u.allowed.deactivate && (
                            <DropdownMenuItem variant="destructive" onSelect={() => openDialog({ kind: "deactivate", user: u })}>
                              <UserX aria-hidden /> Deactivate…
                            </DropdownMenuItem>
                          )}
                          {u.allowed.reactivate && (
                            <DropdownMenuItem onSelect={() => openDialog({ kind: "reactivate", user: u })}>
                              <UserCheck aria-hidden /> Reactivate…
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : (
                      <span className="inline-flex size-7 items-center justify-center text-ink-3" title={u.isSelf ? "You can’t change your own account here" : "Only the CEO can change this account"}>
                        <Lock className="size-3.5" aria-hidden />
                        <span className="sr-only">{u.isSelf ? "Your own account" : "Protected account"}</span>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Dialog open={dialogOpen && dialog?.kind === "role"} onOpenChange={(o) => !o && close()}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Change role</DialogTitle>
            <DialogDescription>
              {dialog?.user.name} is {dialog ? USER_ROLES[dialog.user.role].label : ""}. Changing the role signs them out everywhere.
            </DialogDescription>
          </DialogHeader>
          {dialog?.kind === "role" && (
            <Field label="New role" htmlFor="change-role" hint={role ? USER_ROLES[role].description : undefined}>
              <SimpleSelect id="change-role" value={role} onChange={(v) => setRole(v as UserRole)} options={dialog.user.assignableRoles.map((r) => ({ value: r, label: USER_ROLES[r].label }))} />
            </Field>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              disabled={pending || !role}
              onClick={async () => {
                if (!dialog || !role) return;
                const res = await run(() => changeUserRole(dialog.user.id, role));
                if (res.ok) close();
              }}
            >
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              Change role
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={dialogOpen && (dialog?.kind === "deactivate" || dialog?.kind === "reactivate" || dialog?.kind === "reset")} onOpenChange={(o) => !o && close()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {dialog?.kind === "deactivate" ? `Deactivate ${dialog.user.name}?` : dialog?.kind === "reactivate" ? `Reactivate ${dialog.user.name}?` : `Reset ${dialog?.user.name}’s password?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {dialog?.kind === "deactivate"
                ? "They are signed out immediately and can’t sign in again until reactivated. Their history and grants are kept."
                : dialog?.kind === "reactivate"
                  ? "They can sign in again with their existing password. Consider resetting it if the account was compromised."
                  : "Their current password stops working and every session is signed out. You’ll see a new one-time password once."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant={dialog?.kind === "deactivate" ? "destructive" : "default"}
              disabled={pending}
              onClick={async (e) => {
                e.preventDefault();
                if (!dialog) return;
                const u = dialog.user;
                if (dialog.kind === "reset") {
                  const res = await run(() => resetUserPassword(u.id));
                  if (res.ok) {
                    close();
                    setShown({ password: res.data.oneTimePassword, email: u.email, who: u.name });
                  }
                  return;
                }
                const res = await run(() => setUserActive(u.id, dialog.kind === "reactivate"));
                if (res.ok) close();
              }}
            >
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              {dialog?.kind === "deactivate" ? "Deactivate" : dialog?.kind === "reactivate" ? "Reactivate" : "Reset password"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <OneTimePasswordDialog value={shown} who={shown?.who ?? ""} onClose={() => setShown(null)} />
    </div>
  );
}
