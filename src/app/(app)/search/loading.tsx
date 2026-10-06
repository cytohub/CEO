import { Skeleton } from "@/components/ui/skeleton";

export default function SearchLoading() {
  return (
    <div className="mx-auto max-w-[1440px]" aria-busy aria-label="Searching">
      <Skeleton className="h-7 w-32" />
      <Skeleton className="mt-2 h-4 w-[28rem] max-w-full" />
      <Skeleton className="mt-6 h-10 w-full max-w-3xl" />
      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-4">
          <div className="flex gap-1.5">
            {[56, 72, 88, 64].map((w, i) => (
              <Skeleton key={i} className="h-7 rounded-full" style={{ width: w }} />
            ))}
          </div>
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-44 w-full" />
        </div>
        <div className="space-y-4">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    </div>
  );
}
