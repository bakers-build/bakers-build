<script setup lang="ts">
// The bread-slice mark (Figma "Bildmarke · Brotscheibe"), composed from its two
// exported layers at the positions the design gives them.
defineProps<{ size: number; radius: number }>()
</script>

<template>
  <span
    class="relative block shrink-0 overflow-hidden bg-[color:var(--lp-butter)]"
    :style="{ width: `${size}px`, height: `${size}px`, borderRadius: `${radius}px` }"
    aria-hidden="true"
  >
    <span class="absolute inset-[21.43%]">
      <img src="/landing/mark-face.svg" alt="" class="absolute inset-[-2.12%] block size-[104.25%] max-w-none" />
    </span>
    <span class="absolute inset-[9.29%_12.08%_77.08%_74.29%]">
      <span class="absolute left-1/2 top-1/2 h-[47.14%] w-[94.28%] -translate-x-1/2 -translate-y-1/2 rotate-45">
        <img src="/landing/mark-crumb.svg" alt="" class="absolute inset-[-17%_-8.5%] block h-[134%] w-[117%] max-w-none" />
      </span>
    </span>
  </span>
</template>
