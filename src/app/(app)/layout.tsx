import { AppShell } from "@/components/shell/app-shell";
import { getShellData } from "@/server/queries/shell";

// Every screen reads live company data.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const shell = await getShellData();
  return <AppShell shell={shell}>{children}</AppShell>;
}
