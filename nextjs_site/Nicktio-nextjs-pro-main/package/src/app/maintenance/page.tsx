import type { Metadata } from "next";
import { getReleaseGovernance } from "@/lib/releaseGovernance";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Maintenance policy", description: "ReactEnzDB maintainers, five-year support commitment, update frequency, version archive, and issue reporting.", alternates: { canonical: "/maintenance" } };

const commitments = [
  {
    title: "Maintaining group",
    text: "ReactEnzDB is maintained by the LinDing Group at the University of Electronic Science and Technology of China (UESTC).",
  },
  {
    title: "Primary contact",
    text: "Questions, bug reports, and data correction requests can be sent to hlin@uestc.edu.cn. Users should include the ReactEnzDB record ID, release version, and a short description of the issue.",
  },
  {
    title: "Five-year maintenance commitment",
    text: "After public release or publication, the maintainers plan to keep ReactEnzDB accessible and maintained for at least five years, including critical bug fixes and release documentation.",
  },
  {
    title: "Update frequency",
    text: "Minor corrections can be released as patch updates when verified. Larger source refreshes and schema updates are planned on an annual or semi-annual basis, depending on source database availability and curation workload.",
  },
  {
    title: "Version archive",
    text: "Each public release will be assigned a version number, release date, manifest, schema documentation, and SHA256 checksums. Previous downloadable releases will be retained or archived so analyses can cite and reproduce the exact dataset version used.",
  },
  {
    title: "Issue handling",
    text: "Reported issues will be triaged as data correction, mapping error, website/API bug, documentation issue, or feature request. Verified corrections will be recorded in patch notes or release notes.",
  },
];

const reportChecklist = [
  "ReactEnzDB record ID, for example a reaction ID, enzyme ID, organism ID, or chassis ID.",
  "The page, API endpoint, or downloaded file where the issue was observed.",
  "The current release version and access date.",
  "External evidence supporting the correction, such as PMID, DOI, UniProt, Rhea, KEGG, MetaCyc, BRENDA, SABIO-RK, PDB, or M-CSA identifiers.",
  "A short description of the expected correction.",
];

export default function MaintenancePage() {
  const governance = getReleaseGovernance();
  return (
    <main className="reactenz-container reactenz-page reactenz-maintenance-page">
      <section className="reactenz-page-panel overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_10%,rgba(47,111,239,0.13),transparent_32%),radial-gradient(circle_at_82%_20%,rgba(25,180,160,0.13),transparent_34%)]" />
        <div className="relative">
          <p className="reactenz-eyebrow">Maintenance and support</p>
          <h1 className="reactenz-maintenance-hero-title">ReactEnzDB maintenance policy</h1>
          <p className="reactenz-page-copy">
            ReactEnzDB is intended as a maintained database resource rather than a one-time web supplement.
            This page describes the maintaining group, contact route, update policy, version archive strategy,
            and issue-reporting procedure for public releases.
          </p>
        </div>
      </section>

      <section className="mb-10 grid gap-5 lg:grid-cols-3">
        {commitments.map((item) => (
          <article className="reactenz-maintenance-summary rounded-[24px] border border-border bg-white p-6 dark:border-dark_border dark:bg-darkmode" key={item.title}>
            <h2 className="reactenz-api-example-title mb-3">{item.title}</h2>
            <p className="text-sm leading-7 text-muted dark:text-white/60">{item.text}</p>
          </article>
        ))}
      </section>

      <section className="mb-10 grid gap-6 lg:grid-cols-[1fr_1fr]">
        <div className="rounded-[24px] border border-border bg-white p-6 dark:border-dark_border dark:bg-darkmode">
          <p className="reactenz-eyebrow">How to report</p>
          <h2 className="reactenz-tools-section-title mb-4">Bug report and data correction checklist</h2>
          <ul className="grid gap-3 text-sm leading-7 text-muted dark:text-white/60">
            {reportChecklist.map((item) => (
              <li className="rounded-2xl bg-hero-bg px-4 py-3 dark:bg-dark_b" key={item}>
                {item}
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-[24px] border border-border bg-white p-6 dark:border-dark_border dark:bg-darkmode">
          <p className="reactenz-eyebrow">Release traceability</p>
          <h2 className="reactenz-tools-section-title mb-4">Versioning and reproducibility</h2>
          <div className="space-y-4 text-sm leading-7 text-muted dark:text-white/60">
            <p>
              Public releases use versioned identifiers such as ReactEnzDB 2026.09.1. Each release should include
              a release date, schema file, field dictionary, downloadable SQLite database, CSV/TSV bulk files,
              release manifest, and SHA256 checksum list. The repaired core is identified by its data revision and
              exact snapshot. Thirty host-model identities are a separately sourced staging lookup; this does not
              establish original GEM redistribution or completed human review.
            </p>
            <p>
              Data users should cite the exact release version and access date. If a correction changes downstream
              interpretation, it should be issued as a patch release rather than silently replacing the previous release.
            </p>
            <p>
              Deprecated fields should remain documented for at least one major release cycle when feasible, so that
              existing scripts and published analyses remain interpretable.
            </p>
            {governance ? <p>Current working snapshot: {governance.snapshot_id}. Licence: {governance.licence.status}. Independent repository archive: {governance.long_term_archive.status}. HTTPS at the dated check: {governance.transport.https_status}. These are separate acceptance requirements; a server backup does not establish a repository DOI.</p> : null}
          </div>
        </div>
      </section>

      <section className="rounded-[24px] border border-border bg-white p-6 dark:border-dark_border dark:bg-darkmode">
        <p className="reactenz-eyebrow">Current maintainer statement</p>
        <h2 className="reactenz-tools-section-title mb-4">Statement for manuscript and website review</h2>
        <p className="text-sm leading-7 text-muted dark:text-white/60">
          ReactEnzDB will be maintained by the LinDing Group, UESTC. The database will provide versioned public
          releases, downloadable archives, schema documentation, checksums, and correction records. The maintainers
          commit to keeping the resource accessible and maintained for at least five years after publication, subject
          to institutional server availability and standard source-database licensing constraints. User questions,
          bug reports, and data correction requests should be sent to hlin@uestc.edu.cn.
        </p>
      </section>
    </main>
  );
}
