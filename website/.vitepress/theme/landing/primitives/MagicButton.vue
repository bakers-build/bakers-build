<script setup lang="ts">
// Reflect's "Click to see magic" recipe 1:1 (prototype iteration 8):
// glass chip (6px radius, white/4 bg, 1px white/10 border, inset sheen,
// backdrop blur), their sparkle SVG, rainbow gradient label, and the whole
// button cycling hue-rotate 2s linear infinite.
defineProps<{ label: string }>()
defineEmits<{ click: [] }>()
</script>

<style>
/* the rainbow label (Reflect's play-button gradient) + the hue cycle over
 * the whole chip — unscoped, lp- namespaced */
.lp-rainbow-text {
  background: linear-gradient(to right, #fc72ff, #8f68ff, #487bff, #2cd9ff, #2cffcc);
  background-size: 200% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  color: transparent;
}
@media (prefers-reduced-motion: no-preference) {
  .lp-hue {
    animation: lp-hue-rotate 2s infinite linear;
  }
  @keyframes lp-hue-rotate {
    to {
      filter: hue-rotate(360deg);
    }
  }
}
</style>

<template>
  <button
    type="button"
    class="lp-hue inline-flex cursor-pointer items-center gap-[6px] rounded-[6px] border border-white/10 bg-white/[.04] py-2 pl-3 pr-4 shadow-[inset_0_0_12px_#ffffff14] backdrop-blur-[12px] transition-[opacity,transform] duration-300 ease-[cubic-bezier(.6,.6,0,1)] hover:-translate-y-px hover:scale-[1.02]"
    @click="$emit('click')"
  >
    <svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M9.75 13C14 13 14 7.75 14 7.75C14 7.75 14 13 18.25 13C14 13 14 18.25 14 18.25C14 18.25 14 13 9.75 13Z" fill="#fa5fff" />
      <path d="M5.75 8C8 8 8 5.75 8 5.75C8 5.75 8 8 10.25 8C8 8 8 10.25 8 10.25C8 10.25 8 8 5.75 8Z" fill="#fa5fff" />
      <path d="M7.75 16.25H7.76M18.25 5.75H18.26M18.25 18.25H18.26M14 7.75C14 7.75 14 13 9.75 13C14 13 14 18.25 14 18.25C14 18.25 14 13 18.25 13C14 13 14 7.75 14 7.75ZM8 5.75C8 5.75 8 8 5.75 8C8 8 8 10.25 8 10.25C8 10.25 8 8 10.25 8C8 8 8 5.75 8 5.75Z" stroke="#fa5fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
    <span class="lp-rainbow-text text-[14px] font-medium leading-6">{{ label }}</span>
  </button>
</template>
