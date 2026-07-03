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
    // TypeScript rules
    "@typescript-eslint/no-explicit-any": "warn",
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
    
    // Restrict console.log in production
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
