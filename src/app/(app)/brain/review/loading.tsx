import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-[1100px] space-y-4" aria-busy aria-label="Loading review queue">
      <div className="space-y-2 pb-1">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-[34rem] max-w-full" />
      </div>
      <Skeleton className="h-9 w-full" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="panel space-y-3 p-4">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-5 w-2/3" />
          <div className="grid gap-4 lg:grid-cols-2">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
          <Skeleton className="h-7 w-full" />
        </div>
      ))}
    </div>
  );
}
