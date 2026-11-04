import Link from "next/link";
import type { Metadata } from "next";
import { getHostRegistryPreview } from "@/lib/hostRegistryPreview";
import { getStats } from "@/lib/reactenzdb";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Browse data",
  description: "Browse ReactEnzDB reactions, enzymes, and staging host models.",
  alternates: { canonical: "/browse" },
};

const primary = [
  {
    href: "/reactions",
    label: "Reactions",
    countKey: "reactions" as const,
    text: "Open transformation records, participant structures, and the enzyme candidates linked to each reaction.",
    action: "Open reactions",
  },
  {
    href: "/enzymes",
    label: "Enzymes",
    countKey: "enzymes" as const,
    text: "Open enzyme candidates with sequence, kinetics, UniProt mapping, and source-organism provenance.",
    action: "Open enzymes",
  },
];

export default function BrowsePage() {
  const stats = getStats();
  const hostCount = getHostRegistryPreview()?.length ?? 0;

  return (
    <main className="reactenz-container reactenz-page reactenz-browse-page">
      <section className="reactenz-page-intro reactenz-page-compact-hero">
        <p className="reactenz-eyebrow">Browse ReactEnzDB</p>
        <h1>Browse reactions, enzymes, and hosts</h1>
        <p className="reactenz-page-copy">
          Start from reactions and enzyme candidates. Host models are a separate staging registry;
          they are not source organisms or chassis annotations.
        </p>
      </section>

      <nav aria-label="Browse data resources" className="reactenz-browse-board">
        {primary.map((item) => (
          <Link className="reactenz-browse-entry" href={item.href} key={item.href}>
            <div className="reactenz-browse-entry-top">
              <strong>{item.label}</strong>
              <span>{Number(stats[item.countKey] ?? 0).toLocaleString()}</span>
            </div>
            <p>{item.text}</p>
            <em>{item.action} →</em>
          </Link>
        ))}
        <Link className="reactenz-browse-entry is-host" href="/hosts">
          <div className="reactenz-browse-entry-top">
            <strong>Hosts</strong>
            <span>{hostCount.toLocaleString()}</span>
          </div>
          <p>Staging genome-scale identities for unpublished Host Context preview. Not source organisms, chassis annotations, or curated hosts.</p>
          <em>Open hosts →</em>
        </Link>
      </nav>
    </main>
  );
}
