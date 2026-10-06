import { Skeleton } from "@/components/ui/skeleton";

export default function SettingsLoading() {
  return (
    <div className="mx-auto max-w-[1440px]" aria-busy aria-label="Loading settings">
      <Skeleton className="h-7 w-40" />
      <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      <div className="mt-7 grid gap-6 xl:grid-cols-[188px_minmax(0,1fr)] xl:gap-8">
        <div className="hidden space-y-2 xl:block">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-6 w-36" />
          ))}
        </div>
        <div className="max-w-[1080px] space-y-8">
          {[180, 360, 420].map((h, i) => (
            <div key={i} className="space-y-2.5">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-3.5 w-80 max-w-full" />
              <Skeleton className="w-full" style={{ height: h }} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
