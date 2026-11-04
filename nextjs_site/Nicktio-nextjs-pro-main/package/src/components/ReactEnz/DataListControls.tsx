"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export type ColumnOption = {
  id: string;
  label: string;
  group?: "Identity" | "Relationships" | "Evidence" | "Sequence & annotation" | "Structure" | "Standardization";
  defaultVisible?: boolean;
};

const pageSizeOptions = [20, 50, 100];

export default function DataListControls({
  tableId,
  exportType,
  columns,
  total,
  page,
  pageSize,
  totalPages,
  storageVersion = "v1",
}: {
  tableId: string;
  exportType: "reactions" | "enzymes" | "organisms" | "chassis";
  columns: ColumnOption[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  storageVersion?: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const storageKey = `reactenzdb:${tableId}:columns:${storageVersion}`;
  const columnMenuRef = useRef<HTMLDivElement>(null);
  const [columnMenuOpen, setColumnMenuOpen] = useState(false);
  const [selectedCount, setSelectedCount] = useState(0);
  const [visible, setVisible] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(columns.map((column) => [column.id, column.defaultVisible !== false])),
  );

  useEffect(() => {
    const saved = window.localStorage.getItem(storageKey);
    if (!saved) return;
    try {
      setVisible((current) => ({ ...current, ...JSON.parse(saved) }));
    } catch {
      window.localStorage.removeItem(storageKey);
    }
  }, [storageKey]);

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(visible));
    const visibleCount = columns.filter((column) => visible[column.id] ?? true).length;
    document
      .querySelector<HTMLElement>(`[data-table="${tableId}"]`)
      ?.style.setProperty("--reactenz-visible-columns", String(Math.max(1, visibleCount)));
    for (const column of columns) {
      document
        .querySelectorAll(`[data-table="${tableId}"] [data-col="${column.id}"]`)
        .forEach((element) => element.classList.toggle("hidden", !visible[column.id]));
    }
  }, [columns, storageKey, tableId, visible]);

  useEffect(() => {
    if (!columnMenuOpen) return;

    function onPointerDown(event: PointerEvent) {
      if (!columnMenuRef.current?.contains(event.target as Node)) {
        setColumnMenuOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setColumnMenuOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [columnMenuOpen]);

  useEffect(() => {
    function updateSelectedCount() {
      setSelectedCount(selectedRowIds().length);
    }

    const table = document.querySelector(`[data-table="${tableId}"]`);
    table?.addEventListener("change", updateSelectedCount);
    updateSelectedCount();
    return () => table?.removeEventListener("change", updateSelectedCount);
  }, [tableId]);

  function updateParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams.toString());
    next.set(key, value);
    if (key !== "page") next.set("page", "1");
    router.push(`${pathname}?${next.toString()}`);
  }

  function goToPage(nextPage: number) {
    updateParam("page", String(Math.max(1, Math.min(totalPages, nextPage))));
  }

  function selectedRowIds() {
    return Array.from(document.querySelectorAll<HTMLInputElement>(`[data-table="${tableId}"] input[data-row-select]:checked`))
      .map((input) => input.value)
      .filter(Boolean);
  }

  function downloadUrl() {
    const next = new URLSearchParams(searchParams.toString());
    const ids = selectedRowIds();
    next.set("type", exportType);
    if (exportType === "enzymes") next.set("format", "tsv.gz");
    next.set(
      "columns",
      columns
        .filter((column) => visible[column.id] ?? true)
        .map((column) => column.id)
        .join(","),
    );
    if (ids.length) next.set("ids", ids.join(","));
    else next.delete("ids");
    next.delete("page");
    next.delete("pageSize");
    return `/api/reactenzdb/export?${next.toString()}`;
  }

  function startDownload() {
    window.location.href = downloadUrl();
  }

  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);
  const visibleCount = columns.filter((column) => visible[column.id] ?? true).length;
  const columnGroups = Array.from(new Set(columns.map((column) => column.group ?? "Identity"))).map((group) => ({
    group,
    columns: columns.filter((column) => (column.group ?? "Identity") === group),
  }));

  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3 dark:border-dark_border">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <div>
          <div className="text-sm font-bold text-midnight_text dark:text-white">
            Showing {first.toLocaleString()}-{last.toLocaleString()} of {total.toLocaleString()} records
          </div>
          <div className="mt-1 text-sm text-muted">
            Page {Math.min(page, totalPages).toLocaleString()} of {totalPages.toLocaleString()}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="rounded-lg border border-border px-3 py-2 text-sm font-bold disabled:opacity-40 dark:border-dark_border" disabled={page <= 1} onClick={() => goToPage(page - 1)}>
            Prev
          </button>
          <button type="button" className="rounded-lg border border-border px-3 py-2 text-sm font-bold disabled:opacity-40 dark:border-dark_border" disabled={page >= totalPages} onClick={() => goToPage(page + 1)}>
            Next
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <button
          type="button"
          onClick={startDownload}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white hover:bg-primary/90"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M12 3v12" />
            <path d="m7 10 5 5 5-5" />
            <path d="M5 21h14" />
          </svg>
          Export selected / filtered rows
        </button>

        <div className="relative" ref={columnMenuRef}>
          <button
            type="button"
            aria-expanded={columnMenuOpen}
            onClick={() => setColumnMenuOpen((open) => !open)}
            className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-3 text-sm font-semibold text-primary hover:bg-hero-bg dark:border-dark_border dark:hover:bg-dark_b"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M4 5h16" />
              <path d="M4 12h16" />
              <path d="M4 19h16" />
              <path d="M8 5v14" />
              <path d="M16 5v14" />
            </svg>
            Select columns · {visibleCount}/{columns.length}
          </button>
          {columnMenuOpen ? (
            <div className="absolute right-0 z-20 mt-3 max-h-[70vh] w-[min(760px,92vw)] overflow-y-auto rounded-2xl border border-border bg-white p-5 shadow-xl dark:border-dark_border dark:bg-darkmode">
              <div className="mb-1 text-sm font-black uppercase tracking-[0.14em] text-midnight_text dark:text-white">Choose table columns</div>
              <p className="mb-4 text-sm leading-5 text-muted">Columns are grouped to match the information architecture used on each record detail page.</p>
              <div className="grid gap-4 sm:grid-cols-2">
                {columnGroups.map(({ group, columns: groupedColumns }) => (
                  <section key={group} className="rounded-xl border border-border/80 bg-hero-bg/45 p-3 dark:border-dark_border dark:bg-dark_b/60">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <h3 className="text-xs font-black uppercase tracking-[0.13em] text-primary">{group}</h3>
                      <button
                        type="button"
                        className="text-xs font-bold text-muted hover:text-primary"
                        onClick={() => setVisible((current) => ({
                          ...current,
                          ...Object.fromEntries(groupedColumns.map((column) => [column.id, true])),
                        }))}
                      >
                        Show group
                      </button>
                    </div>
                    <div className="grid gap-1">
                      {groupedColumns.map((column) => (
                        <label key={column.id} className="inline-flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-semibold hover:bg-white dark:hover:bg-darkmode">
                          <input
                            type="checkbox"
                            checked={visible[column.id] ?? true}
                            onChange={(event) => setVisible((current) => ({ ...current, [column.id]: event.target.checked }))}
                          />
                          {column.label}
                        </label>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" className="rounded-lg bg-primary px-3 py-2 text-sm font-bold text-white" onClick={() => setVisible(Object.fromEntries(columns.map((column) => [column.id, true])))}>
                  Select all
                </button>
                <button type="button" className="rounded-lg border border-border px-3 py-2 text-sm font-bold dark:border-dark_border" onClick={() => setVisible(Object.fromEntries(columns.map((column) => [column.id, column.defaultVisible !== false])))}>
                  Default
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <label className="text-sm font-bold text-midnight_text dark:text-white">
          Rows
          <select
            value={pageSize}
            onChange={(event) => updateParam("pageSize", event.target.value)}
            className="mt-2 block min-w-28 border border-border bg-hero-bg px-3 py-2.5 font-semibold dark:border-dark_border dark:bg-dark_b"
          >
            {pageSizeOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
