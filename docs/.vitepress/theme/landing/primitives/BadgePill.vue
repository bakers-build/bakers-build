<script setup lang="ts">
// c-badge-pill — bordered pill with Reflect's gradient text recipe 1:1.
// Used by the hero (with dot) and every section kicker.
defineProps<{ dot?: boolean }>()
</script>

<template>
  <span
    class="inline-flex items-center gap-2 rounded-[32px] border border-[rgba(186,156,255,.28)] bg-[rgba(164,143,255,.05)] px-4 py-[6px] text-[14px] font-semibold tracking-[.04em] shadow-[inset_0_-7px_11px_#a48fff1f] backdrop-blur-[6px]"
  >
    <span
      v-if="dot"
      class="h-[6px] w-[6px] rounded-full bg-[#BA9CFF] shadow-[0_0_10px_#BA9CFF]"
    />
    <span class="lp-badge-text"><slot /></span>
  </span>
</template>
