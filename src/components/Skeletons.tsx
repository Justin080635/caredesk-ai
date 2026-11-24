export function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`sage-shimmer rounded-2xl ${className}`} />;
}

export function DashboardSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading operations dashboard">
      <SkeletonBlock className="h-44 rounded-[24px]" />
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3 2xl:gap-3.5">
        {Array.from({ length: 5 }).map((_, idx) => (
          <div key={idx} className="card-surface rounded-[22px] p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <SkeletonBlock className="h-3 w-20 rounded-md" />
              <SkeletonBlock className="h-8 w-8 rounded-xl shrink-0" />
            </div>
            <SkeletonBlock className="h-7 w-14 rounded-lg" />
            <SkeletonBlock className="h-2.5 w-24 rounded-md" />
          </div>
        ))}
      </div>
      <div className="card-surface rounded-[24px] p-5 sm:p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <SkeletonBlock className="h-4 w-44 rounded-md" />
          <SkeletonBlock className="h-7 w-36 rounded-full" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
          <div className="md:col-span-4 grid grid-cols-2 md:grid-cols-1 gap-3">
            <SkeletonBlock className="h-24 rounded-[20px]" />
            <SkeletonBlock className="h-24 rounded-[20px]" />
          </div>
          <SkeletonBlock className="md:col-span-8 h-56 rounded-[20px]" />
        </div>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-7 card-surface rounded-[24px] p-5 space-y-3">
          <SkeletonBlock className="h-4 w-40 rounded-md" />
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 py-2">
              <SkeletonBlock className="w-9 h-9 rounded-full shrink-0" />
              <div className="flex-1 space-y-1.5">
                <SkeletonBlock className="h-3.5 w-44 rounded-md" />
                <SkeletonBlock className="h-2.5 w-28 rounded-md" />
              </div>
              <SkeletonBlock className="h-6 w-20 rounded-full" />
            </div>
          ))}
        </div>
        <div className="lg:col-span-5 card-surface rounded-[24px] p-5 space-y-3">
          <SkeletonBlock className="h-4 w-36 rounded-md" />
          {Array.from({ length: 3 }).map((_, i) => (
            <SkeletonBlock key={i} className="h-20 rounded-[18px]" />
          ))}
        </div>
      </div>
    </div>
  );
}

export function TableSkeleton({
  rows = 5,
  label = 'Loading records',
}: {
  rows?: number;
  label?: string;
}) {
  return (
    <div className="p-5 space-y-3" aria-busy="true" aria-label={label}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 p-3.5 rounded-2xl bg-[#FAFBF9] border border-[#EEF3EF]"
        >
          <SkeletonBlock className="w-9 h-9 rounded-full shrink-0" />
          <div className="flex-1 space-y-1.5 min-w-0">
            <SkeletonBlock className="h-3.5 w-40 max-w-full rounded-md" />
            <SkeletonBlock className="h-2.5 w-28 max-w-full rounded-md" />
          </div>
          <SkeletonBlock className="h-6 w-20 rounded-full shrink-0" />
        </div>
      ))}
    </div>
  );
}

export function CardGridSkeleton({
  cards = 3,
  columnsClass = 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3',
  cardHeightClass = 'h-64',
  label = 'Loading items',
}: {
  cards?: number;
  columnsClass?: string;
  cardHeightClass?: string;
  label?: string;
}) {
  return (
    <div className={`grid ${columnsClass} gap-4`} aria-busy="true" aria-label={label}>
      {Array.from({ length: cards }).map((_, i) => (
        <div key={i} className={`card-surface rounded-[24px] p-5 space-y-3.5 ${cardHeightClass}`}>
          <div className="flex items-center justify-between gap-2">
            <SkeletonBlock className="h-4 w-32 rounded-md" />
            <SkeletonBlock className="h-6 w-10 rounded-full" />
          </div>
          <SkeletonBlock className="h-24 rounded-[18px]" />
          <SkeletonBlock className="h-20 rounded-[18px]" />
        </div>
      ))}
    </div>
  );
}

export function ChartSkeleton({ label = 'Loading analytics charts' }: { label?: string }) {
  return (
    <div className="space-y-6" aria-busy="true" aria-label={label}>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card-surface rounded-[22px] p-5 space-y-3">
            <SkeletonBlock className="h-3 w-24 rounded-md" />
            <SkeletonBlock className="h-8 w-16 rounded-lg" />
            <SkeletonBlock className="h-2.5 w-32 rounded-md" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        <div className="xl:col-span-7 card-surface rounded-[24px] p-6 space-y-4">
          <SkeletonBlock className="h-4 w-56 rounded-md" />
          <SkeletonBlock className="h-64 rounded-[20px]" />
        </div>
        <div className="xl:col-span-5 card-surface rounded-[24px] p-6 space-y-4">
          <SkeletonBlock className="h-4 w-40 rounded-md" />
          <SkeletonBlock className="h-52 rounded-[20px]" />
          <div className="flex gap-2">
            <SkeletonBlock className="h-9 w-28 rounded-full" />
            <SkeletonBlock className="h-9 w-28 rounded-full" />
          </div>
        </div>
      </div>
    </div>
  );
}
