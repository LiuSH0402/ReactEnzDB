import type { Metadata } from "next";
import { notFound } from "next/navigation";
import RetrosynthesisWorkbench from "@/components/ReactEnz/RetrosynthesisWorkbench";
import RetroBioCatPlanner from "@/components/ReactEnz/RetroBioCatPlanner";
import SubNetXExtractor from "@/components/ReactEnz/SubNetXExtractor";
import ToolRunPage from "@/components/ReactEnz/ToolRunPage";
import { getRetrosynthesisToolRegistry } from "@/lib/retrosynthesisToolRegistry";
import { TOOL_PAGE_SLUGS, toolIdFromSlug, type ToolPageId } from "@/lib/toolPages";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ toolSlug: string }> };

const names: Record<ToolPageId, string> = {
  gsetretro: "GSETRetro",
  readretro: "READRetro",
  bionavi_np: "BioNavi-NP",
  retrobiocat: "RetroBioCat",
  subnetx: "SubNetX",
};

export function generateStaticParams() {
  return Object.values(TOOL_PAGE_SLUGS).map((toolSlug) => ({ toolSlug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const toolId = toolIdFromSlug((await params).toolSlug);
  if (!toolId) return { title: "Tool" };
  return {
    title: `${names[toolId]} · Tools`,
    alternates: { canonical: `/tools/${TOOL_PAGE_SLUGS[toolId]}` },
  };
}

function predictorEnabled(toolId: ToolPageId): boolean {
  const enabled = (process.env.RETROSYNTHESIS_ENABLED_TOOLS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return enabled.length === 0 || enabled.includes(toolId);
}

export default async function SingleToolPage({ params }: PageProps) {
  const toolId = toolIdFromSlug((await params).toolSlug);
  if (!toolId) notFound();
  const registry = getRetrosynthesisToolRegistry();
  const tool = registry.tools.find((item) => item.tool_id === toolId);
  if (!tool) notFound();

  const unavailable =
    (toolId === "retrobiocat" && process.env.RETROBIOCAT_ENABLED !== "true")
    || (toolId === "subnetx" && process.env.SUBNETX_ENABLED !== "true")
    || (["gsetretro", "readretro", "bionavi_np"].includes(toolId) && !predictorEnabled(toolId));

  return (
    <ToolRunPage tool={tool}>
      {unavailable ? (
        <p className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm leading-6 text-amber-950 dark:border-amber-900 dark:bg-amber-950/20 dark:text-amber-100">
          This local adapter is not enabled in the current deployment. The comparison on Tools still describes its published scope.
        </p>
      ) : toolId === "retrobiocat" ? (
        <RetroBioCatPlanner />
      ) : toolId === "subnetx" ? (
        <SubNetXExtractor />
      ) : toolId === "gsetretro" || toolId === "readretro" || toolId === "bionavi_np" ? (
        <RetrosynthesisWorkbench fixedTool={toolId} registry={registry.tools} />
      ) : null}
    </ToolRunPage>
  );
}
