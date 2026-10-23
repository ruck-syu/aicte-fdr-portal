import { Skeleton } from "./ui";

/**
 * The shape every list route has while it waits: a title, a filter row and a
 * table. Matching the real layout keeps the page from jumping when data lands.
 */
export function ListSkeleton({ rows = 8, filters = 3 }: { rows?: number; filters?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading">
      <Skeleton className="mb-2 h-7 w-56" />
      <Skeleton className="mb-6 h-4 w-96 max-w-full" />
      {filters > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          <Skeleton className="h-9 min-w-60 flex-1" />
          {Array.from({ length: filters }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-36" />
          ))}
        </div>
      )}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="flex gap-6 border-b border-slate-100 bg-slate-50/60 px-4 py-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-3 w-20" />
          ))}
        </div>
        <div className="divide-y divide-slate-100">
          {Array.from({ length: rows }).map((_, i) => (
            <div key={i} className="flex items-center gap-6 px-4 py-3.5">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-48" />
              <Skeleton className="hidden h-4 w-24 sm:block" />
              <Skeleton className="ml-auto h-4 w-16" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
