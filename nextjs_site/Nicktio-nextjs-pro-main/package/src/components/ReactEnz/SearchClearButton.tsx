"use client";

import { useRouter } from "next/navigation";

export function SearchClearButton({ className }: { className?: string }) {
  const router = useRouter();

  return (
    <button
      className={className}
      type="button"
      onClick={(event) => {
        const form = event.currentTarget.closest("form");
        if (form) {
          for (const element of Array.from(form.elements)) {
            if (!(element instanceof HTMLInputElement) && !(element instanceof HTMLTextAreaElement)) continue;
            if (element instanceof HTMLInputElement && element.type === "hidden") continue;
            element.value = "";
          }
        }
        router.push("/search");
        router.refresh();
      }}
    >
      Clear
    </button>
  );
}
