import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-[1440px] space-y-4" aria-busy aria-label="Loading person">
      <Skeleton className="h-3 w-48" />
      <div className="space-y-2">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-7 w-72" />
        <Skeleton className="h-4 w-[520px] max-w-full" />
      </div>
      <Skeleton className="h-[68px] w-full" />
      <div className="grid gap-4 xl:grid-cols-12">
        <div className="space-y-4 xl:col-span-8">
          <Skeleton className="h-56" />
          <Skeleton className="h-40" />
          <Skeleton className="h-72" />
        </div>
        <div className="space-y-4 xl:col-span-4">
          <Skeleton className="h-40" />
          <Skeleton className="h-32" />
          <Skeleton className="h-48" />
        </div>
      </div>
    </div>
  );
}
