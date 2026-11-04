import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "ReactEnzDB Documentation",
};

const docCards = [
  {
    title: "Help and tutorial",
    href: "/help",
    text: "Search workflow, page guide, data concepts, FAQ, and issue-reporting guidance.",
  },
  {
    title: "Downloads and reproducibility",
    href: "/downloads",
    text: "SQLite release, CSV/TSV bulk files, schema, field dictionary, sample records, license, citation, and checksums.",
  },
  {
    title: "REST API",
    href: "/documentation/api",
    text: "Programmatic JSON access, OpenAPI document, curl examples, Python examples, and R examples.",
  },
  {
    title: "Methodology and QA",
    href: "/methodology",
    text: "Record construction, structure-coverage sets, annotation-richness scoring, mapping confidence, automated QA, and limitations.",
  },
  {
    title: "Maintenance policy",
    href: "/maintenance",
    text: "Maintainer contact, five-year support commitment, update frequency, version archive strategy, and bug report process.",
  },
  {
    title: "Browse records",
    href: "/browse",
    text: "Interactive reaction, enzyme, association, source-organism, and chassis-annotation tables with filtering, sorting, column selection, and export.",
  },
  {
    title: "Biosynthesis tool guide",
    href: "/tools",
    text: "Objective comparison of five planning tools by use case, input, output, planning level, access, and database connection.",
  },
  {
    title: "Planning datasets",
    href: "/retrosynthesis",
    text: "Model-ready reactions, enzyme-candidate features, and source-attributed external planning resources.",
  },
  {
    title: "Evidence statistics",
    href: "/statistics",
    text: "Release-level statistics and database coverage summaries for reactions, enzymes, structures, kinetics, and annotations.",
  },
];

export default function DocumentationPage() {
  return (
    <main className="reactenz-container reactenz-page">
      <section className="reactenz-page-panel">
        <p className="reactenz-eyebrow">Documentation</p>
        <h1>ReactEnzDB documentation</h1>
        <p className="reactenz-page-copy">
          This documentation index links to the practical resources needed to use, reproduce, cite,
          and programmatically access ReactEnzDB.
        </p>
      </section>

      <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {docCards.map((card) => (
          <Link
            className="rounded-[24px] border border-border bg-white p-6 transition hover:border-primary hover:shadow-sm dark:border-dark_border dark:bg-darkmode"
            href={card.href}
            key={card.href}
          >
            <h2 className="mb-3 text-[24px]">{card.title}</h2>
            <p className="text-sm leading-7 text-muted dark:text-white/60">{card.text}</p>
          </Link>
        ))}
      </section>
    </main>
  );
}
