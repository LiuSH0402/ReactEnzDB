import Link from "next/link";

export default function NotFoundPage() {
  return (
    <main className="reactenz-container reactenz-page">
      <section className="reactenz-page-panel">
        <p className="reactenz-eyebrow">404</p>
        <h1>Record or page not found</h1>
        <p className="reactenz-page-copy">
          The requested ReactEnzDB page does not exist, or the record identifier is not present in the current release.
          Use search, browse, downloads, or maintenance support links to continue.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link className="rounded-xl bg-primary px-4 py-3 text-sm font-black text-white" href="/search">
            Search ReactEnzDB
          </Link>
          <Link className="rounded-xl border border-primary px-4 py-3 text-sm font-black text-primary" href="/browse">
            Browse records
          </Link>
          <Link className="rounded-xl border border-border px-4 py-3 text-sm font-black text-midnight_text dark:border-dark_border dark:text-white" href="/maintenance">
            Report an issue
          </Link>
        </div>
      </section>
    </main>
  );
}
