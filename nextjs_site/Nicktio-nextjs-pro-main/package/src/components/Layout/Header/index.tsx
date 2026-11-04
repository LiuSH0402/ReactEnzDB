"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { reactEnzDBBrand } from "@/lib/brand";

type NavItem = {
  label: string;
  href: string;
  match?: string[];
  children?: Array<{
    label: string;
    href?: string;
    section?: string;
    note?: string;
  }>;
};

const navItems: NavItem[] = [
  { label: "Home", href: "/" },
  { label: "Search", href: "/search" },
  {
    label: "Browse",
    href: "/browse",
    match: ["/reactions", "/relations", "/enzymes", "/hosts", "/organisms", "/chassis", "/expression-evidence"],
    children: [
      { label: "Reactions", href: "/reactions" },
      { label: "Enzymes", href: "/enzymes" },
      { label: "Hosts", href: "/hosts" },
    ],
  },
  { label: "Tools", href: "/tools" },
  { label: "Statistics", href: "/statistics" },
  { label: "Downloads", href: "/downloads" },
  { label: "API", href: "/documentation/api" },
  { label: "Help", href: "/help" },
  {
    label: "About",
    href: "/about",
    match: ["/methodology", "/maintenance"],
    children: [
      { label: "About ReactEnzDB", href: "/about" },
      { label: "Methodology & QA", href: "/methodology" },
      { label: "Maintenance", href: "/maintenance" },
    ],
  },
];

const headerSearch = {
  action: "/search#search-results",
  placeholder: "Reaction ID, EC, enzyme, UniProt, or host",
};

export default function Header() {
  const pathname = usePathname();
  const [sticky, setSticky] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const onScroll = () => setSticky(window.scrollY > 20);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    setMenuOpen(false);
    navRef.current?.querySelectorAll<HTMLDetailsElement>(".reactenz-nav-dropdown[open]").forEach((menu) => {
      menu.removeAttribute("open");
    });
  }, [pathname]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      navRef.current?.querySelectorAll<HTMLDetailsElement>(".reactenz-nav-dropdown[open]").forEach((menu) => {
        if (!menu.contains(event.target as Node)) menu.removeAttribute("open");
      });
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const menu = navRef.current?.querySelector<HTMLDetailsElement>(".reactenz-nav-dropdown[open]");
      if (event.key === "Escape" && menu) {
        menu.removeAttribute("open");
        menu.querySelector<HTMLElement>("summary")?.focus();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <header className={`reactenz-site-header ${sticky ? "is-sticky" : ""}`}>
      <div className="reactenz-header-shell">
        <Link href="/" className="reactenz-wordmark" aria-label={`${reactEnzDBBrand.name} home`}>
          <span className="reactenz-wordmark-copy">
            <img
              alt=""
              aria-hidden="true"
              className="reactenz-wordmark-art"
              height="54"
              src="/images/reactenzdb-wordmark-dark.svg"
              width="294"
            />
          </span>
        </Link>

        <button
          aria-expanded={menuOpen}
          aria-controls="reactenz-navigation"
          className={`reactenz-menu-toggle ${menuOpen ? "is-open" : ""}`}
          onClick={() => setMenuOpen((current) => !current)}
          type="button"
        >
          <span className="sr-only">Toggle navigation</span>
          <span />
          <span />
          <span />
        </button>

        <div id="reactenz-navigation" className={`reactenz-header-panel ${menuOpen ? "is-open" : ""}`}>
          <nav className="reactenz-nav" aria-label="Primary navigation" ref={navRef}>
            {navItems.map((item, index) => {
              const active = item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href) || item.match?.some((prefix) => pathname.startsWith(prefix));
              if (item.children) {
                return (
                  <details className="reactenz-nav-dropdown" key={item.href}>
                    <summary
                      aria-current={active ? "page" : undefined}
                      className={`reactenz-nav-link reactenz-nav-summary ${active ? "is-active" : ""}`}
                    >
                      <span className="reactenz-nav-index">{String(index + 1).padStart(2, "0")}</span>
                      {item.label}
                      <svg viewBox="0 0 16 16" aria-hidden="true">
                        <path d="m4 6 4 4 4-4" />
                      </svg>
                    </summary>
                    <div className={`reactenz-nav-submenu ${item.children.some((child) => child.section) ? "is-grouped" : ""}`}>
                      {item.children.map((child) => (
                        <div className="reactenz-nav-submenu-group" key={`${child.section ?? "item"}-${child.label}`}>
                          {child.section ? <span className="reactenz-nav-section-label">{child.section}</span> : null}
                          {child.href ? (
                            <Link
                              className={pathname === child.href || pathname.startsWith(`${child.href}/`) ? "is-active" : ""}
                              href={child.href}
                            >
                              {child.label}
                            </Link>
                          ) : (
                            <span aria-disabled="true" className="reactenz-nav-disabled">
                              <span>{child.label}</span>
                              {child.note ? <small>{child.note}</small> : null}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </details>
                );
              }
              return (
                <Link
                  aria-current={active ? "page" : undefined}
                  className={`reactenz-nav-link ${active ? "is-active" : ""}`}
                  href={item.href}
                  key={item.href}
                >
                  <span className="reactenz-nav-index">{String(index + 1).padStart(2, "0")}</span>
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <form action={headerSearch.action} className="reactenz-header-search" role="search">
            <input name="q" placeholder={headerSearch.placeholder} aria-label={headerSearch.placeholder} />
            <button type="submit" aria-label="Submit search">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="10.5" cy="10.5" r="6" />
                <path d="m15 15 4.5 4.5" />
              </svg>
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
