import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-[1440px] space-y-4" aria-busy aria-label="Loading">
      <Skeleton className="h-7 w-56" />
      <Skeleton className="h-4 w-[28rem] max-w-full" />
      <Skeleton className="h-8 w-full max-w-2xl" />
      <Skeleton className="h-[480px] w-full" />
    </div>
  );
}
