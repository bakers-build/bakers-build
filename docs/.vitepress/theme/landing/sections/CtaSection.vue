<script setup lang="ts">
// c-cta — "Start with one ticket": star-backed closing band with the
// bottom glow and the brand CTA.
import PillButton from '../primitives/PillButton.vue'
import StarCanvas from '../primitives/StarCanvas.vue'
</script>

<template>
  <div class="relative px-6 pb-[110px] pt-40 text-center">
    <StarCanvas :count="130" />
    <div
      aria-hidden="true"
      class="pointer-events-none absolute bottom-0 left-1/2 h-[320px] w-[800px] max-w-full -translate-x-1/2 blur-[22px]"
      style="
        background:
          radial-gradient(ellipse 45% 65% at 50% 100%, rgba(164, 143, 255, 0.3), transparent 75%),
          radial-gradient(ellipse 65% 70% at 50% 100%, rgba(229, 156, 255, 0.1), transparent 80%);
      "
    />
    <h2 class="lp-headline sr relative z-[1] mb-4 text-[clamp(36px,4.8vw,58px)] font-bold tracking-[-.022em]">
      Start with one ticket
    </h2>
    <p class="sr dl1 relative z-[1] mb-8 text-[19px] text-[color:var(--lp-text-2)]">MIT licensed. Your agent, your machine, your rules.</p>
    <div class="sr dl2 relative z-[1]">
      <PillButton href="/get-started/machine" variant="brand">Set up a machine</PillButton>
      <PillButton href="/get-started/connector" variant="ghost">Set up a connector</PillButton>
    </div>
  </div>
</template>
