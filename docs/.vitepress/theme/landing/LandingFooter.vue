<script setup lang="ts">
import LogoMark from './LogoMark.vue'
import { REPO_URL, type Copy } from './copy'

defineProps<{ t: Copy }>()
</script>

<template>
  <footer class="lp-wrap flex flex-wrap items-center gap-x-7 gap-y-4 py-7">
    <a :href="t.home" class="mr-auto flex items-center gap-[10px] no-underline">
      <LogoMark :size="28" :radius="6" />
      <span class="lp-display text-[22px] font-bold leading-[22px] tracking-[-0.77px]">
        bakers<span class="text-[color:var(--lp-crust)]">.</span>build
      </span>
    </a>
    <span class="lp-mono text-[13.5px] font-medium text-[color:var(--lp-ink-2)]">{{ t.footer[0] }}</span>
    <a href="/get-started/" class="lp-mono text-[13.5px] font-medium text-[color:var(--lp-ink-2)] underline">{{ t.footer[1] }}</a>
    <a :href="REPO_URL" class="lp-mono text-[13.5px] font-medium text-[color:var(--lp-ink-2)] underline">{{ t.footer[2] }}</a>
  </footer>
</template>
