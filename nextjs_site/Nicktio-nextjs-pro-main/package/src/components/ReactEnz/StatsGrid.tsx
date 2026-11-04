import { StatMap } from "@/lib/reactenzdb";
import { coreReleaseMetricMap } from "@/lib/releaseMetrics";
import { getHostRegistryPreview } from "@/lib/hostRegistryPreview";

function format(value: number) {
  return Number(value ?? 0).toLocaleString();
}

function FlowConnector() {
  return (
    <div className="reactenz-architecture-connector" aria-hidden="true">
      <span />
      <svg viewBox="0 0 12 12">
        <path d="m2 1 5 5-5 5" />
      </svg>
    </div>
  );
}

export default function StatsGrid({ stats }: { stats: StatMap }) {
  const metrics = coreReleaseMetricMap(stats);
  const reactions = metrics.get("reactions")?.value ?? 0;
  const records = metrics.get("reaction_enzyme_pairs")?.value ?? 0;
  const enzymes = metrics.get("enzymes")?.value ?? 0;
  const organisms = metrics.get("source_organisms")?.value ?? 0;
  const chassis = metrics.get("chassis_labels")?.value ?? 0;
  const kinetics = metrics.get("kinetics")?.value ?? 0;
  const hostCount = getHostRegistryPreview()?.length ?? 0;

  return (
    <figure className="reactenz-architecture-figure" aria-labelledby="architecture-title architecture-description">
      <figcaption className="sr-only">
        <span id="architecture-title">ReactEnzDB connected-record data architecture</span>
        <span id="architecture-description">
          Reaction–Enzyme Associations connect reactions and enzyme candidates. Source-organism provenance, chassis annotations, evidence, and host-model context remain separately identified.
        </span>
      </figcaption>

      <div className="reactenz-architecture-flow">
        <section className="reactenz-architecture-stage reactenz-stage-reaction">
          <header>
            <span>01</span>
            <div>
              <p>Association layer</p>
              <h3>Reaction–Enzyme Associations</h3>
            </div>
          </header>

          <div className="reactenz-architecture-metric">
            <strong>{format(records)}</strong>
            <span>stable association records</span>
          </div>

          <div className="reactenz-reaction-glyph" aria-hidden="true">
            <span className="reactenz-compound-mark reactenz-substrate-mark" />
            <span className="reactenz-reaction-arrow"><i /></span>
            <span className="reactenz-compound-mark reactenz-product-mark" />
          </div>

          <ul className="reactenz-architecture-tags" aria-label="Reaction–Enzyme Association components">
            <li>Reaction</li>
            <li>Enzyme</li>
            <li>Stable reo_id</li>
          </ul>
        </section>

        <FlowConnector />

        <section className="reactenz-architecture-stage reactenz-stage-candidates">
          <header>
            <span>02</span>
            <div>
              <p>Entity layers</p>
              <h3>Reaction identity</h3>
            </div>
          </header>

          <div className="reactenz-architecture-metric">
            <strong>{format(reactions)}</strong>
            <span>reaction records</span>
          </div>

          <dl className="reactenz-architecture-secondary">
            <div>
              <dt>{format(enzymes)}</dt>
              <dd>enzyme records</dd>
            </div>
            <div>
              <dt>{format(organisms)}</dt>
              <dd>source organisms</dd>
            </div>
          </dl>

          <div className="reactenz-cluster-scale" aria-label="Sequence identity clustering thresholds">
            <span>NR100</span>
            <span>NR90</span>
            <span>NR70</span>
            <span>NR50</span>
          </div>
        </section>

        <FlowConnector />

        <section className="reactenz-architecture-stage reactenz-stage-context">
          <header>
            <span>03</span>
            <div>
              <p>Evidence layer</p>
              <h3>Evidence &amp; implementation</h3>
            </div>
          </header>

          <div className="reactenz-context-summary">
            <div className="reactenz-architecture-metric">
              <strong>{format(chassis)}</strong>
              <span>chassis annotations</span>
            </div>
            <div className="reactenz-host-models">
              <p>{hostCount ? <><strong>{hostCount}</strong> host-model candidates</> : "Host-model candidates (staging preview)"}</p>
            </div>
          </div>

          <ul className="reactenz-evidence-stack">
            <li><span>Kinetic records</span><small>{format(kinetics)}</small></li>
            <li><span>Expression evidence</span><small>candidate</small></li>
            <li><span>Host-model context</span><small>staging</small></li>
          </ul>
        </section>
      </div>

      <div className="reactenz-architecture-boundary">
        <span>Evidence boundary</span>
        <p>Association records identify reaction–enzyme links; source provenance, annotation coverage, and experimental support are reported separately.</p>
      </div>
    </figure>
  );
}
