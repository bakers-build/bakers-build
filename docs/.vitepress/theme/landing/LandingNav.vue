<script setup lang="ts">
import { ref } from 'vue'
import LogoMark from './LogoMark.vue'
import { LANGUAGES, REPO_URL, SIGN_UP_URL, type Copy } from './copy'

const props = defineProps<{ t: Copy }>()
const hrefs = ['#how-it-works', '#recipe', '#open-source', '/get-started/']
const links = props.t.nav.links.map((text, i) => ({ text, href: hrefs[i] }))
const open = ref(false)
</script>

<template>
  <header class="border-b-[1.5px] border-dashed border-[color:var(--lp-rule)]">
    <nav class="lp-wrap flex flex-wrap items-center gap-x-[34px] gap-y-4 py-5" :aria-label="t.nav.label">
      <a :href="t.home" class="mr-auto flex items-center gap-[10px] no-underline">
        <LogoMark :size="38" :radius="8" />
        <span class="lp-display text-[19px] font-bold leading-[19px] tracking-[-0.66px] md:text-[28px] md:leading-[28px] md:tracking-[-0.98px]">
          bakers<span class="text-[color:var(--lp-crust)]">.</span>build
        </span>
      </a>
      <button
        type="button"
        class="lp-mono rounded-[10px] border-[1.5px] border-[color:var(--lp-ink)] px-3 py-2 text-[13px] font-medium xl:hidden"
        :aria-expanded="open"
        aria-controls="lp-menu"
        @click="open = !open"
      >
        {{ t.nav.menu }}
      </button>
      <ul
        id="lp-menu"
        :class="open ? 'flex' : 'hidden'"
        class="order-last m-0 w-full list-none flex-col gap-4 p-0 xl:order-none xl:flex xl:w-auto xl:flex-row xl:items-center xl:gap-[34px]"
      >
        <li v-for="link in links" :key="link.href">
          <a :href="link.href" class="lp-mono text-[14px] font-medium no-underline hover:underline" @click="open = false">
            {{ link.text }}
          </a>
        </li>
        <li>
          <a :href="REPO_URL" class="lp-mono text-[14px] font-medium no-underline hover:underline">GitHub ★</a>
        </li>
        <li class="lp-mono flex items-center gap-[6px] text-[13px]">
          <template v-for="(l, i) in LANGUAGES" :key="l.code">
            <span v-if="i" class="text-[color:var(--lp-ink-3)]" aria-hidden="true">/</span>
            <span v-if="l.code === t.lang" class="font-semibold underline" aria-current="page">{{ l.label }}</span>
            <a
              v-else
              :href="l.href"
              :hreflang="l.code"
              :lang="l.code"
              :aria-label="l.name"
              class="text-[color:var(--lp-ink-3)] no-underline hover:underline"
            >{{ l.label }}</a>
          </template>
        </li>
      </ul>
      <a
        :href="SIGN_UP_URL"
        class="inline-flex rounded-[10px] border-[1.5px] border-[color:var(--lp-ink)] bg-[color:var(--lp-butter)] px-[13px] py-[9px] text-[13px] font-semibold leading-[13px] no-underline"
      >
        {{ t.signUp }}
      </a>
    </nav>
  </header>
</template>
