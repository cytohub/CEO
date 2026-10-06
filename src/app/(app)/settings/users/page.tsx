import type { Metadata } from "next";
import { AdminPage, AdminSection } from "@/components/admin/admin-page";
import { CreateUserButton } from "@/components/admin/create-user-dialog";
import { GrantsPanel } from "@/components/admin/grants-panel";
import { UsersTable } from "@/components/admin/users-table";
import { USER_ROLES } from "@/lib/intelligence";
import { getCeoContext } from "@/server/context";
import { getGrantees, getGrants, getUsers } from "@/server/queries/users";
import { requirePage } from "@/server/security/session";

export const metadata: Metadata = { title: "Users & access" };

export default async function UsersPage() {
  const viewer = await requirePage("users.manage", "/settings/users");
  const [{ users, creatableRoles, activeCeos }, grants, grantees, ceo] = await Promise.all([getUsers(viewer), getGrants(viewer), getGrantees(), getCeoContext()]);
  const now = new Date();
  const active = users.filter((u) => u.active).length;

  return (
    <AdminPage
      capabilities={viewer.capabilities}
      current="/settings/users"
      title="Users & access"
      description="Who can sign in, what their role lets them open, and which sources are shared beyond role clearance."
    >
      <AdminSection
        id="users"
        title="Users"
        description={`${active} active of ${users.length}. Role and status changes sign the person out everywhere. Only the CEO can grant or remove the CEO role; ${activeCeos} active CEO${activeCeos === 1 ? "" : "s"}.`}
        actions={<CreateUserButton roles={creatableRoles} />}
      >
        <UsersTable users={users} now={now} timezone={ceo.timezone} />
      </AdminSection>

      <AdminSection id="roles" title="Roles" description="What each role can open. Source content is additionally filtered by clearance and grants.">
        <dl className="panel grid divide-y divide-hairline sm:grid-cols-2 sm:divide-y-0">
          {(Object.keys(USER_ROLES) as (keyof typeof USER_ROLES)[]).map((r, i) => (
            <div key={r} className={`px-4 py-2.5 ${i >= 2 ? "sm:border-t sm:border-hairline" : ""} ${i % 2 === 1 ? "sm:border-l sm:border-hairline" : ""}`}>
              <dt className="text-[13px] font-medium text-foreground">{USER_ROLES[r].label}</dt>
              <dd className="mt-0.5 text-2xs text-muted-foreground">{USER_ROLES[r].description}</dd>
            </div>
          ))}
        </dl>
      </AdminSection>

      <AdminSection id="grants" title="Access grants" description="Explicit access to a connection, email thread, document or single item. Titles you can’t read yourself show as “Restricted item”.">
        <GrantsPanel grants={grants} grantees={grantees} selfId={viewer.userId} now={now} timezone={ceo.timezone} />
      </AdminSection>
    </AdminPage>
  );
}
