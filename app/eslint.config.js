import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig } from 'eslint/config'
import { createTypeScriptBaseConfig } from '../eslint.base.config.js'

export default defineConfig([
  ...createTypeScriptBaseConfig({
    tsconfigRootDir: import.meta.dirname,
    browser: true,
    ignores: ['scripts'],
  }),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    rules: {
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
      'react-hooks/set-state-in-effect': 'off',
    },
  },
])
