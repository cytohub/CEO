import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-[1440px] space-y-4" aria-busy aria-label="Loading">
      <Skeleton className="h-7 w-64" />
      <Skeleton className="h-4 w-96" />
      <div className="grid gap-4 pt-2 xl:grid-cols-12">
        <Skeleton className="h-[420px] xl:col-span-8" />
        <Skeleton className="h-[420px] xl:col-span-4" />
      </div>
    </div>
  );
}
