import { Skeleton } from "@/components/ui/skeleton";

/** List page: header, tabs/filters, rows. */
export function ListPageSkeleton({ rows = 8, tabs = true }: { rows?: number; tabs?: boolean }) {
  return (
    <div className="mx-auto max-w-[1440px] space-y-4" aria-busy aria-label="Loading">
      <div className="space-y-2 pb-1">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-[28rem] max-w-full" />
      </div>
      {tabs && <Skeleton className="h-8 w-full max-w-xl" />}
      <div className="panel divide-y divide-hairline">
        <div className="flex gap-2 p-2.5">
          <Skeleton className="h-7 w-60" />
          <Skeleton className="h-7 w-40" />
        </div>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <Skeleton className="size-7 rounded-md" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <Skeleton className="hidden h-5 w-20 sm:block" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Detail page: header, main column, side column. */
export function DetailPageSkeleton() {
  return (
    <div className="mx-auto max-w-[1440px] space-y-4" aria-busy aria-label="Loading">
      <div className="space-y-2 pb-1">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-7 w-[32rem] max-w-full" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="grid gap-4 xl:grid-cols-12">
        <div className="space-y-4 xl:col-span-8">
          <Skeleton className="h-44 w-full" />
          <Skeleton className="h-72 w-full" />
        </div>
        <div className="space-y-4 xl:col-span-4">
          <Skeleton className="h-56 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    </div>
  );
}
