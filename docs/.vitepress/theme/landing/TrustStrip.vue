<script setup lang="ts">
import type { Copy } from './copy'

defineProps<{ t: Copy }>()
</script>

<template>
  <ul class="lp-mono m-0 flex list-none flex-col items-start gap-8 border-b-[1.5px] border-dashed border-[color:var(--lp-rule)] bg-[color:var(--lp-paper)] px-4 py-4 text-[14px] font-medium md:flex-row md:flex-wrap md:justify-center md:gap-x-[52px] md:gap-y-3">
    <li v-for="item in t.trust" :key="item" class="flex items-center gap-[10px]">
      <img src="/landing/spark-trust.svg" alt="" width="15" height="15" />
      {{ item }}
    </li>
  </ul>
</template>
