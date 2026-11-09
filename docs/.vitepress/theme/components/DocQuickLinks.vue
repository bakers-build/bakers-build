<script setup lang="ts">
defineProps<{
  items: Array<{ label: string; text: string; link: string; external?: boolean }>
}>()
</script>

<template>
  <nav class="doc-quicklinks" aria-label="Related guides">
    <ul>
      <li v-for="it in items" :key="it.link">
        <a
          class="doc-quicklink"
          :href="it.link"
          :target="it.external ? '_blank' : undefined"
          :rel="it.external ? 'noopener' : undefined"
        >
          <strong class="doc-quicklink__label">{{ it.label }}</strong>. <span class="doc-quicklink__text">{{ it.text }}</span>&nbsp;<span class="doc-quicklink__arrow" aria-hidden="true">{{ it.external ? '↗' : '→' }}</span>
          <span v-if="it.external" class="sr-only"> (opens in a new tab)</span>
        </a>
      </li>
    </ul>
  </nav>
</template>
