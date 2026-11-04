import { acceptedHosts, getPathwayExport, isAcceptedHost, parseReactionQueries, pathwayExportCsv } from "@/lib/pathwayExport";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const reactions = parseReactionQueries(url.searchParams.get("reactions") ?? "");
    const host = url.searchParams.get("host") ?? "any";
    if (!isAcceptedHost(host)) {
      return Response.json(
        { error: `Unsupported host "${host}".`, accepted_hosts: acceptedHosts() },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    const format = (url.searchParams.get("format") ?? "json").toLowerCase();
    const limitPerReaction = Number(url.searchParams.get("limit") ?? 10);
    const result = getPathwayExport({ reactions, host, limitPerReaction });

    if (format === "csv") {
      return new Response(pathwayExportCsv(result), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": "attachment; filename=\"reactenzdb_pathway_host_ranking.csv\"",
          "Cache-Control": "no-store",
        },
      });
    }

    return Response.json(
      {
        data: result,
        meta: {
          endpoint: "/api/reactenzdb/pathway-export",
          format,
          accepted_hosts: acceptedHosts(),
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Pathway export failed." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
}
