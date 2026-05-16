/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
  // pdf-parse v2 ships as ESM with conditional exports; bundling it through
  // Next's RSC webpack layer trips "Object.defineProperty called on non-object"
  // during interop. Let Node resolve it natively.
  serverExternalPackages: ["pdf-parse"],
  modularizeImports: {
    "@mui/icons-material": {
      transform: "@mui/icons-material/{{member}}",
    },
  },
  // Render's `pnpm install` strips devDependencies (NODE_ENV=production), so
  // ESLint isn't on disk during `next build`. We lint as a separate CI step
  // (`pnpm lint`) and locally — no need to repeat it during deploy.
  eslint: {
    ignoreDuringBuilds: true,
  },
  webpack: (config) => {
    config.resolve.alias.canvas = false;
    return config;
  },
};

export default nextConfig;
