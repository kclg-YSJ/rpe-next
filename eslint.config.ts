import tseslint from 'typescript-eslint';

// ESLint 9 loads this TypeScript flat config through `jiti` (a dev dependency).
//
// `no-explicit-any` only rejects written `any` annotations. APIs such as
// `JSON.parse`, `executeJavaScript` and untyped Electron bridge objects also
// produce `any`; the type-aware `no-unsafe-*` rules below catch that flow in
// production code. Test harnesses and Electron smoke scripts intentionally
// drive dynamic page globals, so they keep the explicit-`any` check only.
const typeAwareUnsafe = {
  '@typescript-eslint/no-explicit-any': 'error',
  '@typescript-eslint/no-unsafe-assignment': 'error',
  '@typescript-eslint/no-unsafe-member-access': 'error',
  '@typescript-eslint/no-unsafe-argument': 'error',
  '@typescript-eslint/no-unsafe-return': 'error',
  '@typescript-eslint/no-unsafe-call': 'error',
};

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'assets/mods/**', 'tmp-probe/**', '.kilo/**'],
  },
  {
    files: ['src/**/*.ts', 'desktop/**/*.ts', 'collaboration-server/**/*.ts', 'vite.config.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: typeAwareUnsafe,
  },
  {
    files: ['test/**/*.ts', 'tools/**/*.ts', '*.ts'],
    ignores: ['vite.config.ts'],
    languageOptions: { parser: tseslint.parser },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: { '@typescript-eslint/no-explicit-any': 'error' },
  },
];
