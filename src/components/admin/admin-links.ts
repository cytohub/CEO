import type { Capability } from "@/server/security/rbac";

/** Administration pages, each gated by its capability (enforced again by requirePage on the server). */
export const ADMIN_LINKS = [
  { href: "/settings/integrations", label: "Integrations", capability: "integrations.manage" },
  { href: "/settings/users", label: "Users & access", capability: "users.manage" },
  { href: "/settings/audit", label: "Audit log", capability: "audit.view" },
  { href: "/settings/retention", label: "Retention", capability: "retention.manage" },
  { href: "/brain/ingestion", label: "Ingestion health", capability: "health.view" },
] as const satisfies readonly { href: string; label: string; capability: Capability }[];

export type AdminHref = (typeof ADMIN_LINKS)[number]["href"] | "/settings";

export function adminLinksFor(capabilities: readonly Capability[]) {
  return ADMIN_LINKS.filter((l) => capabilities.includes(l.capability)).map(({ href, label }) => ({ href, label }));
}
