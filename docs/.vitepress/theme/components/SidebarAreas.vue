<script setup lang="ts">
// SidebarAreas — the head of the docs sidebar, after storybook.js.org/docs:
// one row per documentation area with a coloured 18px icon, then the version
// row under a hairline. Rendered through the default theme's
// `sidebar-nav-before` slot (see theme/index.ts), so it sits inside the
// sidebar's scroll container on desktop and inside the mobile drawer alike.
// Data comes from themeConfig: `sidebarAreas`, `docsVersion`, `releasesUrl`.
// BB-427 D7.
import { computed } from 'vue'
import { useData, useRoute } from 'vitepress'
import { AREA_ICONS } from './area-icons'

type Area = { label: string; link: string; icon: string; match?: string; external?: boolean }

const { theme } = useData()
const route = useRoute()
const areas = computed<Area[]>(() => theme.value.sidebarAreas ?? [])
const version = computed<string>(() => theme.value.docsVersion ?? '')
const releasesUrl = computed<string>(() => theme.value.releasesUrl ?? '')
const isActive = (a: Area) => !a.external && route.path.startsWith(a.match ?? a.link)

// One docs version exists today; the second option opens the release list.
function onVersion(e: Event) {
  const select = e.target as HTMLSelectElement
  if (select.value === 'releases' && releasesUrl.value) {
    window.open(releasesUrl.value, '_blank', 'noopener')
  }
  select.value = 'current'
}
</script>

<template>
  <nav class="sb-areas" aria-label="Documentation areas">
    <a
      v-for="a in areas"
      :key="a.link"
      class="sb-area"
      :class="{ 'is-active': isActive(a) }"
      :href="a.link"
      :target="a.external ? '_blank' : undefined"
      :rel="a.external ? 'noopener' : undefined"
      :aria-current="isActive(a) ? 'page' : undefined"
    >
      <span class="sb-area__icon" aria-hidden="true" v-html="AREA_ICONS[a.icon] ?? ''" />
      <span>{{ a.label }}</span>
      <span v-if="a.external" class="sr-only"> (opens in a new tab)</span>
    </a>
  </nav>
  <div v-if="version" class="sb-version">
    <label class="sr-only" for="bakers-docs-version">Documentation version</label>
    <select id="bakers-docs-version" @change="onVersion">
      <option value="current">Version {{ version }}</option>
      <option v-if="releasesUrl" value="releases">All releases on npm ↗</option>
    </select>
  </div>
</template>
