<script setup lang="ts">
import { ref } from 'vue'
import LogoMark from './LogoMark.vue'

const links = [
  { text: 'How it works', href: '#how-it-works' },
  { text: 'Your recipe', href: '#recipe' },
  { text: 'Open source', href: '#open-source' },
  { text: 'Docs', href: '/get-started/' },
]
const open = ref(false)
</script>

<template>
  <header class="border-b-[1.5px] border-dashed border-[color:var(--lp-rule)]">
    <nav class="lp-wrap flex flex-wrap items-center gap-x-[34px] gap-y-4 py-5" aria-label="Main">
      <a href="/" class="mr-auto flex items-center gap-[10px] no-underline">
        <LogoMark :size="38" :radius="8" />
        <span class="lp-display text-[28px] font-bold leading-[28px] tracking-[-0.98px]">
          bakers<span class="text-[color:var(--lp-crust)]">.</span>build
        </span>
      </a>
      <button
        type="button"
        class="lp-mono rounded-[10px] border-[1.5px] border-[color:var(--lp-ink)] px-3 py-2 text-[13px] font-medium md:hidden"
        :aria-expanded="open"
        aria-controls="lp-menu"
        @click="open = !open"
      >
        Menu
      </button>
      <ul
        id="lp-menu"
        :class="open ? 'flex' : 'hidden'"
        class="m-0 w-full list-none flex-col gap-4 p-0 md:flex md:w-auto md:flex-row md:items-center md:gap-[34px]"
      >
        <li v-for="link in links" :key="link.href">
          <a :href="link.href" class="lp-mono text-[14px] font-medium no-underline hover:underline" @click="open = false">
            {{ link.text }}
          </a>
        </li>
        <li>
          <a
            href="/get-started/"
            class="inline-flex rounded-[10px] border-[1.5px] border-[color:var(--lp-ink)] bg-[color:var(--lp-butter)] px-[13px] py-[9px] text-[13px] font-semibold leading-[13px] no-underline"
          >
            Sign up
          </a>
        </li>
      </ul>
    </nav>
  </header>
</template>
