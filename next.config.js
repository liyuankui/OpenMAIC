/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable static export for Cloudflare Pages
  output: 'export',
  
  // Disable server-side features for static export
  images: {
    unoptimized: true,
  },
  
  // trailingSlash handling for static hosting
  trailingSlash: true,
  
  // Skip build-time optimization for static export
  swcMinify: true,
  
  // Exclude API routes from static build
  // (they'll be deployed separately to Railway/Render)
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
};

module.exports = nextConfig;
