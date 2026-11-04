<script setup lang="ts">
// wope.com's magical-borders, values 1:1 from their CSS (prototype
// iterations 10/19): .sheen = interior lighten (radial 600px at the mouse,
// rgba(255,255,255,.05) -> 40%), .mbord = border highlight (same geometry
// at rgba(255,255,255,.3)) masked to the 1px border ring so the border
// lights up ONLY where the circle touches it. Both fade over .5s on hover
// (host must carry the Tailwind `group` class). Pointer tracking writes
// --mx/--my on the host.
import { onBeforeUnmount, onMounted, ref } from 'vue'

const el = ref<HTMLElement>()
let host: HTMLElement | null = null

function onMove(e: PointerEvent) {
  if (!host) return
  const r = host.getBoundingClientRect()
  host.style.setProperty('--mx', `${e.clientX - r.left}px`)
  host.style.setProperty('--my', `${e.clientY - r.top}px`)
}

onMounted(() => {
  host = el.value?.parentElement ?? null
  host?.addEventListener('pointermove', onMove)
})
onBeforeUnmount(() => host?.removeEventListener('pointermove', onMove))
</script>

<style>
/* the 1px ring mask: keep only the border band of the radial highlight
 * (content-box XOR full box — the padding IS the ring width). Without
 * this the highlight floods the whole panel instead of tracing the
 * border. Unscoped, lp- namespaced. */
.lp-mbord {
  -webkit-mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  mask-composite: exclude;
}
</style>

<template>
  <span ref="el" aria-hidden="true" class="pointer-events-none absolute inset-0 z-[2] rounded-[inherit] bg-[radial-gradient(600px_circle_at_var(--mx,50%)_var(--my,50%),rgba(255,255,255,.05),transparent_40%)] opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
  <span aria-hidden="true" class="lp-mbord pointer-events-none absolute -inset-px z-[3] rounded-[inherit] bg-[radial-gradient(600px_circle_at_var(--mx,50%)_var(--my,50%),rgba(255,255,255,.3),transparent_40%)] p-[1.5px] opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
</template>
