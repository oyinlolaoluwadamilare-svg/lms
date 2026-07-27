import { FlatCompat } from "@eslint/eslintrc";
import boundaries from "eslint-plugin-boundaries";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

// Layering, enforced by lint (docs/03-architecture.md):
//   app/ -> services/ -> data/ -> domain/
//                     \-> auth/
//   ui/  presentational only, no data fetching
//   lib/ pure helpers, importable anywhere
//
// domain must not import from data, services, app or ui.
// data imports only domain and lib. app contains no business logic or SQL.
const layering = {
  files: ["**/*.{ts,tsx}"],
  plugins: { boundaries },
  settings: {
    "boundaries/include": ["src/**/*", "app/**/*"],
    "boundaries/elements": [
      { type: "domain", pattern: "src/domain/**" },
      { type: "data", pattern: "src/data/**" },
      { type: "services", pattern: "src/services/**" },
      { type: "auth", pattern: "src/auth/**" },
      { type: "ui", pattern: "src/ui/**" },
      { type: "lib", pattern: "src/lib/**" },
      { type: "app", pattern: "app/**" },
    ],
  },
  rules: {
    "boundaries/element-types": [
      "error",
      {
        default: "disallow",
        rules: [
          { from: "domain", allow: ["domain", "lib"] },
          { from: "data", allow: ["data", "domain", "lib"] },
          { from: "services", allow: ["services", "data", "domain", "auth", "lib"] },
          { from: "auth", allow: ["auth", "domain", "lib"] },
          { from: "ui", allow: ["ui", "lib", "domain"] },
          { from: "app", allow: ["app", "services", "auth", "ui", "lib", "domain"] },
          { from: "lib", allow: ["lib"] },
        ],
      },
    ],
  },
};

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  layering,
  {
    ignores: [".next/**", "node_modules/**", "playwright-report/**", "test-results/**"],
  },
];

export default eslintConfig;
