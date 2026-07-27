import type { Config } from "tailwindcss";

// Tokens sourced from docs/06-ui-spec.md — the single place hex values may appear.
// Components must reference these names, never inline hex (03-architecture.md).
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./src/ui/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#1b1917",
        muted: "#6b6560",
        line: "#e5e1dc",
        surface: "#fffefb",
        raised: "#f6f3ef",
        accent: "#7A77CF",
        won: "#0F766E",
        risk: "#B45309",
        lost: "#9F1239",
        stale: {
          fresh: "#0F766E", // 0-7 days
          ok: "#3B82F6", // 8-21 days
          warn: "#B45309", // 22-45 days
          cold: "#9F1239", // 46+ days
        },
      },
      borderRadius: {
        token: "11px",
      },
      fontSize: {
        table: "13.5px",
      },
    },
  },
  plugins: [],
};

export default config;
