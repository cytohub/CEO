import Link from "next/link";

export const metadata = { title: "Access restricted · CytoHub" };

export default function Forbidden() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-2 px-4 text-center">
      <p className="font-mono text-xs text-muted-foreground">403</p>
      <h1 className="text-base font-semibold">Access restricted</h1>
      <p className="max-w-sm text-[13px] text-muted-foreground">Your role doesn’t include this area. Ask the CEO or an administrator if you need access.</p>
      <Link href="/search" className="mt-2 text-[13px] text-brand hover:underline">
        Go to Brain Search
      </Link>
    </div>
  );
}
