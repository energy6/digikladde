import js from '@eslint/js'
import { defineConfig } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export function createTypeScriptBaseConfig({
  tsconfigRootDir,
  browser = false,
  ignores = [],
} = {}) {
  return defineConfig([
    {
      ignores: ['dist', 'node_modules', ...ignores],
    },
    {
      files: ['**/*.{js,mjs,cjs}'],
      extends: [js.configs.recommended],
      languageOptions: {
        globals: {
          ...globals.node,
          ...(browser ? globals.serviceworker : {}),
        },
      },
    },
    {
      files: ['**/*.{ts,tsx}'],
      extends: [
        js.configs.recommended,
        tseslint.configs.recommended,
        tseslint.configs.recommendedTypeChecked,
      ],
      languageOptions: {
        parserOptions: {
          projectService: true,
          tsconfigRootDir,
        },
        globals: browser ? { ...globals.browser } : { ...globals.node },
      },
      rules: {
        '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
        '@typescript-eslint/no-deprecated': 'warn',
        '@typescript-eslint/no-floating-promises': 'error',
      },
    },
  ])
}
