import { PHASE_DEVELOPMENT_SERVER } from "next/constants.js";

// Keep development chunks separate from production builds to avoid stale assets.
export default (phase) => ({
  distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next",
  devIndicators: false,
});
