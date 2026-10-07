"use client";

import { Check, KeySquare, Loader2, Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { EmptyState } from "@/components/common/bits";
import { Field, SimpleSelect } from "@/components/common/fields";
import { StatusPill } from "@/components/common/status";
import { useAction } from "@/components/common/use-action";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { GrantResource, UserRole } from "@/generated/prisma/enums";
import { formatDateTime, timeAgo } from "@/lib/dates";
import { USER_ROLES } from "@/lib/intelligence";
import { cn } from "@/lib/utils";
import { createGrant, revokeGrant, searchGrantResources } from "@/server/actions/users";
import type { GrantableResource, GrantRow } from "@/server/queries/users";

export const GRANT_RESOURCES: Record<GrantResource, { label: string; hint: string }> = {
  CONNECTION: { label: "Connection", hint: "Everything ingested from one account." },
  EMAIL_THREAD: { label: "Email thread", hint: "Every message in one conversation." },
  DOCUMENT: { label: "Document", hint: "One document and all its versions." },
  SOURCE_ITEM: { label: "Source item", hint: "One message, event or document." },
};

const GRANTEE_ROLES: UserRole[] = ["EXECUTIVE", "TEAM_MEMBER", "ADMIN", "ADVISOR"];

interface Grantee {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
}

export function GrantsPanel({ grants, grantees, selfId, now, timezone }: { grants: GrantRow[]; grantees: Grantee[]; selfId: string; now: Date; timezone: string }) {
  const [open, setOpen] = useState(false);
  const revoke = useAction();
  const [revoking, setRevoking] = useState<string | null>(null);

  return (
    <div className="panel">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-4 py-2">
        <p className="text-2xs text-muted-foreground">Grants add to role clearance; they never take access away. Expired grants stop applying automatically.</p>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          <Plus aria-hidden /> Grant access
        </Button>
      </div>
      {grants.length === 0 ? (
        <EmptyState compact icon={KeySquare} title="No explicit grants" description="Everyone reads sources according to their role. Grant access to share a connection, thread, document or item beyond that." />
      ) : (
        <div className="relative overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[780px] text-[14px]">
            <caption className="sr-only">Explicit access grants</caption>
            <thead>
              <tr className="border-b border-hairline text-left text-2xs font-medium text-muted-foreground">
                <th scope="col" className="px-4 py-2 font-medium">Resource</th>
                <th scope="col" className="px-2 py-2 font-medium">Granted to</th>
                <th scope="col" className="px-2 py-2 font-medium">Granted by</th>
                <th scope="col" className="px-2 py-2 font-medium">Expires</th>
                <th scope="col" className="w-12 px-4 py-2">
                  <span className="sr-only">Revoke</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {grants.map((g) => (
                <tr key={g.id} className={cn("align-top", g.expired && "text-muted-foreground")}>
                  <td className="max-w-[340px] px-4 py-2">
                    <div className="flex items-center gap-1.5">
                      <span className="shrink-0 rounded border border-border bg-surface-2 px-1.5 text-2xs text-ink-2">{GRANT_RESOURCES[g.resourceType].label}</span>
                      <span className={cn("truncate", g.restricted || g.missing ? "text-muted-foreground italic" : "font-medium text-foreground")} title={g.restricted ? undefined : g.label}>
                        {g.label}
                      </span>
                    </div>
                    {g.detail && <div className="mt-0.5 truncate text-2xs text-muted-foreground">{g.detail}</div>}
                  </td>
                  <td className="px-2 py-2">
                    {g.grantee.kind === "user" ? (
                      <>
                        <div className="text-ink-2">{g.grantee.name}</div>
                        <div className="text-2xs text-muted-foreground">{g.grantee.email}</div>
                      </>
                    ) : (
                      <span className="text-ink-2">Everyone with role {USER_ROLES[g.grantee.role].label}</span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-xs">
                    <div className="text-ink-2">{g.grantedBy ?? "—"}</div>
                    <div className="text-2xs text-muted-foreground" title={formatDateTime(g.createdAt, timezone)}>
                      {timeAgo(g.createdAt, now)}
                    </div>
                  </td>
                  <td className="px-2 py-2 text-xs whitespace-nowrap">
                    {g.expired ? (
                      <StatusPill tone="neutral" label="Expired" />
                    ) : g.expiresAt ? (
                      <span className="text-ink-2 tabular">{formatDateTime(g.expiresAt, timezone)}</span>
                    ) : (
                      <span className="text-muted-foreground">Never</span>
                    )}
                  </td>
                  <td className="px-4 py-1.5 text-right">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={revoke.pending}
                      aria-label={`Revoke ${GRANT_RESOURCES[g.resourceType].label.toLowerCase()} access for ${g.grantee.kind === "user" ? g.grantee.name : USER_ROLES[g.grantee.role].label}`}
                      onClick={async () => {
                        setRevoking(g.id);
                        await revoke.run(() => revokeGrant(g.id));
                        setRevoking(null);
                      }}
                    >
                      {revoke.pending && revoking === g.id ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <AddGrantDialog open={open} onOpenChange={setOpen} grantees={grantees.filter((u) => u.id !== selfId && u.role !== "CEO" && u.active)} />
    </div>
  );
}

function AddGrantDialog({ open, onOpenChange, grantees }: { open: boolean; onOpenChange: (o: boolean) => void; grantees: Grantee[] }) {
  const [type, setType] = useState<GrantResource>("DOCUMENT");
  const [q, setQ] = useState("");
  const [results, setResults] = useState<GrantableResource[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [resource, setResource] = useState<GrantableResource | null>(null);
  const [granteeKind, setGranteeKind] = useState<"user" | "role">("user");
  const [userId, setUserId] = useState<string | null>(null);
  const [role, setRole] = useState<UserRole | null>("EXECUTIVE");
  const [expires, setExpires] = useState("");
  const { pending, run } = useAction();

  // Debounced, permission-aware search (only what the granter can read is offered).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const t = setTimeout(async () => {
      setSearching(true);
      const res = await searchGrantResources(type, q);
      if (!cancelled) {
        setResults(res.ok ? res.data : []);
        setSearching(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [open, type, q]);

  const reset = () => {
    setQ("");
    setResults(null);
    setResource(null);
    setUserId(null);
    setExpires("");
  };
  const valid = resource && (granteeKind === "user" ? userId : role);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Grant access</DialogTitle>
          <DialogDescription>Share a source beyond role clearance. You can only share what you can read yourself.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field label="Resource type" htmlFor="grant-type" hint={GRANT_RESOURCES[type].hint}>
            <SimpleSelect
              id="grant-type"
              value={type}
              onChange={(v) => {
                setType(v as GrantResource);
                setResource(null);
              }}
              options={(Object.keys(GRANT_RESOURCES) as GrantResource[]).map((t) => ({ value: t, label: GRANT_RESOURCES[t].label }))}
            />
          </Field>
          <div className="grid gap-1.5">
            <label htmlFor="grant-search" className="text-xs font-medium text-ink-2">
              {GRANT_RESOURCES[type].label}
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-ink-3" aria-hidden />
              <Input id="grant-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by title, subject or account…" className="pl-8" autoComplete="off" />
              {searching && <Loader2 className="absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 animate-spin text-ink-3" aria-hidden />}
            </div>
            <ul className="max-h-48 overflow-y-auto rounded-lg border border-border scrollbar-thin" aria-label="Matching resources">
              {results === null ? (
                <li className="px-3 py-2 text-xs text-muted-foreground">Searching…</li>
              ) : results.length === 0 ? (
                <li className="px-3 py-2 text-xs text-muted-foreground">Nothing you can share matches.</li>
              ) : (
                results.map((r) => {
                  const selected = resource?.id === r.id;
                  return (
                    <li key={r.id} className="border-b border-hairline last:border-0">
                      <button
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setResource(r)}
                        className={cn("flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-muted/60 focus-visible:bg-muted focus-visible:outline-none", selected && "bg-brand-soft")}
                      >
                        <Check className={cn("mt-0.5 size-3.5 shrink-0", selected ? "text-brand" : "invisible")} aria-hidden />
                        <span className="min-w-0">
                          <span className="block truncate text-[14px] text-foreground">{r.label}</span>
                          {r.detail && <span className="block truncate text-2xs text-muted-foreground">{r.detail}</span>}
                        </span>
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          </div>
          <fieldset className="grid gap-2">
            <legend className="mb-1.5 text-xs font-medium text-ink-2">Grant to</legend>
            <div className="flex rounded-md border border-border p-0.5" role="radiogroup" aria-label="Grant to">
              {(["user", "role"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={granteeKind === k}
                  onClick={() => setGranteeKind(k)}
                  className={cn("flex-1 rounded px-2 py-1 text-xs font-medium", granteeKind === k ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}
                >
                  {k === "user" ? "A person" : "Everyone with a role"}
                </button>
              ))}
            </div>
            {granteeKind === "user" ? (
              <SimpleSelect
                ariaLabel="Person"
                value={userId}
                onChange={setUserId}
                placeholder="Choose a person"
                options={grantees.map((u) => ({ value: u.id, label: `${u.name} — ${USER_ROLES[u.role].label}` }))}
              />
            ) : (
              <SimpleSelect ariaLabel="Role" value={role} onChange={(v) => setRole(v as UserRole)} options={GRANTEE_ROLES.map((r) => ({ value: r, label: USER_ROLES[r].label }))} />
            )}
          </fieldset>
          <Field label="Expires (optional)" htmlFor="grant-expiry" hint="Access ends after this day. Leave empty for no expiry.">
            <Input id="grant-expiry" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} className="w-44" />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={pending || !valid}
            onClick={async () => {
              if (!resource) return;
              const res = await run(() =>
                createGrant({
                  resourceType: type,
                  resourceId: resource.id,
                  userId: granteeKind === "user" ? userId : null,
                  role: granteeKind === "role" ? role : null,
                  expiresAt: expires || null,
                }),
              );
              if (res.ok) {
                onOpenChange(false);
                reset();
              }
            }}
          >
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            Grant access
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
