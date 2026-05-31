import { defineConfig } from 'eslint/config'
import { createTypeScriptBaseConfig } from '../eslint.base.config.js'

export default defineConfig([
  ...createTypeScriptBaseConfig({
    tsconfigRootDir: import.meta.dirname,
  }),
  {
    files: ['src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
    },
  },
])
