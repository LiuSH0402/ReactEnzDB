export default function DetailDownloadLink({
  type,
  id,
}: {
  type: "reaction-detail" | "enzyme-detail" | "organism-detail" | "chassis-detail";
  id: string;
}) {
  const query = new URLSearchParams({ type, id, format: "xls" });
  const href = `/api/reactenzdb/export?${query.toString()}`;

  return (
    <a
      href={href}
      className="inline-flex items-center gap-2 rounded-xl border border-primary px-4 py-2 text-sm font-semibold text-primary hover:bg-primary hover:text-white"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2">
        <path d="M12 3v12" />
        <path d="m7 10 5 5 5-5" />
        <path d="M5 21h14" />
      </svg>
      Export record
    </a>
  );
}
