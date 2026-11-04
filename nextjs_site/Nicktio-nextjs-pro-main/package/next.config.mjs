/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
  async redirects() {
    return [
      { source: "/blog", destination: "/documentation", permanent: false },
      { source: "/blog/:slug*", destination: "/documentation", permanent: false },
      { source: "/pricing", destination: "/downloads", permanent: false },
      { source: "/tools/retrosynthesis", destination: "/tools", permanent: false },
      { source: "/signin", destination: "/search", permanent: false },
      { source: "/signup", destination: "/search", permanent: false },
      { source: "/forgot-password", destination: "/search", permanent: false },
      { source: "/contact", destination: "/maintenance", permanent: false },
    ];
  },
};

export default nextConfig;
