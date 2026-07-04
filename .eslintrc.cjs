module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    project: "./tsconfig.json",
  },
  plugins: ["@typescript-eslint", "import"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:import/recommended",
    "plugin:import/typescript",
  ],
  env: {
    node: true,
    es2022: true,
  },
  rules: {
    // TypeScript rules — STRICT enforcement
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/no-unsafe-assignment": "error",
    "@typescript-eslint/no-unsafe-member-access": "error",
    "@typescript-eslint/no-unsafe-call": "error",
    "@typescript-eslint/no-unsafe-return": "error",
    "@typescript-eslint/no-unsafe-argument": "error",
    "@typescript-eslint/no-implied-eval": "error",
    "@typescript-eslint/require-await": "error",
    "@typescript-eslint/await-thenable": "error",
    "@typescript-eslint/no-floating-promises": "error",
    "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    "@typescript-eslint/consistent-type-imports": "error",
    
    // Ban @ts-nocheck with comment
    "no-restricted-syntax": [
      "error",
      {
        selector: "Program > CommentBlock",
        message: "Use @ts-check at the top of files instead of @ts-nocheck. Fix the type error instead of suppressing it.",
      },
      {
        selector: "Program > CommentLine[value=' @ts-nocheck']",
        message: "Use @ts-check at the top of files instead of @ts-nocheck. Fix the type error instead of suppressing it.",
      },
    ],
    
    // Restrict console.log in production — all console methods banned in server/
    "no-console": [
      "error",
      {
        allow: ["warn", "error"],
      },
    ],
    
    // Import rules
    "import/order": [
      "error",
      {
        groups: [
          "builtin",
          "external",
          "internal",
          ["parent", "sibling"],
          "index",
        ],
        "newlines-between": "always",
        alphabetize: {
          order: "asc",
          caseInsensitive: true,
        },
      },
    ],
    
    // General code quality
    "no-debugger": "error",
    "no-eval": "error",
    "no-new-wrappers": "error",
    "prefer-const": "error",
    "radix": "error",
    "yoda": ["error", "never"],
  },
  settings: {
    "import/resolver": {
      typescript: {
        project: "./tsconfig.json",
      },
    },
  },
};
