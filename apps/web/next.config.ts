import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@pal/engine"],
  async headers() {
    return [
      {
        source: "/assets/pets/:path*",
        headers: [
          {
            key: "Access-Control-Allow-Origin",
            value: "*",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
