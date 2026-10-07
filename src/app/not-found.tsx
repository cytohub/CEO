import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-2 text-center">
      <p className="font-mono text-xs text-muted-foreground">404</p>
      <h1 className="text-base font-semibold">Not found</h1>
      <p className="text-[14px] text-muted-foreground">That page or record doesn’t exist.</p>
      <Link href="/" className="mt-2 text-[14px] text-brand hover:underline">
        Back to Today
      </Link>
    </div>
  );
}
