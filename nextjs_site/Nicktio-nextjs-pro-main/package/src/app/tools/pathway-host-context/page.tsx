import type { Metadata } from "next";
import { ParentBackLink } from "@/components/ReactEnz/ParentBackLink";
import PathwayHostInputWorkbench from "@/components/ReactEnz/PathwayHostInputWorkbench";
import { getHostRegistryPreview } from "@/lib/hostRegistryPreview";
import { localMappingPreviewAvailable } from "@/lib/hostMappingLocalPreview";
import { REACTION_ID_PATTERN } from "@/lib/pathwayHostInput";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Pathway Host Context · input preview",
  description: "Validate ordered ReactEnzDB reaction IDs and fixed staging host model releases without publishing pathway–host mapping results.",
  alternates: { canonical: "/tools/pathway-host-context" },
};

type PageProps = { searchParams: Promise<{ reactionId?: string | string[] }> };

export default async function PathwayHostContextPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const queryId = Array.isArray(params.reactionId) ? params.reactionId[0] : params.reactionId;
  const initialReactionId = queryId && REACTION_ID_PATTERN.test(queryId) ? queryId : "";
  const registry = getHostRegistryPreview();
  const mappingPreviewEnabled = localMappingPreviewAvailable();
  const hosts = registry?.map(({ host_id, scientific_name, strain, model_name, release_id, version_ref }) => ({
    host_id, scientific_name, strain, model_name, release_id, version_ref,
  })) ?? null;

  return (
    <main className="reactenz-container reactenz-page">
      <ParentBackLink href="/tools" label="Tools" />
      <section className="reactenz-page-compact-hero overflow-hidden lg:p-8">
        <p className="reactenz-eyebrow">Host Context · {mappingPreviewEnabled ? "unreviewed mapping preview" : "input preview"}</p>
        <h1>Pathway Host Context</h1>
        <p className="reactenz-page-copy">Validate an ordered pathway and fixed model releases. {mappingPreviewEnabled ? "Inspect unreviewed mappings, direction checks, adjacent-step chemical links and model-gap follow-ups." : "Reaction–host comparison has not been published."}</p>
      </section>
      <div className="my-8 border-l-4 border-amber-500 bg-amber-50 px-5 py-4 text-sm leading-6 text-amber-950 dark:bg-amber-950/20 dark:text-amber-100" role="status">
        <strong>{mappingPreviewEnabled ? "Freeze 2026.09.1 host-model lookup. Mapping sample is not human-reviewed." : "Input validation only."}</strong> A found ReactEnzDB reaction and a recorded host model do not establish that the reaction occurs in that host. {mappingPreviewEnabled ? "Direction and chemical adjacency checks can return insufficient evidence; model compartments, flux, growth and implementation feasibility are not validated." : "No mapping matrix, implementation profile, native coverage, growth or suitability is calculated here."}
      </div>
      <PathwayHostInputWorkbench hosts={hosts} initialReactionId={initialReactionId} mappingPreviewEnabled={mappingPreviewEnabled} />
      <section className="mt-10 border-t border-border pt-6 text-sm leading-6 text-muted dark:border-dark_border">
        <p>This tool reads only the staging 30-host registry. It does not fall back to an older host-model snapshot.</p>
      </section>
    </main>
  );
}
