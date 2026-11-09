<script setup lang="ts">
import { ADDONS_URL, SIGN_UP_URL, type Copy } from './copy'

defineProps<{ t: Copy }>()
</script>

<template>
  <section id="open-source" class="scroll-mt-4 border-b-[1.5px] border-dashed border-[color:var(--lp-rule)]">
    <div class="lp-wrap py-12 md:py-[88px]">
      <h2 class="lp-display m-0 max-w-[571px] text-[38px] font-extrabold leading-[0.95] tracking-[-2.4px] md:text-[60px]">
        {{ t.oven.title }}
      </h2>
      <p class="m-0 mt-5 max-w-[587px] text-[19px] leading-[1.55] text-[color:var(--lp-ink-2)]">
        {{ t.oven.text }}
      </p>
      <div class="mt-14 grid gap-4 lg:min-h-[425px] lg:grid-cols-3 lg:gap-0">
        <article class="lp-card rounded-[18px] bg-[color:var(--lp-sprout)] lg:rounded-none lg:rounded-tl-[18px] lg:border-r-0">
          <span class="lp-tag">{{ t.oven.self[0] }}</span>
          <h3 class="lp-display m-0 mt-[18px] text-[36px] font-extrabold leading-[0.98] tracking-[-1.26px]">{{ t.oven.self[1] }}</h3>
          <p class="m-0 mt-[14px] max-w-[334px] text-[16.5px] leading-[1.55]">{{ t.oven.self[2] }}</p>
          <img src="/landing/icon-terminal.svg" alt="" width="64" height="64" class="mt-[14px]" />
        </article>
        <article class="lp-card rounded-[18px] bg-[color:var(--lp-butter)] lg:rounded-none lg:border-r-0">
          <span class="lp-tag">{{ t.oven.hosted[0] }}</span>
          <h3 class="lp-display m-0 mt-[18px] text-[36px] font-extrabold leading-[0.98] tracking-[-1.26px]">{{ t.oven.hosted[1] }}</h3>
          <p class="m-0 mt-[14px] max-w-[334px] text-[16.5px] leading-[1.55]">{{ t.oven.hosted[2] }}</p>
          <img src="/landing/icon-oven-window.svg" alt="" width="64" height="64" class="mt-[14px]" />
          <div class="mt-auto pt-[22px]"><a :href="SIGN_UP_URL" class="lp-btn lp-btn--ink">{{ t.signUp }}</a></div>
        </article>
        <article class="lp-card rounded-[18px] bg-[color:var(--lp-paper)] lg:rounded-none lg:rounded-tr-[18px]">
          <span class="lp-tag">{{ t.oven.addons[0] }}</span>
          <h3 class="lp-display m-0 mt-[18px] text-[36px] font-extrabold leading-[0.98] tracking-[-1.26px]">{{ t.oven.addons[1] }}</h3>
          <p class="m-0 mt-[14px] max-w-[334px] text-[16.5px] leading-[1.55]">{{ t.oven.addons[2] }}</p>
          <span class="relative mt-[14px] block size-16 shrink-0" aria-hidden="true">
            <span class="absolute inset-[28.57%_2.86%_21.43%_2.86%]">
              <img src="/landing/icon-addons-group.svg" alt="" class="absolute inset-[-2.43%_-1.29%] block h-[104.86%] w-[102.58%] max-w-none" />
            </span>
          </span>
          <div class="mt-auto pt-[22px]"><a :href="ADDONS_URL" class="lp-btn lp-btn--paper">{{ t.oven.addons[3] }}</a></div>
        </article>
      </div>
      <p class="m-0 mt-[22px] max-w-[700px] text-[15.5px] font-semibold leading-[1.55]">
        {{ t.oven.note }}
      </p>
    </div>
  </section>
</template>

<style scoped>
/* In the components layer so the lg: border and radius utilities win. */
@layer components {
  .lp-card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0;
    border: 2.5px solid var(--lp-ink);
    padding: 40px 28px 28px;
  }
  .lp-tag {
    border: 1.5px solid var(--lp-ink);
    border-radius: 999px;
    background: var(--lp-paper);
    padding: 4px 10px;
    font-family: var(--lp-mono);
    font-size: 12.5px;
    font-weight: 600;
  }
}
</style>
