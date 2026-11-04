import { ParentBackLink } from "@/components/ReactEnz/ParentBackLink";

export default function DetailJumpNav({
  backHref,
  backLabel,
  label,
  sections,
}: {
  backHref: string;
  backLabel: string;
  label: string;
  sections: Array<{ id: string; label: string }>;
}) {
  return (
    <aside className="h-fit self-start border-border text-sm dark:border-dark_border lg:sticky lg:top-[88px] lg:z-30">
      <ParentBackLink href={backHref} label={backLabel} />
      <div className="mb-4 hidden text-xs font-semibold uppercase tracking-[0.16em] text-muted lg:block">{label}</div>
      <details className="lg:hidden">
        <summary className="cursor-pointer list-none rounded-xl border border-border bg-white px-4 py-3 font-black text-midnight_text dark:border-dark_border dark:bg-darkmode dark:text-white">
          Jump to section
        </summary>
        <nav className="mt-3 grid grid-cols-2 gap-1">
          {sections.map((section) => (
            <a key={section.id} href={`#${section.id}`} className="rounded-lg px-3 py-2 font-semibold text-muted transition hover:bg-primary/5 hover:text-primary">
              {section.label}
            </a>
          ))}
        </nav>
      </details>
      <nav className="hidden space-y-1 lg:block">
        {sections.map((section) => (
          <a key={section.id} href={`#${section.id}`} className="block border-l-2 border-transparent px-3 py-2 font-semibold text-muted transition hover:border-primary hover:text-primary">
            {section.label}
          </a>
        ))}
      </nav>
    </aside>
  );
}
