import { Skeleton } from "@/components/ui/skeleton";

export default function ChiefOfStaffLoading() {
  return (
    <div className="mx-auto flex h-[calc(100dvh-5.5rem)] max-w-[1440px] flex-col gap-3" aria-busy aria-label="Loading Chief of Staff">
      <div>
        <Skeleton className="h-7 w-44" />
        <Skeleton className="mt-2 h-4 w-[30rem] max-w-full" />
      </div>
      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[264px_minmax(0,1fr)]">
        <div className="hidden space-y-2 rounded-lg border border-border p-2 lg:block">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-10 w-full" />
          ))}
        </div>
        <div className="flex flex-col rounded-lg border border-border">
          <div className="flex-1 space-y-4 p-6">
            <Skeleton className="mx-auto size-10 rounded-full" />
            <Skeleton className="mx-auto h-5 w-56" />
            <div className="mx-auto grid max-w-3xl gap-3 pt-4 sm:grid-cols-2">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          </div>
          <div className="border-t border-border p-3">
            <Skeleton className="mx-auto h-12 max-w-3xl" />
          </div>
        </div>
      </div>
    </div>
  );
}
