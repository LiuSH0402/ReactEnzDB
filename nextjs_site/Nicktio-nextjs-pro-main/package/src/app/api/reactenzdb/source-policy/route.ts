import { keggAccessPolicy } from "@/lib/keggAccessPolicy";
export const dynamic = "force-dynamic";
export function GET() {
  return Response.json(keggAccessPolicy, { headers: { "Cache-Control": "no-store" } });
}
