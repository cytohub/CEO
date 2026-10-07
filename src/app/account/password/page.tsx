import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CytoHubMark } from "@/components/shell/sidebar";
import { Button } from "@/components/ui/button";
import { logout } from "@/server/actions/auth";
import { safeNext } from "@/server/security/next-path";
import { homePathFor } from "@/server/security/rbac";
import { PASSWORD_CHANGE_PATH, getSessionViewer } from "@/server/security/session";
import { PasswordForm } from "./password-form";

export const metadata: Metadata = { title: "Change password · CytoHub" };
export const dynamic = "force-dynamic";

/**
 * Outside the app shell on purpose: a user who must replace a password an
 * admin chose can reach nothing else (see getViewer), including the shell.
 */
export default async function ChangePasswordPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const viewer = await getSessionViewer();
  if (!viewer) redirect(`/login?next=${encodeURIComponent(PASSWORD_CHANGE_PATH)}`);
  const { next } = await searchParams;
  const destination = safeNext(typeof next === "string" ? next : null);
  const required = viewer.mustChangePassword;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="w-full max-w-[360px]">
        <div className="mb-6 flex items-center gap-2.5">
          <CytoHubMark className="size-8" />
          <div className="leading-tight">
            <div className="text-[15px] font-semibold tracking-tight">CytoHub</div>
            <div className="text-xs text-muted-foreground">CEO Command Center</div>
          </div>
        </div>
        <div className="panel p-5">
          <h1 className="text-base font-semibold tracking-tight">{required ? "Choose your own password" : "Change password"}</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {required
              ? "You signed in with a temporary password from your administrator. Replace it to continue."
              : "You’ll stay signed in here; every other device is signed out."}
          </p>
          <PasswordForm next={destination ?? undefined} email={viewer.email} />
        </div>
        <div className="mt-4 flex items-center justify-center gap-3 text-2xs text-muted-foreground">
          <span>
            Signed in as <span className="font-medium text-foreground">{viewer.email}</span>
          </span>
          {required ? (
            <form action={logout}>
              <Button type="submit" variant="link" size="xs" className="h-auto px-0 text-2xs text-muted-foreground hover:text-foreground">
                Sign out
              </Button>
            </form>
          ) : (
            <Link href={destination ?? homePathFor(viewer.role)} className="underline-offset-2 hover:text-foreground hover:underline">
              Cancel
            </Link>
          )}
        </div>
      </div>
    </main>
  );
}
