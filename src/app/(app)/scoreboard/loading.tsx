import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-[1440px] space-y-4" aria-busy aria-label="Loading scoreboard">
      <Skeleton className="h-7 w-64" />
      <Skeleton className="h-4 w-96 max-w-full" />
      <Skeleton className="h-16 w-full" />
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-[168px] rounded-none" />
        ))}
      </div>
      <div className="columns-[22rem] gap-4">
        {[2, 3, 2, 3, 3, 2, 2, 1].map((n, i) => (
          <Skeleton key={i} className="mb-4 w-full break-inside-avoid" style={{ height: 40 + n * 170 }} />
        ))}
      </div>
    </div>
  );
}
