import Link from "next/link";

export function ParentBackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      className="mb-4 inline-flex max-w-full items-center gap-1.5 rounded-lg border border-border bg-white px-2.5 py-1.5 text-[13px] font-black leading-none text-midnight_text transition hover:border-primary hover:text-primary dark:border-dark_border dark:bg-darkmode dark:text-white"
      href={href}
    >
      <svg aria-hidden="true" className="size-3.5 shrink-0" fill="none" viewBox="0 0 16 16">
        <path
          d="M13 8H4.5M7.5 4.5 3.5 8l4 3.5"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2.4"
        />
      </svg>
      <span className="leading-none">{`Back to ${label}`}</span>
    </Link>
  );
}
