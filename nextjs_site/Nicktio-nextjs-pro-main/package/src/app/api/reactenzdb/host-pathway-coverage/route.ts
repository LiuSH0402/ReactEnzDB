import { keggPolicyUnavailable } from "@/lib/keggAccessPolicy";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export function GET() { return keggPolicyUnavailable(); }
export function HEAD() { return keggPolicyUnavailable(); }
