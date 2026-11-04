import type { ReactNode } from "react";
import { ParentBackLink } from "@/components/ReactEnz/ParentBackLink";
import type { RetrosynthesisToolEntry } from "@/lib/retrosynthesisToolRegistry";
import { toolCapabilityLabel } from "@/lib/toolPages";

export default function ToolRunPage({
  tool,
  children,
}: {
  tool: RetrosynthesisToolEntry;
  children: ReactNode;
}) {
  return (
    <main className="reactenz-container reactenz-page">
      <ParentBackLink href="/tools" label="Tools" />
      <section className="reactenz-page-compact-hero overflow-hidden lg:p-8">
        <p className="reactenz-eyebrow">{toolCapabilityLabel(tool.capability_class)}</p>
        <h1>{tool.name}</h1>
        <p className="reactenz-page-copy">{tool.reactenzdb_scope}</p>
      </section>
      <div className="mt-8">{children}</div>
    </main>
  );
}
