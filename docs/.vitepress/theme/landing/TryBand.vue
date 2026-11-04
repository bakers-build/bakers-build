<script setup lang="ts">
// The closing butter band: sign-up and the install command side by side as one group
// (Figma "Abschluss · Testen", "CTA-Gruppe"), stacked on phones.
import InstallCommand from './InstallCommand.vue'
import { SIGN_UP_URL, type Copy } from './copy'

defineProps<{ t: Copy }>()
</script>

<template>
  <section class="border-y-[2.5px] border-[color:var(--lp-ink)] bg-[color:var(--lp-butter)]">
    <div class="lp-wrap py-[34px]">
      <h2 class="lp-display m-0 text-[34px] font-extrabold leading-[0.98] tracking-[-1.76px] md:text-[44px]">{{ t.closing.title }}</h2>
      <p class="m-0 mt-[10px] max-w-[445px] text-[17px] leading-[25.5px] text-[color:var(--lp-ink-2)]">{{ t.closing.text }}</p>
      <div data-cta-group class="mt-[18px] flex flex-col items-start gap-4 sm:flex-row sm:items-end sm:gap-5">
        <a :href="SIGN_UP_URL" class="lp-btn lp-btn--ink">{{ t.signUp }}</a>
        <InstallCommand :t="t.copy" :label="t.closing.install" tall />
      </div>
    </div>
  </section>
</template>
