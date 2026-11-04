export default function SearchPanel({
  title,
  subtitle,
  placeholder,
  action,
  children,
}: {
  title: string;
  subtitle: string;
  placeholder: string;
  action: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="relative overflow-hidden border border-border bg-white p-6 dark:border-dark_border dark:bg-darkmode md:p-8">
      <div className="absolute right-0 top-0 h-full w-40 bg-primary/5" />
      <div className="relative">
        <p className="mb-3 text-sm font-bold uppercase tracking-widest text-primary">ReactEnzDB search</p>
        <h1 className="mb-3">{title}</h1>
        <p className="mb-6 max-w-3xl text-18 leading-8 text-muted dark:text-white/60">{subtitle}</p>
        <form action={action} className="grid gap-3 lg:grid-cols-[1fr_auto]">
          <input
            name="q"
            placeholder={placeholder}
            className="border border-border bg-hero-bg px-5 py-4 text-midnight_text dark:border-dark_border dark:bg-dark_b dark:text-white"
          />
          <button className="bg-primary px-8 py-4 text-base font-bold text-white transition hover:bg-primary/90">
            Search
          </button>
          {children}
        </form>
      </div>
    </section>
  );
}
