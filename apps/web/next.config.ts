import type { NextConfig } from 'next';

const API_URL = process.env.API_URL ?? 'http://localhost:4000';

const config: NextConfig = {
  // The browser only talks to this app; /api is forwarded to the Express API.
  // Same origin means httpOnly cookies work without CORS. In production Nginx routes /api straight to the API.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_URL}/api/:path*` }];
  },
  poweredByHeader: false,
};

export default config;
