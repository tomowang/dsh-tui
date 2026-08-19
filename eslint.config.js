import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import globals from 'globals'

// A leading underscore marks a var/arg as intentionally unused (e.g. a
// parameter reserved for a not-yet-implemented behavior), rather than a
// forgotten one.
const noUnusedVarsIgnoringUnderscore = {
  '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
}

export default tseslint.config(
  { ignores: ['lib/**'] },
  {
    // Type-aware rules need real type info, so this block is scoped to what
    // tsconfig.json's `project` already covers.
    files: ['src/**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
      globals: globals.node,
    },
    rules: noUnusedVarsIgnoringUnderscore,
  },
  {
    // Tests and config files sit outside tsconfig.json's `project`, so they
    // get plain (non-type-aware) rules instead of a second tsconfig.
    files: ['test/**/*.ts', 'vitest.config.ts', 'eslint.config.js'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      globals: globals.node,
    },
    rules: noUnusedVarsIgnoringUnderscore,
  },
)
