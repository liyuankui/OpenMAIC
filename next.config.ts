import type { NextConfig } from 'next';

// Determine build mode based on environment
const buildMode = process.env.BUILD_MODE || 'standalone'; // 'standalone' | 'export' | 'vercel'

const nextConfig: NextConfig = {
  // Build mode configuration
  output: buildMode === 'export' ? 'export' : 
          buildMode === 'vercel' || process.env.VERCEL ? undefined : 
          'standalone',
  
  transpilePackages: ['mathml2omml', 'pptxgenjs'],
  serverExternalPackages: [],
  
  experimental: {
    proxyClientMaxBodySize: '200mb',
  },
  
  // Static export specific settings
  ...(buildMode === 'export' && {
    images: {
      unoptimized: true,
    },
    trailingSlash: true,
  }),
};

export default nextConfig;

import('@opennextjs/cloudflare').then(m => m.initOpenNextCloudflareForDev());
