import Image from "next/image";
import Link from "next/link";
import VisitorCounter from "@/components/Layout/Footer/VisitorCounter";
import { reactEnzDBBrand } from "@/lib/brand";
import { REACTENZDB_RELEASE } from "@/lib/release";
import { getLocalReleaseRevision } from "@/lib/localReleaseRevision";

const groups: Array<{
  title: string;
  links: Array<{ label: string; href?: string; note?: string }>;
}> = [
  {
    title: "Explore",
    links: [
      { label: "Search", href: "/search" },
      { label: "Browse", href: "/browse" },
      { label: "Tools", href: "/tools" },
      { label: "Statistics", href: "/statistics" },
      { label: "Help", href: "/help" },
    ],
  },
  {
    title: "Data",
    links: [
      { label: "Reactions", href: "/reactions" },
      { label: "Enzymes", href: "/enzymes" },
      { label: "Hosts", href: "/hosts" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Downloads", href: "/downloads" },
      { label: "API", href: "/documentation/api" },
      { label: "About", href: "/about" },
      { label: "Methodology", href: "/methodology" },
      { label: "Maintenance", href: "/maintenance" },
    ],
  },
];

export default function Footer() {
  const localRevision = getLocalReleaseRevision();
  return (
    <footer className="reactenz-footer">
      <div className="reactenz-footer-main reactenz-container">
        <div className="reactenz-footer-brand">
          <div className="reactenz-footer-brandmark" aria-hidden="true">
            <Image src="/icon.svg" alt="" width={44} height={44} unoptimized />
          </div>
          <div>
            <strong>{reactEnzDBBrand.name}</strong>
            <p>{reactEnzDBBrand.formalName}</p>
          </div>
        </div>
        {groups.map((group) => (
          <div className="reactenz-footer-group" key={group.title}>
            <h2>{group.title}</h2>
            <div>
              {group.links.map((item) => item.href ? (
                <Link href={item.href} key={item.href}>{item.label}</Link>
              ) : (
                <span aria-disabled="true" className="reactenz-footer-disabled" key={item.label}>
                  {item.label} <small>{item.note}</small>
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="reactenz-footer-meta reactenz-container">
        <span>ReactEnzDB web release {REACTENZDB_RELEASE.version}{localRevision ? ` · ${localRevision.published ? "Data revision" : "Local data revision"} ${localRevision.date}` : ""}</span>
        <span>LinDing Group · UESTC</span>
        <VisitorCounter />
      </div>
    </footer>
  );
}
