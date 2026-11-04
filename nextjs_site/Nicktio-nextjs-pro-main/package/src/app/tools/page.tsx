import Link from "next/link";
import type { Metadata } from "next";
import { getRetrosynthesisToolRegistry, type RetrosynthesisToolEntry } from "@/lib/retrosynthesisToolRegistry";
import { toolHref } from "@/lib/toolPages";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Biosynthesis tool guide",
  description: "Compare five biosynthesis planning tools by use case, input, output, planning level, access, and ReactEnzDB integration.",
  alternates: { canonical: "/tools" },
};

type ToolProfile = {
  bestFor: string;
  planning: string;
  integration: string;
  availability: string;
  local: boolean;
};

const profiles: Record<string, ToolProfile> = {
  gsetretro: {
    bestFor: "Natural-product single-step disconnection proposals",
    planning: "Single step in ReactEnzDB; the upstream project contains additional modules",
    integration: "Precursor and product structures can be matched to ReactEnzDB reactions",
    availability: "Local CPU adapter",
    local: true,
  },
  readretro: {
    bestFor: "Retrieval-augmented natural-product retrosynthesis",
    planning: "Single Graph2SMILES component in ReactEnzDB; upstream supports a broader workflow",
    integration: "Precursor and product structures can be matched to ReactEnzDB reactions",
    availability: "Local CPU adapter",
    local: true,
  },
  bionavi_np: {
    bestFor: "Biosynthetic pathway navigation for natural products",
    planning: "Single checkpoint in ReactEnzDB; not the published multi-checkpoint planner",
    integration: "Precursor and product structures can be matched to ReactEnzDB reactions",
    availability: "Local audit adapter; public permission pending",
    local: true,
  },
  retrobiocat: {
    bestFor: "Biocatalytic reactions, enzyme classes, and cascade planning",
    planning: "Bounded 1–3 step rule network in ReactEnzDB; the upstream tool supports longer cascades, activity scoring, and a chemical policy model",
    integration: "Reaction rules and enzyme-type metadata are source-attributed; exact reaction links are retained",
    availability: "Local CPU adapter",
    local: true,
  },
  subnetx: {
    bestFor: "Pathway design inside a selected host metabolic network",
    planning: "Bounded E. coli ARBRE extraction in ReactEnzDB; no CPLEX ranking or yield claim",
    integration: "Compatible reaction identifiers can be resolved step by step; published cases remain source-attributed",
    availability: "Local CPU adapter",
    local: true,
  },
};

function profileFor(tool: RetrosynthesisToolEntry): ToolProfile {
  const profile = profiles[tool.tool_id] ?? {
    bestFor: tool.reactenzdb_scope,
    planning: tool.capability_class.replaceAll("_", " "),
    integration: tool.enzyme_mapping,
    availability: tool.reactenzdb_status.replaceAll("_", " "),
    local: false,
  };
  if (tool.tool_id === "retrobiocat") {
    const enabled = process.env.RETROBIOCAT_ENABLED === "true";
    return {
      ...profile,
      availability: enabled ? "Local CPU adapter" : "Use upstream resource",
      local: enabled,
    };
  }
  if (tool.tool_id === "subnetx") {
    const enabled = process.env.SUBNETX_ENABLED === "true";
    return {
      ...profile,
      availability: enabled ? "Local CPU adapter" : "Use upstream project",
      local: enabled,
    };
  }
  return profile;
}

function ToolAction({ tool }: { tool: RetrosynthesisToolEntry }) {
  const profile = profileFor(tool);
  const primaryAction =
    "inline-flex min-h-10 items-center justify-center rounded-xl border border-primary bg-primary px-4 py-2.5 text-center text-sm font-black text-white shadow-sm transition-colors hover:border-primary/90 hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2";

  return (
    <div className="flex min-w-40 flex-col gap-2">
      {profile.local ? (
        <Link className={primaryAction} href={toolHref(tool.tool_id)}>
          Open {tool.name}
        </Link>
      ) : null}
      <a
        className={primaryAction}
        href={tool.upstream_repository}
        rel="noreferrer"
        target="_blank"
      >
        Upstream source
      </a>
      <a
        className="rounded-md px-2 py-1 text-center text-xs font-bold text-muted underline-offset-4 hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 dark:text-white/70"
        href={`https://doi.org/${tool.paper.doi}`}
        rel="noreferrer"
        target="_blank"
      >
        Read the paper
      </a>
    </div>
  );
}

export default function ToolsPage() {
  const registry = getRetrosynthesisToolRegistry();

  return (
    <main className="reactenz-container reactenz-page">
      <section className="reactenz-page-compact-hero overflow-hidden lg:p-8">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_90%_12%,rgba(23,196,167,0.16),transparent_30%),linear-gradient(115deg,rgba(47,115,242,0.10),transparent_48%)]" />
        <div className="relative max-w-none">
          <p className="reactenz-eyebrow">Biosynthesis tool guide</p>
          <h1 className="reactenz-wide-title">Choose a tool for your planning task</h1>
          <p className="reactenz-page-copy">
            Compare what each tool accepts and returns. ReactEnzDB does not benchmark these tools or claim that one is universally better.
          </p>
        </div>
      </section>

      <section className="mt-8" id="comparison">
        <div className="mb-5">
          <p className="reactenz-eyebrow">Tool comparison</p>
          <h2 className="reactenz-tools-section-title mt-2">Five tools, different starting points</h2>
          <p className="mt-3 text-sm leading-7 text-muted dark:text-white/60">
            The comparison describes scope and interface only. Scores from different tools are model-specific and are not compared here.
          </p>
        </div>

        <div className="overflow-x-auto rounded-[26px] border border-border bg-white shadow-sm dark:border-dark_border dark:bg-darkmode">
          <table className="w-full min-w-[1280px] text-left text-sm">
            <thead className="bg-midnight_text text-xs uppercase tracking-[0.12em] text-white">
              <tr>
                <th className="px-5 py-4">Tool</th>
                <th className="px-5 py-4">Best suited for</th>
                <th className="px-5 py-4">Input</th>
                <th className="px-5 py-4">Output</th>
                <th className="px-5 py-4">Planning level</th>
                <th className="px-5 py-4">ReactEnzDB connection</th>
                <th className="px-5 py-4">Access</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border dark:divide-dark_border">
              {registry.tools.map((tool) => {
                const profile = profileFor(tool);
                return (
                  <tr className="align-top transition hover:bg-primary/[0.035]" key={tool.tool_id}>
                    <td className="px-5 py-5">
                      <div className="text-lg font-black text-midnight_text dark:text-white">{tool.name}</div>
                      <div className="mt-2 inline-flex rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-black uppercase tracking-wider text-primary">
                        {profile.availability}
                      </div>
                    </td>
                    <td className="max-w-60 px-5 py-5 font-semibold leading-6 text-midnight_text dark:text-white">{profile.bestFor}</td>
                    <td className="max-w-52 px-5 py-5 leading-6 text-muted dark:text-white/60">{tool.input}</td>
                    <td className="max-w-60 px-5 py-5 leading-6 text-muted dark:text-white/60">{tool.output}</td>
                    <td className="max-w-64 px-5 py-5 leading-6 text-muted dark:text-white/60">{profile.planning}</td>
                    <td className="max-w-72 px-5 py-5 leading-6 text-muted dark:text-white/60">{profile.integration}</td>
                    <td className="px-5 py-5"><ToolAction tool={tool} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-10" id="references">
        <p className="reactenz-eyebrow">References</p>
        <h2 className="reactenz-tools-section-title mt-2">Source papers for the five tools</h2>
        <p className="reactenz-tools-reference-lede mt-3 text-sm leading-7 text-muted dark:text-white/60">
          Cite the original tool papers below. Local adapters implement a bounded subset of each method and are not a substitute for the published workflows.
        </p>
        <ol className="mt-6 list-decimal space-y-4 pl-6 text-sm leading-7 text-midnight_text dark:text-white">
          {registry.tools.map((tool) => (
            <li key={tool.tool_id}>
              <span className="font-black">{tool.name}.</span>{" "}
              {tool.paper.citation}{" "}
              <a
                className="inline font-semibold text-primary underline-offset-4 hover:underline"
                href={`https://doi.org/${tool.paper.doi}`}
                rel="noreferrer"
                target="_blank"
              >
                doi:{tool.paper.doi}
              </a>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
