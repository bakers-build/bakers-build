<script setup lang="ts">
// The landing page (wayfinder ticket 08) — composes the sections 1:1 per
// the approved prototype's component map. Owns the page-level concerns:
// the html.landing-page class (dark VP chrome + .sr gating, removed on
// route leave) and the scroll-reveal IntersectionObserver over all .sr
// elements (staggered entrances; skipped for reduced motion and
// ?reveal=all screenshot runs).
import { onBeforeUnmount, onMounted, ref } from 'vue'
import SectionHead from './primitives/SectionHead.vue'
import ChatShowcase from './sections/ChatShowcase.vue'
import ConceptsGrid from './sections/ConceptsGrid.vue'
import CosmosPipeline from './sections/CosmosPipeline.vue'
import CtaSection from './sections/CtaSection.vue'
import FaqSection from './sections/FaqSection.vue'
import FeatureStrip from './sections/FeatureStrip.vue'
import ThreeWays from './sections/ThreeWays.vue'
import HeroSection from './sections/HeroSection.vue'

const root = ref<HTMLElement>()
let io: IntersectionObserver | undefined

onMounted(() => {
  document.documentElement.classList.add('landing-page')
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
  const revealAll = new URLSearchParams(location.search).get('reveal') === 'all'
  const targets = root.value?.querySelectorAll('.sr') ?? []
  if (revealAll || reduceMotion) {
    targets.forEach((el) => el.classList.add('in'))
  } else {
    io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('in')
            io?.unobserve(e.target)
          }
        })
      },
      { threshold: 0.18 },
    )
    targets.forEach((el) => io!.observe(el))
  }
})

onBeforeUnmount(() => {
  document.documentElement.classList.remove('landing-page')
  io?.disconnect()
})
</script>

<template>
  <!-- vp-raw exempts the tree from VP's unlayered vp-doc styles, which
       would otherwise beat the layered Tailwind utilities (ticket 09) -->
  <div
    ref="root"
    class="vp-raw overflow-x-clip bg-[color:var(--lp-bg)] font-sans leading-[1.55] text-[color:var(--lp-text-1)] antialiased"
  >
    <HeroSection />
    <CosmosPipeline />
    <FeatureStrip />
    <ThreeWays />

    <!-- OWNERSHIP interlude -->
    <div class="relative z-[2] px-6 pt-[140px]">
      <SectionHead kicker="OWNERSHIP">
        <template #title>Every state has an owner</template>
        <template #lead>
          A ticket moves through explicit states. Agents qualify, spec, code
          and review; you approve the plan, confirm the result and authorize
          the merge. Ownership is your call, per state, in WORKFLOW.md.
        </template>
      </SectionHead>
    </div>

    <ChatShowcase />
    <ConceptsGrid />
    <FaqSection />
    <CtaSection />

    <footer class="relative z-[2] border-t border-white/[.07] px-6 py-9 text-center text-[14.5px] text-[color:var(--lp-text-3)]">
      Released under the MIT License.
    </footer>
  </div>
</template>
