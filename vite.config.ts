import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const packageJson = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as {
  version?: string
}

function getVersionWithGitInfo(): string {
  const baseVersion = packageJson.version ?? '0.0.0'

  try {
    // Try to get git description
    const gitDescribe = execSync('git describe --tags --match "v*" 2>/dev/null || echo ""', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()

    if (!gitDescribe) {
      // No tags found, count commits since start
      const commitCount = parseInt(
        execSync('git rev-list --count HEAD 2>/dev/null || echo "0"', {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        }).trim(),
        10
      )
      return `${baseVersion}+${commitCount}`
    }

    // Parse git describe output: v0.1.0-5-gabcd1234
    const match = gitDescribe.match(/v?([\d.]+)(?:-(\d+)-g[0-9a-f]+)?/)
    if (match) {
      const tagVersion = match[1]
      const commitsSinceTag = match[2] ? parseInt(match[2], 10) : 0

      // If commits since tag, append as patch version
      if (commitsSinceTag > 0) {
        const parts = tagVersion.split('.')
        const patch = parseInt(parts[2] ?? '0', 10)
        return `${parts[0]}.${parts[1]}.${patch + commitsSinceTag}`
      }

      return tagVersion
    }

    return baseVersion
  } catch {
    return baseVersion
  }
}

const appVersion = getVersionWithGitInfo()
const buildTimestamp = new Date().toLocaleString('de-DE')
const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1]
const base = process.env.GITHUB_ACTIONS === 'true' && repositoryName ? `/${repositoryName}/` : '/'

// https://vite.dev/config/
export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __BUILD_TIMESTAMP__: JSON.stringify(buildTimestamp),
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png', 'masked-icon.svg'],
      manifest: {
        name: 'DigiKladde - Gleitschirmflug-Kursverwaltung',
        short_name: 'DigiKladde',
        description: 'App zur Erfassung von Gleitschirmflug-Praxiskursen',
        start_url: base,
        scope: base,
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#0f766e',
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webmanifest}'],
      },
    }),
  ],
})
