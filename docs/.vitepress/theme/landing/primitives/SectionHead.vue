<script setup lang="ts">
// c-section-head — badge-pill kicker + gradient h2 + lead, with the
// prototype's staggered scroll-reveal classes baked in.
import BadgePill from './BadgePill.vue'

defineProps<{ kicker: string }>()
</script>

<template>
  <div class="mx-auto mb-14 max-w-[66ch] text-center">
    <BadgePill class="sr mb-[18px]">{{ kicker }}</BadgePill>
    <h2 class="lp-headline sr dl1 mb-5 text-[clamp(34px,4.2vw,56px)] font-bold leading-tight tracking-[-.022em]">
      <slot name="title" />
    </h2>
    <p v-if="$slots.lead" class="sr dl2 text-[20px] leading-[1.65] text-[color:var(--lp-text-2)]">
      <slot name="lead" />
    </p>
  </div>
</template>
