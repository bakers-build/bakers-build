<script setup lang="ts">
// The landing page after the reviewed Figma design (file sr31HfHNWbCeNsxvXbt4wv, section
// 667:258: EN 667:698, DE 667:259, mobile 675:553 / 669:454), one component per design
// section, in English at / and German at /de/. It owns html.landing-page while mounted:
// landing.css keys the light VitePress chrome to it and docs.css keeps the documentation
// styles away from it.
import { onBeforeUnmount, onMounted } from 'vue'
import { COPY } from './copy'
import LandingNav from './LandingNav.vue'
import HeroSection from './HeroSection.vue'
import TrustStrip from './TrustStrip.vue'
import LineSection from './LineSection.vue'
import RunSection from './RunSection.vue'
import PainsSection from './PainsSection.vue'
import RecipeSection from './RecipeSection.vue'
import OvenSection from './OvenSection.vue'
import FaqSection from './FaqSection.vue'
import TryBand from './TryBand.vue'
import LandingFooter from './LandingFooter.vue'

const props = withDefaults(defineProps<{ lang?: 'en' | 'de' }>(), { lang: 'en' })
const t = COPY[props.lang]

onMounted(() => document.documentElement.classList.add('landing-page'))
onBeforeUnmount(() => document.documentElement.classList.remove('landing-page'))
</script>

<template>
  <!-- vp-raw exempts the tree from VitePress's unlayered vp-doc styles. -->
  <div class="vp-raw lp overflow-x-clip antialiased" :lang="t.lang">
    <LandingNav :t="t" />
    <main>
      <HeroSection :t="t" />
      <TrustStrip :t="t" />
      <LineSection :t="t" />
      <RunSection :t="t" />
      <PainsSection :t="t" />
      <RecipeSection :t="t" />
      <OvenSection :t="t" />
      <FaqSection :t="t" />
      <TryBand :t="t" />
    </main>
    <LandingFooter :t="t" />
  </div>
</template>
