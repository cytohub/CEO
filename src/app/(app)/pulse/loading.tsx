import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-[1440px] space-y-6" aria-busy aria-label="Loading Daily Pulse">
      <div className="space-y-2">
        <Skeleton className="h-3 w-48" />
        <Skeleton className="h-8 w-80 max-w-full" />
        <Skeleton className="h-4 w-[36rem] max-w-full" />
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))] gap-3">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[112px]" />
        ))}
      </div>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-[136px]" />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <Skeleton className="h-[280px]" />
        <Skeleton className="h-[280px]" />
      </div>
    </div>
  );
}
