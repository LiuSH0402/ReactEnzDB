import Link from "next/link";
import { StatMap } from "@/lib/reactenzdb";
import { coreReleaseMetricMap } from "@/lib/releaseMetrics";
import { getHostRegistryPreview } from "@/lib/hostRegistryPreview";

function MapIcon({ kind }: { kind: "reaction" | "enzyme" | "host" }) {
  if (kind === "reaction") {
    return (
      <svg viewBox="0 0 104 104" fill="none" aria-hidden="true">
        <circle cx="52" cy="52" r="48" stroke="#81aff2" strokeOpacity=".16" />
        <path d="m28 38 23-14 24 14v28l-24 14-23-14V38Zm6 4v20m34-20v20m-28 8 11 6 15-8" stroke="#9bc8ff" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === "enzyme") {
    return (
      <svg viewBox="0 0 104 104" fill="none" aria-hidden="true">
        <circle cx="52" cy="52" r="48" stroke="#81aff2" strokeOpacity=".16" />
        <g transform="translate(52 52) scale(0.82) translate(-52 -52)">
          <path d="M28 17c64 13-16 32 48 47m-48-32c64 13-16 32 48 47m-48-32c64 13-16 32 48 47" stroke="#8dbbfb" strokeWidth="3" strokeLinecap="round" />
          <path d="m34 25 34 12m-30 5 27 10m-28 8 28 11m-29 5 30 11" stroke="#67d6c8" strokeOpacity=".6" />
        </g>
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 104 104" fill="none" aria-hidden="true">
      <circle cx="52" cy="52" r="48" stroke="#67d6c8" strokeOpacity=".16" />
      <path d="m35 25 37 17-10 39-31-19 4-37m0 0 27 56m-31-19 41-20" stroke="#67d6c8" strokeOpacity=".7" strokeWidth="1.5" />
      {[[35, 25], [72, 42], [62, 81], [31, 62]].map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="5" fill="#173344" stroke="#82e1d4" strokeWidth="2" />
      ))}
    </svg>
  );
}

export default function DatabaseMap({ stats }: { stats: StatMap }) {
  const metrics = coreReleaseMetricMap(stats);
  const value = (key: Parameters<typeof metrics.get>[0]) => Number(metrics.get(key)?.value ?? 0).toLocaleString();
  const stagingHosts = getHostRegistryPreview();
  const hostCount = stagingHosts?.length ?? 0;
  const hostHref = "/hosts";
  const hostLabel = "Host models";
  return (
    <figure className="rdb-database-map" aria-label="Reactions connected to enzyme records and host-model analysis">
      <div className="rdb-map-stats">
        <Link href="/reactions">
          <span className="rdb-map-stage">
            <MapIcon kind="reaction" />
            <span className="rdb-map-arrow" aria-hidden="true">&gt;</span>
          </span>
          <em className="rdb-map-kicker">Reaction</em>
          <strong>{value("reactions")}</strong>
          <span>Reaction records <i aria-hidden="true">↗</i></span>
        </Link>
        <Link href="/enzymes">
          <span className="rdb-map-stage">
            <MapIcon kind="enzyme" />
            <span className="rdb-map-arrow" aria-hidden="true">&gt;</span>
          </span>
          <em className="rdb-map-kicker">Enzyme</em>
          <strong>{value("enzymes")}</strong>
          <span>Enzyme records <i aria-hidden="true">↗</i></span>
        </Link>
        <Link href={hostHref}>
          <span className="rdb-map-stage">
            <MapIcon kind="host" />
          </span>
          <em className="rdb-map-kicker">Host</em>
          <strong>{hostCount.toLocaleString()}</strong>
          <span>{hostLabel} <i aria-hidden="true">↗</i></span>
        </Link>
        <p><strong>{value("source_organisms")}</strong><span>Source organisms</span></p>
        <p><strong>{value("kinetics")}</strong><span>Kinetic records</span></p>
        <p><strong>{value("chassis_labels")}</strong><span>Chassis annotations</span></p>
      </div>
      <figcaption>From a reaction to enzyme evidence, then to host-model context.</figcaption>
    </figure>
  );
}
