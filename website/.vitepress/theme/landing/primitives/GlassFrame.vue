<script setup lang="ts">
// c-frame — Reflect's DOUBLE panel: outer glass frame (blur, 26px radius)
// + inner surface (18px radius), with the running gradient border, the
// wope hover pair, and optionally the in-panel star field. Used by the
// pipeline frame AND the chat showcase, consistent everywhere.
import GradientBorder from './GradientBorder.vue'
import MagicalHover from './MagicalHover.vue'
import StarCanvas from './StarCanvas.vue'

withDefaults(defineProps<{ stars?: number }>(), { stars: 100 })
</script>

<template>
  <div
    class="group relative rounded-[26px] border border-white/[.08] bg-[rgba(20,17,36,.42)] p-[10px] shadow-[0_40px_100px_rgba(0,0,0,.6)] backdrop-blur-[18px]"
  >
    <GradientBorder />
    <MagicalHover />
    <slot name="chrome" />
    <div class="relative overflow-hidden rounded-[18px] border border-white/[.07] bg-[rgba(10,9,20,.55)]">
      <StarCanvas v-if="stars > 0" :count="stars" />
      <div class="relative z-[1]">
        <slot />
      </div>
    </div>
  </div>
</template>
