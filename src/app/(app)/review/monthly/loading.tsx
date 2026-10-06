import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-[1440px] space-y-4" aria-busy aria-label="Loading monthly review">
      <div className="flex flex-wrap items-end justify-between gap-3 pb-1">
        <div className="space-y-2">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-4 w-60" />
        </div>
        <Skeleton className="h-7 w-44" />
      </div>
      <Skeleton className="h-[86px]" />
      <div className="grid gap-4 xl:grid-cols-12">
        <div className="space-y-4 xl:col-span-8">
          <Skeleton className="h-[420px]" />
          <Skeleton className="h-[200px]" />
          <div className="grid gap-4 lg:grid-cols-2">
            <Skeleton className="h-[260px]" />
            <Skeleton className="h-[260px]" />
          </div>
        </div>
        <div className="space-y-4 xl:col-span-4">
          <Skeleton className="h-[300px]" />
          <Skeleton className="h-[260px]" />
          <Skeleton className="h-[420px]" />
        </div>
      </div>
    </div>
  );
}
