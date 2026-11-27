<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRoute } from 'vitepress'
import { consentOpen, initConsent, setConsent } from './consent'

// Only the landing page has a German version; every other page is English.
const route = useRoute()
const de = computed(() => /^\/de(\/|$)/.test(route.path))
const t = computed(() =>
  de.value
    ? { label: 'Cookie-Einwilligung', text: 'Dürfen wir mit Google Analytics messen, wie diese Seite genutzt wird? Ohne deine Zustimmung wird nichts geladen.', accept: 'Akzeptieren', decline: 'Ablehnen' }
    : { label: 'Cookie consent', text: 'May we use Google Analytics to measure how this site is used? Nothing loads without your consent.', accept: 'Accept', decline: 'Decline' },
)

onMounted(initConsent)
</script>

<template>
  <div v-if="consentOpen" class="bb-consent" role="region" :aria-label="t.label" :lang="de ? 'de' : 'en'">
    <p class="bb-consent__text">{{ t.text }}</p>
    <div class="bb-consent__actions">
      <button type="button" class="bb-consent__btn" @click="setConsent(false)">{{ t.decline }}</button>
      <button type="button" class="bb-consent__btn" @click="setConsent(true)">{{ t.accept }}</button>
    </div>
  </div>
</template>

<style scoped>
.bb-consent {
  position: fixed;
  z-index: 100;
  right: 16px;
  bottom: 16px;
  left: 16px;
  max-width: 560px;
  margin-left: auto;
  padding: 16px 18px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-1);
  box-shadow: 0 18px 40px -18px rgba(43, 33, 22, 0.35);
  font-size: 14px;
  line-height: 1.5;
}
.bb-consent__text {
  margin: 0;
}
.bb-consent__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}
/* Equal weight on both choices: declining is as easy as accepting. */
.bb-consent__btn {
  padding: 6px 16px;
  border: 1px solid var(--vp-c-text-1);
  border-radius: 999px;
  font-weight: 600;
}
.bb-consent__btn:hover {
  background: var(--vp-c-bg-soft);
}
.bb-consent__btn:focus-visible {
  outline: 2px solid var(--vp-c-text-1);
  outline-offset: 2px;
}
</style>
