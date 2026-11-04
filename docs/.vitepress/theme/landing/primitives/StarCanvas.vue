<script setup lang="ts">
// wope's in-panel stars, replicated from their ACTUAL tsParticles config
// (build/q-7ecb190c.js; prototype iterations 12-13): near-stationary random
// wander (no drift), full 0->1->0 triangle-wave blink per star (unsynced,
// slowed to .12-.28 cycles/s), <=1px crisp white dots at retina dpr,
// ticked at 20fps, paused off-viewport and in hidden tabs; a single static
// frame under prefers-reduced-motion.
import { onBeforeUnmount, onMounted, ref } from 'vue'

const props = withDefaults(defineProps<{ count?: number }>(), { count: 100 })

const canvas = ref<HTMLCanvasElement>()
let raf = 0
let io: IntersectionObserver | undefined
let cleanup: (() => void) | undefined

onMounted(() => {
  const c = canvas.value
  const host = c?.parentElement
  if (!c || !host) return
  const ctx = c.getContext('2d')!
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
  const sdpr = Math.min(window.devicePixelRatio || 1, 2) /* detectRetina */

  type Star = { x: number; y: number; r: number; dir: number; os: number; ph: number }
  let stars: Star[] | null = null
  let w = 1
  let h = 1
  let vis = false

  function size() {
    const r = host!.getBoundingClientRect()
    w = Math.max(1, r.width)
    h = Math.max(1, r.height)
    c!.width = w * sdpr
    c!.height = h * sdpr
    ctx.setTransform(sdpr, 0, 0, sdpr, 0, 0)
    if (!stars)
      stars = Array.from({ length: props.count }, () => ({
        x: Math.random(),
        y: Math.random(),
        r: 0.2 + Math.random() * 0.8 /* size {value:1, random:true} */,
        dir: Math.random() * Math.PI * 2 /* move: random wander */,
        os: 0.12 + Math.random() * 0.16 /* slow full blink, unsynced */,
        ph: Math.random(),
      }))
  }

  const DT = 0.05 /* fpsLimit 20 -> one tick per 50ms */
  function draw() {
    ctx.clearRect(0, 0, w, h)
    ctx.fillStyle = '#fff'
    for (const s of stars!) {
      if (!reduceMotion) {
        s.dir += (Math.random() - 0.5) * 0.4
        s.x = (s.x + (Math.cos(s.dir) * 0.16) / w + 1) % 1 /* gentle, slowed wander */
        s.y = (s.y + (Math.sin(s.dir) * 0.16) / h + 1) % 1
        s.ph = (s.ph + s.os * DT) % 1
      }
      /* triangle wave: fade fully out and back in, like tsParticles */
      ctx.globalAlpha = s.ph < 0.5 ? s.ph * 2 : 2 - s.ph * 2
      ctx.beginPath()
      ctx.arc(s.x * w, s.y * h, s.r, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }

  size()
  const onResize = () => size()
  addEventListener('resize', onResize)
  io = new IntersectionObserver((es) => es.forEach((e) => (vis = e.isIntersecting)), {
    rootMargin: '60px',
  })
  io.observe(host)

  let last = 0
  function loop(t: number) {
    if (!document.hidden && t - last >= 50) {
      last = t
      if (vis) draw()
    }
    raf = requestAnimationFrame(loop)
  }
  if (reduceMotion) draw()
  else raf = requestAnimationFrame(loop)

  cleanup = () => removeEventListener('resize', onResize)
})

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  io?.disconnect()
  cleanup?.()
})
</script>

<template>
  <canvas ref="canvas" aria-hidden="true" class="pointer-events-none absolute inset-0 z-0 h-full w-full" />
</template>
