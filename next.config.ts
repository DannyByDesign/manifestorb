import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,

  // Turbopack: used only when running `next dev` without --webpack. Default dev
  // script uses webpack because Turbopack currently hangs on this project.
  turbopack: {
    rules: {
      "src/shaders/*.glsl": { loaders: ["raw-loader"], as: "*.js" },
      "src/shaders/*.vert": { loaders: ["raw-loader"], as: "*.js" },
      "src/shaders/*.frag": { loaders: ["raw-loader"], as: "*.js" },
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
      type: "asset/source",
    });
    config.resolve.alias = {
      ...config.resolve.alias,
      "zod/v3": "zod",
      "zod/v4": "zod",
    };
    return config;
  },
};

export default nextConfig;
