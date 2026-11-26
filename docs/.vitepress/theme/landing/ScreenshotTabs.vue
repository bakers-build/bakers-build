<script setup lang="ts">
import { ref } from 'vue'

// A tabbed screenshot gallery: one large image and its caption visible at a time.
const props = defineProps<{
  id: string
  labelledby: string
  items: readonly { image: string; title: string; text: string; alt: string }[]
}>()
const active = ref(0)
// Intrinsic pixel sizes so each image reserves its own aspect ratio; unlisted captures are 1440x900.
const sizes: Record<string, [number, number]> = { insights: [1920, 899], 'project-overview': [1920, 904], herdr: [1920, 1204], orca: [1920, 1148] }

function navigate(event: KeyboardEvent, index: number) {
  const count = props.items.length
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
  <div>
    <div role="tablist" :aria-labelledby="labelledby" class="flex gap-2 overflow-x-auto pb-4">
      <button
        v-for="(s, i) in items"
        :id="`${id}-tab-${s.image}`"
        :key="s.image"
        type="button"
        role="tab"
        :aria-selected="active === i"
        :aria-controls="`${id}-panel-${s.image}`"
        :tabindex="active === i ? 0 : -1"
        class="shrink-0 rounded-full border px-5 py-3 text-[15px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--lp-ink)]"
        :class="active === i ? 'border-[color:var(--lp-ink)] bg-[color:var(--lp-ink)] text-[color:var(--lp-paper)]' : 'border-[color:var(--lp-rule)] text-[color:var(--lp-ink-2)] hover:bg-[color:var(--lp-butter)]'"
        @click="active = i"
        @keydown="navigate($event, i)"
      >{{ s.title }}</button>
    </div>
    <div
      v-for="(s, i) in items"
      v-show="active === i"
      :id="`${id}-panel-${s.image}`"
      :key="s.image"
      role="tabpanel"
      :aria-labelledby="`${id}-tab-${s.image}`"
      tabindex="0"
      class="rounded-[16px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[color:var(--lp-ink)]"
    >
      <figure class="m-0 min-w-0">
        <img
          :src="`/landing/${s.image}.webp`"
          :alt="s.alt"
          :width="sizes[s.image]?.[0] ?? 1440"
          :height="sizes[s.image]?.[1] ?? 900"
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
</template>
