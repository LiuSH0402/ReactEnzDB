import { HeaderItem } from "../../../../types/menu";

export const headerData: HeaderItem[] = [
  { label: "Home", href: "/" },
  { label: "Search", href: "/search" },
  { label: "Browse", href: "/browse" },
  { label: "Tools", href: "/tools" },
  {
    label: "Resources",
    href: "#",
    submenu: [
      { label: "Downloads", href: "/downloads" },
      { label: "API documentation", href: "/documentation/api" },
      { label: "Methodology and QA", href: "/methodology" },
      { label: "Maintenance", href: "/maintenance" },
    ],
  },
  { label: "Help", href: "/help" },
  { label: "About", href: "/about" },
];
