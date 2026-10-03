import nextPlugin from "@next/eslint-plugin-next";
import tseslint from "typescript-eslint";

/**
 * Flat ESLint configuration.
 *
 * Built directly on the flat configs shipped by @next/eslint-plugin-next and
 * typescript-eslint rather than through the eslintrc compatibility layer, which
 * keeps the dependency surface smaller and removes a whole class of
 * version-mismatch failure.
 */

export default [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "coverage/**",
      "next-env.d.ts",
      "tests/browser/**",
      "public/**",
    ],
  },
  nextPlugin.configs["core-web-vitals"],
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "no-console": ["error", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "smart"],
    },
  },
  {
    // Command-line tools report their own output; the browser bundle must not.
    files: ["scripts/**/*.mjs"],
    rules: {
      "no-console": "off",
    },
  },
];