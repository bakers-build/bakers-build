<template>
  <div v-html="svg" :class="props.class"></div>
</template>

<script setup lang="ts">
// BbMermaid — the docs' Mermaid renderer, registered under the name
// `Mermaid` so it takes over from vitepress-plugin-mermaid's component (the
// markdown plugin keeps emitting <Mermaid id graph>). Adapted from that
// component (MIT) with two changes: the colour scheme is always the `base`
// theme with our own variables (theme/mermaid-theme.ts), and the first render
// waits for the web fonts, since Mermaid measures text at render time and a
// fallback font gives every node the wrong width. The site is light only, so
// it renders once.
import { onMounted, ref } from 'vue'
import mermaid from 'mermaid'
import { MERMAID_THEME } from '../mermaid-theme'

const props = defineProps<{ graph: string; id: string; class?: string }>()

const svg = ref<string>('')
let settings: Record<string, unknown> = { securityLevel: 'loose', startOnLoad: false }

async function renderChart() {
  mermaid.initialize({ ...settings, theme: 'base', themeVariables: MERMAID_THEME })
  const { svg: code } = await mermaid.render(props.id, decodeURIComponent(props.graph))
  svg.value = code
}

onMounted(async () => {
  // @ts-expect-error — virtual module provided by vitepress-plugin-mermaid: the
  // `mermaid` block of .vitepress/config.mts (look, font, …).
  const mod = await import('virtual:mermaid-config')
  if (mod?.default) settings = { ...settings, ...mod.default }
  if (document.fonts?.ready) await document.fonts.ready
  await renderChart()
})
</script>
