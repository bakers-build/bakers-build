<template>
  <div v-html="svg" :class="props.class"></div>
</template>

<script setup lang="ts">
// BbMermaid — the docs' Mermaid renderer, registered under the name
// `Mermaid` so it takes over from vitepress-plugin-mermaid's component (the
// markdown plugin keeps emitting <Mermaid id graph>). Adapted from that
// component (MIT) with two changes: the colour scheme is always the `base`
// theme with our own variables (theme/mermaid-theme.ts) — the stock component
// forces Mermaid's `dark` theme in dark mode, which ignores them — and the
// first render waits for the web fonts, since Mermaid measures text at render
// time and a fallback font gives every node the wrong width. BB-427 D7.
import { onMounted, onUnmounted, ref } from 'vue'
import mermaid from 'mermaid'
import { MERMAID_DARK, MERMAID_LIGHT } from '../mermaid-theme'

const props = defineProps<{ graph: string; id: string; class?: string }>()

const svg = ref<string>('')
let observer: MutationObserver | null = null
let settings: Record<string, unknown> = { securityLevel: 'loose', startOnLoad: false }

async function renderChart() {
  const dark = document.documentElement.classList.contains('dark')
  mermaid.initialize({
    ...settings,
    theme: 'base',
    themeVariables: dark ? MERMAID_DARK : MERMAID_LIGHT,
  })
  const { svg: code } = await mermaid.render(props.id, decodeURIComponent(props.graph))
  // A changing suffix makes v-html re-render even when the markup is
  // identical (the stock component's own workaround for theme switches).
  svg.value = `${code} <span style="display: none">${Math.random().toString(36).slice(2, 8)}</span>`
}

onMounted(async () => {
  // @ts-expect-error — virtual module provided by vitepress-plugin-mermaid: the
  // `mermaid` block of .vitepress/config.mts (look, font, …).
  const mod = await import('virtual:mermaid-config')
  if (mod?.default) settings = { ...settings, ...mod.default }
  if (document.fonts?.ready) await document.fonts.ready
  await renderChart()
  observer = new MutationObserver(() => void renderChart())
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
})

onUnmounted(() => observer?.disconnect())
</script>
