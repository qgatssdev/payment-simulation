import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // The dev badge sits over the sidebar's live status; dev-only either way.
  devIndicators: false,
};

export default nextConfig;
