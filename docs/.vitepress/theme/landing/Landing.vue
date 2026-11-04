<script setup lang="ts">
// The landing page after the Figma design (file sr31HfHNWbCeNsxvXbt4wv, EN frame
// 606:39), one component per design section. It owns html.landing-page while
// mounted: landing.css keys the light VitePress chrome to it and docs.css keeps
// the documentation styles away from it.
import { onBeforeUnmount, onMounted } from 'vue'
import LandingNav from './LandingNav.vue'
import HeroSection from './HeroSection.vue'
import TryBand from './TryBand.vue'
import TrustStrip from './TrustStrip.vue'
import LineSection from './LineSection.vue'
import PainsSection from './PainsSection.vue'
import RecipeSection from './RecipeSection.vue'
import OvenSection from './OvenSection.vue'
import RunSection from './RunSection.vue'
import FaqSection from './FaqSection.vue'
import LandingFooter from './LandingFooter.vue'

onMounted(() => document.documentElement.classList.add('landing-page'))
onBeforeUnmount(() => document.documentElement.classList.remove('landing-page'))
</script>

<template>
  <!-- vp-raw exempts the tree from VitePress's unlayered vp-doc styles. -->
  <div class="vp-raw lp overflow-x-clip antialiased">
    <LandingNav />
    <main>
      <HeroSection />
      <div class="pt-9">
        <TryBand title="Try it with your team." text="Sign up, create your workspace and invite your team." />
      </div>
      <TrustStrip />
      <LineSection />
      <PainsSection />
      <RecipeSection />
      <OvenSection />
      <RunSection />
      <FaqSection />
      <TryBand title="Try it on a real ticket." text="Sign up, create your workspace and invite your team." />
    </main>
    <LandingFooter />
  </div>
</template>
