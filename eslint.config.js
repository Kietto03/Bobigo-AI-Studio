import js from "@eslint/js";
import globals from "globals";

export default [
    {
        ignores: ["web/vendor/**", "node_modules/**", "generated/**", ".venv/**"],
    },
    js.configs.recommended,
    {
        files: ["web/**/*.js", "tests/frontend/**/*.js"],
        languageOptions: {
            ecmaVersion: 2023,
            sourceType: "module",
            globals: {
                ...globals.browser,
                // App-wide singletons loaded via <script> before modules.
                BobigoDB: "readonly",
                BobigoI18n: "readonly",
                BobigoCompanions: "readonly",
                BobigoProjects: "readonly",
                marked: "readonly",
                DOMPurify: "readonly",
                hljs: "readonly",
            },
        },
        rules: {
            // Codebase style: 4-space indent keeps long fluent chains readable.
            "no-unused-vars": ["error", {
                argsIgnorePattern: "^_",
                varsIgnorePattern: "^_",
                caughtErrors: "none",
            }],
            "no-empty": ["error", { allowEmptyCatch: true }],
            "no-console": "off",       // console is the app's only logger today
            "no-async-promise-executor": "off",
        },
    },
    {
        files: ["tests/frontend/**/*.js"],
        languageOptions: {
            globals: { describe: "readonly", it: "readonly", expect: "readonly", beforeEach: "readonly", afterEach: "readonly" },
        },
    },
];
