import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-[1440px] space-y-4" aria-busy aria-label="Loading weekly review">
      <div className="flex flex-wrap items-end justify-between gap-3 pb-1">
        <div className="space-y-2">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-7 w-40" />
      </div>
      <Skeleton className="h-[86px]" />
      <div className="grid gap-4 xl:grid-cols-12">
        <div className="space-y-4 xl:col-span-8">
          <div className="grid gap-4 lg:grid-cols-2">
            <Skeleton className="h-[320px]" />
            <Skeleton className="h-[320px]" />
          </div>
          <Skeleton className="h-[240px]" />
          <Skeleton className="h-[280px]" />
        </div>
        <div className="space-y-4 xl:col-span-4">
          <Skeleton className="h-[360px]" />
          <Skeleton className="h-[440px]" />
        </div>
      </div>
    </div>
  );
}
