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
  const [major = '0', minor = '0', patchRaw = '0'] = baseVersion.split('.')
  const patchBase = Number.parseInt(patchRaw, 10)
  const safePatchBase = Number.isNaN(patchBase) ? 0 : patchBase

  try {
    const tagsToTry = [`v${baseVersion}`, baseVersion]

    for (const tagName of tagsToTry) {
      try {
        execSync(`git rev-parse -q --verify refs/tags/${tagName}`, {
          stdio: 'ignore',
        })

        const commitCountText = execSync(`git rev-list --count ${tagName}..HEAD`, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        }).trim()
        const commitsSinceTag = Number.parseInt(commitCountText, 10)
        const safeCommitsSinceTag = Number.isNaN(commitsSinceTag) ? 0 : commitsSinceTag

        return `${major}.${minor}.${safePatchBase + safeCommitsSinceTag}`
      } catch {
        // Try next candidate tag.
      }
    }

    // If matching release tag is not present, keep package version unchanged.
    return baseVersion
  } catch {
    return baseVersion
  }
}

const appVersion = getVersionWithGitInfo()
const buildTimestampUtc = new Date().toISOString()
const defaultRepositorySlug = 'energy6/digikladde'

function getRepositorySlug(): string {
  const envSlug = process.env.GITHUB_REPOSITORY?.trim()
  if (envSlug) return envSlug

  try {
    const remoteUrl = execSync('git remote get-url origin', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim()

    const sshMatch = remoteUrl.match(/^git@github\.com:(?<slug>[^\s]+?)(?:\.git)?$/)
    if (sshMatch?.groups?.slug) return sshMatch.groups.slug

    const httpsMatch = remoteUrl.match(/^https?:\/\/github\.com\/(?<slug>[^\s]+?)(?:\.git)?$/)
    if (httpsMatch?.groups?.slug) return httpsMatch.groups.slug
  } catch {
    // Fall back to default slug.
  }

  return defaultRepositorySlug
}

const repositorySlug = getRepositorySlug()
const repositoryName = repositorySlug.split('/')[1]
const appReadmeUrl = `https://github.com/${repositorySlug}/blob/main/README.md`
const base = process.env.GITHUB_ACTIONS === 'true' && repositoryName ? `/${repositoryName}/` : '/'

// https://vite.dev/config/
export default defineConfig({
  base,
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __BUILD_TIMESTAMP_UTC__: JSON.stringify(buildTimestampUtc),
    __APP_README_URL__: JSON.stringify(appReadmeUrl),
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
