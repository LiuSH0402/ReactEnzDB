import Link from "next/link";
import type { Metadata } from "next";
import { reactEnzDBBrand } from "@/lib/brand";
import { getLocalReleaseRevision } from "@/lib/localReleaseRevision";
import { REACTENZDB_RELEASE } from "@/lib/release";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "About", description: `${reactEnzDBBrand.formalName}: scope, data architecture, citation, and links to methodology, maintenance, and help.`, alternates: { canonical: "/about" } };

const positioning = [
  {
    title: "Reaction-first organization",
    text: "Biochemical reactions are the primary navigation unit, connecting candidate enzymes, source organisms, chassis annotations, kinetics, and structures.",
  },
  {
    title: "Integrated protein evidence",
    text: "Protein and UniProt annotations are retained as source-labelled evidence and linked to the reactions in which each enzyme candidate may participate.",
  },
  {
    title: "Connected implementation context",
    text: "Reaction records connect enzyme candidates with source-organism provenance, chassis annotations, kinetic measurements, and structural support for implementation-oriented review.",
  },
  {
    title: "Source-attributed architecture",
    text: "Imported and derived records retain source identifiers, mapping status, and evidence boundaries so direct records remain distinct from contextual or inferred links.",
  },
];

const layers = [
  ["Association layer", "Stable reaction–enzyme associations with source-organism provenance retained on every record."],
  ["Reaction layer", "Unique biochemical transformations with equation, direction, participant structures, and external reaction identifiers."],
  ["Enzyme layer", "Candidate enzymes and bioparts linked to reactions, sequence, UniProt, source organisms, kinetics, PDB, and AlphaFold mappings."],
  ["Source organism layer", "Biological origins of enzyme records. This is not a curated metabolic host."],
  ["Chassis annotation layer", "Source-retained expression-host, strain, cell-line, and biological-context annotations. These are not curated metabolic hosts."],
  ["Host-model context", "Staging genome-scale model records used to inspect reaction × model mapping. These are not curated metabolic hosts."],
  ["Evidence layer", "Cross references to external databases and explicit data-state labels for unresolved, missing, or not mapped annotations."],
];

const relatedPages = [
  {
    href: "/methodology",
    eyebrow: "Methods",
    title: "Methodology & QA",
    text: "How records are constructed, how structure tiers and annotation richness should be read, and what this release does not claim.",
  },
  {
    href: "/maintenance",
    eyebrow: "Policy",
    title: "Maintenance",
    text: "Maintainer contact, five-year support commitment, version archive, and how to report data corrections.",
  },
  {
    href: "/help",
    eyebrow: "Using the site",
    title: "Help",
    text: "Search modes, page guide, data concepts, and answers to common questions.",
  },
];

function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="mb-5">
      <p className="reactenz-eyebrow">{eyebrow}</p>
      <h2 className="reactenz-tools-section-title">{title}</h2>
    </div>
  );
}

export default function AboutPage() {
  const revision = getLocalReleaseRevision();
  return (
    <main className="reactenz-container reactenz-page">
      <section className="reactenz-page-panel">
        <p className="reactenz-eyebrow">About ReactEnzDB</p>
        <h1 className="reactenz-about-hero-title">{reactEnzDBBrand.formalName}</h1>
        <p className="mt-4 text-xl font-semibold leading-8 text-primary">
          {reactEnzDBBrand.subtitle}
        </p>
        <p className="reactenz-page-copy">
          ReactEnzDB connects normalized biochemical reactions with evidence-ranked enzyme candidates,
          sequence families, source organisms, experimental expression evidence, kinetic parameters,
          compound and protein structures, and host metabolic context. It is designed for reaction-first
          enzyme selection and biosynthesis planning rather than enzyme-only or reaction-only browsing.
        </p>
      </section>

      <section className="mb-10">
        <SectionTitle eyebrow="Research focus" title="How ReactEnzDB connects the evidence" />
        <div className="grid gap-5 lg:grid-cols-2">
          {positioning.map((item) => (
            <div className="rounded-[24px] border border-border bg-white p-6 dark:border-dark_border dark:bg-darkmode" key={item.title}>
              <h3 className="reactenz-api-example-title mb-3">{item.title}</h3>
              <p className="text-sm leading-7 text-muted dark:text-white/60">{item.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-10">
        <SectionTitle eyebrow="Data architecture" title="Core data layers" />
        <div className="grid gap-3 md:grid-cols-2">
          {layers.map(([title, text]) => (
            <div className="rounded-[20px] border border-border bg-white px-5 py-4 dark:border-dark_border dark:bg-darkmode" key={title}>
              <h3 className="reactenz-api-example-title mb-2">{title}</h3>
              <p className="text-sm leading-6 text-muted dark:text-white/60">{text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-10 rounded-[24px] border border-border bg-white p-6 dark:border-dark_border dark:bg-darkmode">
        <SectionTitle eyebrow="Release" title="Version, usage, and citation" />
        <dl className="grid gap-5 text-sm lg:grid-cols-3">
          <div>
            <dt className="font-black uppercase tracking-[0.12em] text-muted">Current release</dt>
            <dd className="mt-2 leading-7 text-midnight_text dark:text-white">Base release {REACTENZDB_RELEASE.version}, base freeze date {REACTENZDB_RELEASE.date}.{revision ? ` Current ${revision.published ? "data" : "local data"} revision: ${revision.revision}, updated ${revision.date}.` : ""} Current data include additional source-verified reactions, enzymes and assay evidence. The 30 host-model identities retain their separate mapping scope. Host Context is a genome-scale lookup, not a host recommendation. Human audit of the 150-reaction sample is still empty.</dd>
          </div>
          <div>
            <dt className="font-black uppercase tracking-[0.12em] text-muted">Usage</dt>
            <dd className="mt-2 leading-7 text-muted dark:text-white/60">
              Intended for academic and non-commercial research. Cite ReactEnzDB, the exact release version, the access date, and the original source databases represented in the records used.
            </dd>
          </div>
          <div>
            <dt className="font-black uppercase tracking-[0.12em] text-muted">Limitations</dt>
            <dd className="mt-2 leading-7 text-muted dark:text-white/60">
              Structure-complete sets describe compound-structure availability, not biological correctness. Unresolved mappings are reported explicitly. Method definitions are on the Methodology page.
            </dd>
          </div>
        </dl>
        <p className="mt-5 text-sm leading-7 text-muted dark:text-white/60">
          Maintained by the LinDing Group, UESTC. Contact{" "}
          <a className="font-bold text-primary hover:underline" href="mailto:hlin@uestc.edu.cn">hlin@uestc.edu.cn</a>
          . The five-year support commitment, version archive, and correction checklist are on the Maintenance page.
        </p>
      </section>

      <section>
        <SectionTitle eyebrow="Related pages" title="Methods, policy, and how to use the site" />
        <div className="grid gap-5 md:grid-cols-3">
          {relatedPages.map((page) => (
            <Link
              className="rounded-[24px] border border-border bg-white p-6 transition hover:border-primary hover:shadow-sm dark:border-dark_border dark:bg-darkmode"
              href={page.href}
              key={page.href}
            >
              <p className="reactenz-eyebrow">{page.eyebrow}</p>
              <h3 className="reactenz-api-example-title mt-2">{page.title}</h3>
              <p className="mt-3 text-sm leading-7 text-muted dark:text-white/60">{page.text}</p>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
