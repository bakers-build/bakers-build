import { join } from 'node:path'
import { cwd } from 'node:process'
import tailwindcss from '@tailwindcss/vite'

/** @type { import('@storybook/html-vite').StorybookConfig } */
const config = {
  stories: ['../components/**/*.component.yml'],
  // Serve the built theme assets (icon sprite etc.) at the same URL Drupal uses,
  // so the Storybook icon() preview resolves the same sprite as Drupal.
  staticDirs: [
    { from: '../dist', to: '/themes/custom/bb_theme/dist' },
    { from: '../logo.svg', to: '/themes/custom/bb_theme/logo.svg' },
    { from: '../logo-wordmark.svg', to: '/themes/custom/bb_theme/logo-wordmark.svg' },
    { from: '../logo-wordmark-steam.svg', to: '/themes/custom/bb_theme/logo-wordmark-steam.svg' },
    { from: '../assets/line', to: '/themes/custom/bb_theme/assets/line' },
  ],
  addons: [
    '@storybook/addon-docs',
    // Toolbar for the Designbook theme global (light, cozy, dark) that preview.js maps to data-mode.
    '@storybook/addon-themes',
    { name: 'storybook-addon-designbook' },
    {
      name: 'storybook-addon-sdc',
      options: {
        sdcStorybookOptions: {
          useBasicArgsForStories: false,
          twigLib: 'twing',
          namespace: 'bb_theme',
        },
        vitePluginTwingDrupalOptions: {
          hooks: join(cwd(), '.storybook/twing-hooks.js'),
          namespaces: {
            bb_theme: ['../components'],
          },
        },
      },
    },
  ],
  // `true` accepts any Host header — needed so a tunnel hostname (cloudflared, ngrok, …) can
  // reach the dev server for a remote preview. Storybook's own host check is separate from
  // Vite's `server.allowedHosts` and lives here.
  core: { builder: { name: '@storybook/builder-vite' }, allowedHosts: true },
  framework: { name: '@storybook/html-vite', options: {} },
  async viteFinal(config) {
    const { mergeConfig } = await import('vite')
    return mergeConfig(config, {
      plugins: [tailwindcss()],
    })
  },
}
export default config
