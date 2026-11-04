"use client";

import { useEffect, useState } from "react";

type VisitorSummary = {
  totalVisitors: number;
  todayVisitors: number;
  since: string;
};

export default function VisitorCounter() {
  const [summary, setSummary] = useState<VisitorSummary | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/analytics/visitors", {
      method: "POST",
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then((response) => response.ok ? response.json() as Promise<VisitorSummary> : null)
      .then((data) => {
        if (data) setSummary(data);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
      });

    return () => controller.abort();
  }, []);

  if (!summary) return <span className="reactenz-visitor-counter is-loading">Visitors —</span>;

  return (
    <span
      className="reactenz-visitor-counter"
      title="Approximate unique browsers. No IP address, identity, or search activity is stored."
    >
      <span>Visitors</span>
      <strong>{summary.totalVisitors.toLocaleString()}</strong>
      <small>since {summary.since}</small>
    </span>
  );
}
