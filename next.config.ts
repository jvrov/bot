import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Imagens das lojas vêm de muitos domínios; usamos <img> comum.
  images: { unoptimized: true },
};

export default nextConfig;
