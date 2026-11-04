<script setup lang="ts">
import LogoMark from './LogoMark.vue'
</script>

<template>
  <footer class="lp-wrap flex flex-wrap items-center gap-x-7 gap-y-4 py-7">
    <a href="/" class="mr-auto flex items-center gap-[10px] no-underline">
      <LogoMark :size="28" :radius="6" />
      <span class="lp-display text-[22px] font-bold leading-[22px] tracking-[-0.77px]">
        bakers<span class="text-[color:var(--lp-crust)]">.</span>build
      </span>
    </a>
    <span class="lp-mono text-[13.5px] font-medium text-[color:var(--lp-ink-2)]">Open source</span>
    <a href="/get-started/" class="lp-mono text-[13.5px] font-medium text-[color:var(--lp-ink-2)] underline">Docs</a>
    <a href="https://github.com/bakers-build/bakers-build" class="lp-mono text-[13.5px] font-medium text-[color:var(--lp-ink-2)] underline">GitHub</a>
  </footer>
</template>
