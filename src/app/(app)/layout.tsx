import { AppShell } from "@/components/shell/app-shell";
import { getShellData } from "@/server/queries/shell";
import { requirePage } from "@/server/security/session";

// Every screen reads live company data.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const viewer = await requirePage();
  const shell = await getShellData(viewer);
  return <AppShell shell={shell}>{children}</AppShell>;
}
