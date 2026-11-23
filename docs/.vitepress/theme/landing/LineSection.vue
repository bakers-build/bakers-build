<script setup lang="ts">
import { ref } from 'vue'
import type { Copy } from './copy'

const props = defineProps<{ t: Copy }>()
const active = ref(0)

function navigate(event: KeyboardEvent, index: number) {
  const count = props.t.line.screenshots.length
  let next: number
  switch (event.key) {
    case 'ArrowRight': next = (index + 1) % count; break
    case 'ArrowLeft': next = (index + count - 1) % count; break
    case 'Home': next = 0; break
    case 'End': next = count - 1; break
    default: return
  }
  event.preventDefault()
  active.value = next
  const tabs = (event.currentTarget as HTMLElement).parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
  tabs?.[next]?.focus()
}
</script>

<template>
  <section id="how-it-works" class="lp-wrap scroll-mt-4 py-12 md:py-[88px]">
    <p class="lp-mono m-0 text-[13px] font-medium text-[color:var(--lp-ink-3)]">{{ t.line.eyebrow }}</p>
    <h2 id="gallery-title" class="lp-display m-0 mt-5 max-w-[760px] text-[38px] font-extrabold leading-[0.95] tracking-[-1.8px] md:text-[60px]">
      {{ t.line.title }}
    </h2>
    <p class="m-0 mt-5 max-w-[640px] text-[19px] leading-[1.5] text-[color:var(--lp-ink-2)]">
      {{ t.line.text }}
    </p>
    <div class="mt-10">
      <div role="tablist" aria-labelledby="gallery-title" class="flex gap-2 overflow-x-auto pb-4">
        <button
          v-for="(s, i) in t.line.screenshots"
          :id="`gallery-tab-${s.image}`"
          :key="s.image"
          type="button"
          role="tab"
          :aria-selected="active === i"
          :aria-controls="`gallery-panel-${s.image}`"
          :tabindex="active === i ? 0 : -1"
          class="shrink-0 rounded-full border px-5 py-3 text-[15px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--lp-ink)]"
          :class="active === i ? 'border-[color:var(--lp-ink)] bg-[color:var(--lp-ink)] text-[color:var(--lp-paper)]' : 'border-[color:var(--lp-rule)] text-[color:var(--lp-ink-2)] hover:bg-[color:var(--lp-butter)]'"
          @click="active = i"
          @keydown="navigate($event, i)"
        >{{ s.title }}</button>
      </div>
      <div
        v-for="(s, i) in t.line.screenshots"
        v-show="active === i"
        :id="`gallery-panel-${s.image}`"
        :key="s.image"
        role="tabpanel"
        :aria-labelledby="`gallery-tab-${s.image}`"
        tabindex="0"
        class="rounded-[16px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[color:var(--lp-ink)]"
      >
        <figure class="m-0 min-w-0">
          <img
            :src="`/landing/${s.image}.png`"
            :alt="s.alt"
            width="1440"
            height="900"
            loading="lazy"
            class="block h-auto w-full rounded-[12px] border border-[color:var(--lp-rule)] shadow-[0_18px_40px_-18px_rgba(43,33,22,0.3)]"
          />
          <figcaption class="mt-4">
            <h3 class="lp-title m-0 text-[22px] leading-[1.1]">{{ s.title }}</h3>
            <p class="m-0 mt-2 text-[16px] leading-[1.5] text-[color:var(--lp-ink-2)]">{{ s.text }}</p>
          </figcaption>
        </figure>
      </div>
    </div>
  </section>
</template>
