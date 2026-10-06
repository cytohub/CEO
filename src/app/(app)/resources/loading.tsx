import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-[1440px] space-y-4" aria-busy aria-label="Loading resources">
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-7 w-52" />
          <Skeleton className="h-4 w-[420px] max-w-[70vw]" />
        </div>
        <Skeleton className="h-7 w-28" />
      </div>
      <div className="flex gap-1 border-b border-hairline pb-3">
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-7 w-24" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-7 w-80 max-w-full" />
        <Skeleton className="h-7 w-44" />
      </div>
      <div className="panel divide-y divide-hairline">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="flex gap-3 px-3.5 py-3">
            <Skeleton className="size-7 shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-2/3" />
              <div className="flex gap-1">
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-5 w-32" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
