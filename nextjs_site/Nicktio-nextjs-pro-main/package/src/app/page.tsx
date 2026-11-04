import Link from "next/link";
import { Metadata } from "next";
import DatabaseMap from "@/components/ReactEnz/DatabaseMap";
import { reactEnzDBBrand } from "@/lib/brand";
import { getHostRegistryPreview } from "@/lib/hostRegistryPreview";
import { getStats } from "@/lib/reactenzdb";
import { getLocalReleaseRevision } from "@/lib/localReleaseRevision";
import { REACTENZDB_RELEASE } from "@/lib/release";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: reactEnzDBBrand.name,
  description: reactEnzDBBrand.description,
};

export default function Home() {
  const stats = getStats();
  const revision = getLocalReleaseRevision();
  const stagingHosts = getHostRegistryPreview();
  const hostCount = stagingHosts?.length ?? 0;
  const workflows = [
    {
      number: "01",
      title: "Start from a reaction",
      text: "Resolve a biochemical transformation, then inspect structures, identifiers and reaction-specific evidence.",
      href: "/search#transformation-search",
      link: "Search transformations",
    },
    {
      number: "02",
      title: "Compare enzyme candidates",
      text: "Open enzyme records for sequence, kinetics, UniProt mapping, and source-organism provenance. Source organism is not a host choice.",
      href: "/enzymes",
      link: "Browse enzymes",
    },
    {
      number: "03",
      title: "Choose a planning tool",
      text: "Compare what each tool accepts and returns. ReactEnzDB does not benchmark these tools or claim that one is universally better.",
      href: "/tools",
      link: "Open the tool guide",
    },
  ];

  return (
    <main className="reactenz-home">
      <section className="reactenz-home-hero">
        <div className="reactenz-container reactenz-home-hero-grid">
          <div className="reactenz-hero-copy">
            <div className="reactenz-hero-kicker">
              <span className="reactenz-live-dot" />
              {reactEnzDBBrand.formalName}
            </div>
            <h1 className="reactenz-hero-title">{reactEnzDBBrand.name}</h1>
            <p className="reactenz-hero-lead">
              {reactEnzDBBrand.subtitle}
            </p>
            <p className="reactenz-hero-body">
              Search normalized transformations, compare non-redundant enzyme candidates, trace
              reaction-specific and expression evidence, and inspect metabolic context across {hostCount} host models.
            </p>

            <form action="/search#search-results" className="reactenz-hero-search" role="search">
              <label htmlFor="home-search">Search reactions, enzymes, and hosts</label>
              <div>
                <input id="home-search" name="q" placeholder="R00001, EC:1.1.1.1, alcohol dehydrogenase, iML1515…" />
                <button type="submit">Search database</button>
              </div>
            </form>

          </div>

          <div className="reactenz-model-panel-wrap">
            <div className="reactenz-model-panel-heading">
              <span>From reaction identity to implementation context</span>
              <span>{revision ? `${revision.published ? "Data updated" : "Local data updated"} ${revision.date}` : `Web release ${REACTENZDB_RELEASE.version}`}</span>
            </div>
            <DatabaseMap stats={stats} />
          </div>
        </div>
      </section>

      <section className="reactenz-workflows">
        <div className="reactenz-container">
          <div className="reactenz-section-heading">
            <p>Research workflow</p>
            <h2>One connected path through the evidence</h2>
          </div>
          <div className="reactenz-workflow-grid">
            {workflows.map((workflow) => (
              <article key={workflow.number}>
                <span className="reactenz-workflow-number">{workflow.number}</span>
                <h3>{workflow.title}</h3>
                <p>{workflow.text}</p>
                <Link href={workflow.href}>{workflow.link} <span aria-hidden="true">→</span></Link>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="reactenz-home-cta">
        <div className="reactenz-container">
          <div>
            <p>Open research infrastructure</p>
            <h2>Use the release in your own workflow.</h2>
          </div>
          <div className="reactenz-home-cta-actions">
            <Link href="/downloads">Download datasets</Link>
            <Link href="/documentation/api">View API documentation</Link>
          </div>
        </div>
      </section>
    </main>
  );
}
