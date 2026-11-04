"use client";

import { useEffect, useRef, useState } from "react";

export default function RowSelectAll({ tableId }: { tableId: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    function syncState() {
      const rows = Array.from(document.querySelectorAll<HTMLInputElement>(`[data-table="${tableId}"] input[data-row-select]`));
      const selected = rows.filter((input) => input.checked);
      setChecked(rows.length > 0 && selected.length === rows.length);
      if (ref.current) {
        ref.current.indeterminate = selected.length > 0 && selected.length < rows.length;
      }
    }

    const table = document.querySelector(`[data-table="${tableId}"]`);
    table?.addEventListener("change", syncState);
    syncState();
    return () => table?.removeEventListener("change", syncState);
  }, [tableId]);

  function toggleAll(nextChecked: boolean) {
    document.querySelectorAll<HTMLInputElement>(`[data-table="${tableId}"] input[data-row-select]`).forEach((input) => {
      input.checked = nextChecked;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    setChecked(nextChecked);
  }

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      aria-label="Select all visible rows"
      className="h-4 w-4 accent-primary"
      onChange={(event) => toggleAll(event.target.checked)}
    />
  );
}
