import { permanentRedirect } from "next/navigation";

export default function LegacyHostModelRedirect() {
  permanentRedirect("/hosts");
}
