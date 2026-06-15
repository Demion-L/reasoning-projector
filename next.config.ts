import type { NextConfig } from "next";

// On HuggingFace Spaces, /_next/static/* requests would go to Gradio (port 7860)
// instead of Next.js (port 3000). Setting assetPrefix routes those requests
// through /proxy/3000/ so HF forwards them to the correct server.
const assetPrefix = process.env.SPACE_HOST ? `/proxy/3000` : undefined;

const nextConfig: NextConfig = {
  assetPrefix,
};

export default nextConfig;
