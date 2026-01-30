import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,

  // Turbopack config (Next.js 16)
  turbopack: {
    rules: {
      '*.glsl': {
        loaders: ['raw-loader'],
        as: '*.js',
      },
      '*.vert': {
        loaders: ['raw-loader'],
        as: '*.js',
      },
      '*.frag': {
        loaders: ['raw-loader'],
        as: '*.js',
      },
    },
    resolveAlias: {
      "zod/v3": "zod",
      "zod/v4": "zod",
    },
  },



  // Webpack fallback (for production builds)
  webpack: (config) => {
    config.module.rules.push({
      test: /\.(glsl|vert|frag)$/,
      type: 'asset/source',
    });
    // Fix for ai-sdk zod version resolution
    config.resolve.alias = {
      ...config.resolve.alias,
      "zod/v3": "zod",
      "zod/v4": "zod",
    };
    return config;
  },
};

export default nextConfig;
