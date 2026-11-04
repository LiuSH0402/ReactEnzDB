import Link from "next/link";

type QueryValue = string | string[] | undefined;

const textSortColumns = new Set([
  "reactenz_id",
  "equation",
  "enzyme",
  "uniprot",
  "gene",
  "organism",
  "label",
  "direction",
  "ec",
  "rhea",
  "kegg",
  "metacyc",
  "structure",
  "sequence_status",
  "evidence",
]);

function appendQueryValue(params: URLSearchParams, key: string, value: QueryValue) {
  if (value === undefined || value === "") return;
  if (Array.isArray(value)) {
    value.forEach((item) => {
      if (item) params.append(key, item);
    });
    return;
  }
  params.set(key, value);
}

function sortHref({
  pathname,
  searchParams,
  column,
  currentSort,
  currentDir,
}: {
  pathname: string;
  searchParams: Record<string, QueryValue>;
  column: string;
  currentSort: string;
  currentDir: string;
}) {
  const next = new URLSearchParams();
  Object.entries(searchParams).forEach(([key, value]) => {
    if (key === "sort" || key === "dir" || key === "page") return;
    appendQueryValue(next, key, value);
  });

  const isActive = currentSort === column;
  const defaultDir = textSortColumns.has(column) ? "asc" : "desc";
  const nextDir = isActive ? (currentDir === "asc" ? "desc" : "asc") : defaultDir;
  next.set("sort", column);
  next.set("dir", nextDir);
  next.set("page", "1");

  return `${pathname}?${next.toString()}`;
}

export default function SortableHeader({
  column,
  label,
  pathname,
  searchParams,
  currentSort,
  currentDir,
}: {
  column: string;
  label: string;
  pathname: string;
  searchParams: Record<string, QueryValue>;
  currentSort: string;
  currentDir: string;
}) {
  const active = currentSort === column;
  const ascActive = active && currentDir === "asc";
  const descActive = active && currentDir === "desc";

  return (
    <Link
      href={sortHref({ pathname, searchParams, column, currentSort, currentDir })}
      className="inline-flex items-center gap-1.5 text-left font-semibold text-muted transition hover:text-primary"
      title={`Sort by ${label}`}
    >
      <span>{label}</span>
      <span className="inline-flex flex-col gap-0.5" aria-hidden="true">
        <svg viewBox="0 0 8 5" className={`h-1.5 w-2 ${ascActive ? "text-primary" : "text-muted/35"}`} fill="currentColor">
          <path d="M4 0 8 5H0z" />
        </svg>
        <svg viewBox="0 0 8 5" className={`h-1.5 w-2 ${descActive ? "text-primary" : "text-muted/35"}`} fill="currentColor">
          <path d="M4 5 0 0h8z" />
        </svg>
      </span>
    </Link>
  );
}
