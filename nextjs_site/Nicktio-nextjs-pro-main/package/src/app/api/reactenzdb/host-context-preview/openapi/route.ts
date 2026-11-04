import { localMappingPreviewAvailable } from "@/lib/hostMappingLocalPreview";
import { previewContractVersion, previewResponse } from "@/lib/hostContextPreviewContract";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ok = { description: "Local unreviewed staging response; SHA-256 in X-Content-SHA256 and schema/fields in the companion manifest." };
const gated = { description: "Preview disabled; no production or public fallback." };
const format = { name: "format", in: "query", schema: { type: "string", enum: ["json", "tsv"], default: "json" } };

export async function GET() {
  if (!localMappingPreviewAvailable()) return Response.json({ error: "Local staging preview is disabled." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  const document = {
    openapi: "3.1.0", info: { title: "ReactEnzDB Host Context (freeze 2026.09.1)", version: previewContractVersion,
      description: "Companion Host Context contract included in freeze 2026.09.1. Model lookup only; not host recommendation. Mapping human review is still empty. Field names are unchanged from the local preview contract." },
    servers: [{ url: "/api/reactenzdb" }],
    paths: {
      "/host-context-preview/manifest": { get: { summary: "Schema, field dictionary, source audit references and limitations", responses: { "200": ok, "503": gated } } },
      "/hosts/preview": { get: { summary: "Read-only staging host registry (not curated release)", parameters: [format], responses: { "200": ok, "503": gated } } },
      "/hosts/preview/{hostId}": { get: { summary: "One fixed staging host/model release", parameters: [{ name: "hostId", in: "path", required: true, schema: { type: "string" } }], responses: { "200": ok, "404": { description: "Unknown host ID" }, "503": gated } } },
      "/reactions/{reactionId}/hosts/preview": { get: { summary: "Read-only reaction × 30 fixed model releases", parameters: [{ name: "reactionId", in: "path", required: true, schema: { type: "string", pattern: "^R[0-9]{5}$" } }, format], responses: { "200": ok, "404": { description: "Unknown reaction ID" }, "503": gated } } },
      "/pathway/host-context/preview": { post: {
        summary: "Bounded ordered-pathway model context, direction, adjacent links, resource ledgers",
        parameters: [{ name: "format", in: "query", schema: { type: "string", enum: ["json", "json-download", "steps-tsv", "resources-tsv"], default: "json" } }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["steps", "release_ids"], properties: {
          steps: { type: "array", minItems: 1, maxItems: 30, items: { type: "object", required: ["step", "reaction_id", "direction"], properties: { step: { type: "integer", minimum: 1 }, reaction_id: { type: "string", pattern: "^R[0-9]{5}$" }, direction: { type: "string", enum: ["forward", "reverse", "unspecified"] } } } },
          release_ids: { type: "array", minItems: 1, maxItems: 30, uniqueItems: true, items: { type: "string" } },
        } } } } }, responses: { "200": ok, "400": { description: "Invalid request" }, "503": gated },
      } },
    },
    "x-publication-status": "NOT_RELEASED", "x-contract-manifest": "/api/reactenzdb/host-context-preview/manifest",
  };
  return previewResponse(JSON.stringify(document, null, 2) + "\n", "json", "host-context-local-preview-openapi.json");
}
