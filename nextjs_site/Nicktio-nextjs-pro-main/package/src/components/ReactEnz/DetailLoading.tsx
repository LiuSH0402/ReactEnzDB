export default function DetailLoading({ label = "record" }: { label?: string }) {
  return (
    <main className="reactenz-container py-10" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading {label} details…</span>
      <div className="grid animate-pulse gap-8 lg:grid-cols-[230px_1fr]">
        <aside className="hidden space-y-3 lg:block">
          <div className="h-3 w-28 rounded-full bg-slate-200 dark:bg-white/10" />
          {Array.from({ length: 7 }, (_, index) => (
            <div className="h-9 rounded-xl bg-slate-100 dark:bg-white/5" key={index} />
          ))}
        </aside>
        <div className="min-w-0">
          <section className="rounded-[28px] border border-border bg-white p-7 shadow-sm dark:border-dark_border dark:bg-darkmode">
            <div className="h-3 w-40 rounded-full bg-primary/20" />
            <div className="mt-6 h-12 w-52 max-w-full rounded-xl bg-slate-200 dark:bg-white/10" />
            <div className="mt-4 h-6 w-3/4 rounded-lg bg-slate-100 dark:bg-white/5" />
            <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: 4 }, (_, index) => (
                <div className="h-24 rounded-2xl border border-border bg-slate-50 dark:border-dark_border dark:bg-white/5" key={index} />
              ))}
            </div>
          </section>
          <div className="mt-8 space-y-4">
            <div className="h-7 w-52 rounded-lg bg-slate-200 dark:bg-white/10" />
            <div className="h-28 rounded-2xl bg-slate-100 dark:bg-white/5" />
            <div className="h-28 rounded-2xl bg-slate-100 dark:bg-white/5" />
          </div>
        </div>
      </div>
    </main>
  );
}
