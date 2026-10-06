import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-[1440px] space-y-4" aria-busy aria-label="Loading CEO performance">
      <div className="flex flex-wrap items-end justify-between gap-3 pb-1">
        <div className="space-y-2">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-6 w-60" />
          <Skeleton className="h-4 w-80" />
        </div>
        <Skeleton className="h-7 w-36" />
      </div>
      <Skeleton className="h-11" />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-[150px]" />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-12">
        <Skeleton className="h-[380px] xl:col-span-8" />
        <Skeleton className="h-[380px] xl:col-span-4" />
      </div>
    </div>
  );
}
