<script setup lang="ts">
// The butter band with a sign-up and the install command (used twice).
defineProps<{ title: string; text: string }>()
</script>

<template>
  <section class="border-y-[2.5px] border-[color:var(--lp-ink)] bg-[color:var(--lp-butter)]">
    <div class="lp-wrap grid gap-9 py-[34px] lg:grid-cols-[minmax(0,1fr)_300px]">
      <div class="flex flex-col items-start self-end">
        <h2 class="lp-display m-0 text-[34px] font-extrabold leading-[0.98] tracking-[-1.76px] md:text-[44px]">{{ title }}</h2>
        <p class="m-0 mt-[10px] max-w-[445px] text-[17px] leading-[25.5px] text-[color:var(--lp-ink-2)]">{{ text }}</p>
        <a href="/get-started/" class="lp-btn lp-btn--ink mt-[18px]">Sign up</a>
      </div>
      <div class="self-end border-l-[1.5px] border-dashed border-[color:var(--lp-ink)] pl-7 pt-[10px]">
        <p class="lp-mono m-0 text-[13px] font-medium leading-[18.2px] text-[color:var(--lp-ink-2)]">or run it yourself, free</p>
        <code class="lp-code mt-[6px] block text-[14px] leading-[19.6px] text-[color:var(--lp-ink-2)]">npm i -g @bakers-build/bakers</code>
      </div>
    </div>
  </section>
</template>
