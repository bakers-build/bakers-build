<script setup lang="ts">
// .gb — the running gradient border, one component, used on every framed
// surface (pipeline frame, chat showcase, concept cards). The conic sweep
// needs @property (below); this component owns the perf gate: the
// animation runs only while the HOST (parent element) is in the viewport,
// mirroring the prototype's IntersectionObserver.
import { onBeforeUnmount, onMounted, ref } from 'vue'

withDefaults(defineProps<{ variant?: 'default' | 'soft' | 'strong' }>(), {
  variant: 'default',
})

const el = ref<HTMLElement>()
let io: IntersectionObserver | undefined

onMounted(() => {
  const host = el.value?.parentElement
  if (!host) return
  io = new IntersectionObserver(
    (es) => es.forEach((e) => el.value?.classList.toggle('anim-on', e.isIntersecting)),
    { rootMargin: '80px' },
  )
  io.observe(host)
})
onBeforeUnmount(() => io?.disconnect())
</script>

<style>
/* Unscoped on purpose: @property is a global at-rule, and the class is
 * namespaced (lp-gb). Conic sweep values 1:1 from the prototype. */
@property --gb-a {
  syntax: '<angle>';
  initial-value: 0deg;
  inherits: false;
}
.lp-gb {
  position: absolute;
  inset: -1px;
  border-radius: inherit;
  padding: 1.5px;
  pointer-events: none;
  background: conic-gradient(
    from var(--gb-a),
    transparent 0%,
    rgba(229, 156, 255, 0.85) 10%,
    rgba(143, 104, 255, 0.9) 18%,
    transparent 30%,
    transparent 55%,
    rgba(156, 178, 255, 0.45) 72%,
    transparent 85%
  );
  /* keep only the 1px border ring of the gradient */
  -webkit-mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  mask-composite: exclude;
  opacity: 0.8;
}
.lp-gb--soft {
  opacity: 0.45;
}
.lp-gb--strong {
  opacity: 1;
}
@media (prefers-reduced-motion: no-preference) {
  /* paused by default; the observer flips .anim-on while the host is
   * in the viewport (perf, prototype behavior) */
  .lp-gb {
    animation: lp-gb-spin 8s linear infinite;
    animation-play-state: paused;
  }
  .lp-gb--soft {
    animation-duration: 12s;
  }
  .lp-gb.anim-on {
    animation-play-state: running;
  }
  @keyframes lp-gb-spin {
    to {
      --gb-a: 360deg;
    }
  }
}
</style>

<template>
  <span
    ref="el"
    class="lp-gb"
    :class="{ 'lp-gb--soft': variant === 'soft', 'lp-gb--strong': variant === 'strong' }"
    aria-hidden="true"
  />
</template>
