/** @type {import('next').NextConfig} */
const nextConfig = {
  // Audio blobs can be a few MB; allow larger server action / route bodies.
  experimental: {
    serverActions: { bodySizeLimit: "25mb" },
  },
};

export default nextConfig;
