import "./globals.css";
import "./visual-tuning.css";
import type { Metadata } from "next";
import Header from "@/components/Layout/Header";
import Footer from "@/components/Layout/Footer";
import { ThemeProvider } from "next-themes";
import ScrollToTop from "@/components/ScrollToTop";
import { reactEnzDBBrand } from "@/lib/brand";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://reactenzdb.lin-group.cn";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  applicationName: reactEnzDBBrand.name,
  title: {
    default: reactEnzDBBrand.seoTitle,
    template: `%s | ${reactEnzDBBrand.name}`,
  },
  description: reactEnzDBBrand.description,
  keywords: ["enzyme database", "biochemical reaction", "biosynthesis", "bioretrosynthesis", "synthetic biology", "biocatalysis", "enzyme candidate"],
  authors: [{ name: "LinDing Group, UESTC" }],
  creator: "LinDing Group, UESTC",
  robots: { index: true, follow: true },
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: reactEnzDBBrand.name,
    title: reactEnzDBBrand.seoTitle,
    description: reactEnzDBBrand.description,
    url: "/",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider attribute="class" enableSystem={false} defaultTheme="light">
          <Header />
          {children}
          <Footer />
          <ScrollToTop />
        </ThemeProvider>
      </body>
    </html>
  );
}
