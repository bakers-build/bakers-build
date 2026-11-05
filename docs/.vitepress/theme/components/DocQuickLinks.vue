<script setup lang="ts">
// DocQuickLinks — the row of top-level entry points at the head of the docs
// home (Storybook's "Documentation · API · Tutorials · …" strip), BB-427 D7.
// One pill per destination, icon + label; external links open in a new tab.
// Icons: the coloured area icons where the key has one (shared with the
// sidebar strip), otherwise a stroke icon from ICONS.
import { ICONS } from './icons'
import { AREA_ICONS } from './area-icons'

defineProps<{
  items: Array<{ label: string; link: string; icon?: string; external?: boolean }>
}>()
</script>

<template>
  <nav class="doc-quicklinks" aria-label="Documentation areas">
    <a
      v-for="it in items"
      :key="it.link"
      class="doc-quicklink"
      :href="it.link"
      :target="it.external ? '_blank' : undefined"
      :rel="it.external ? 'noopener' : undefined"
    >
      <span
        v-if="it.icon && AREA_ICONS[it.icon]"
        class="doc-quicklink__icon doc-quicklink__icon--area"
        aria-hidden="true"
        v-html="AREA_ICONS[it.icon]"
      />
      <span v-else-if="it.icon && ICONS[it.icon]" class="doc-quicklink__icon" aria-hidden="true">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          v-html="ICONS[it.icon]"
        />
      </span>
      <span class="doc-quicklink__label">{{ it.label }}</span>
      <span v-if="it.external" class="doc-quicklink__ext" aria-hidden="true">↗</span>
      <span v-if="it.external" class="sr-only"> (opens in a new tab)</span>
    </a>
  </nav>
</template>
