<template>
  <section id="open-source" class="scroll-mt-4 border-b-[1.5px] border-dashed border-[color:var(--lp-rule)]">
    <div class="lp-wrap py-[88px]">
      <h2 class="lp-display m-0 max-w-[571px] text-balance text-[38px] font-extrabold leading-[0.95] tracking-[-2.4px] md:text-[60px]">
        Bake it yourself or let us run the oven. Both free.
      </h2>
      <p class="m-0 mt-5 max-w-[587px] text-[19px] leading-[1.55] text-[color:var(--lp-ink-2)]">
        The core is open source. Self-hosted and hosted are both free for now. Start on one laptop and add machines when it is no longer enough. Add-ons come in when you need them.
      </p>
      <div class="mt-14 grid gap-4 lg:grid-cols-3 lg:items-end lg:gap-0">
        <article class="lp-card rounded-[18px] bg-[color:var(--lp-sprout)] lg:min-h-[382px] lg:rounded-none lg:rounded-tl-[18px] lg:border-r-0">
          <span class="lp-tag">self-hosted · free</span>
          <h3 class="lp-display m-0 mt-[18px] text-[36px] font-extrabold leading-[0.98] tracking-[-1.26px]">Self-host</h3>
          <p class="m-0 mt-[14px] max-w-[334px] text-[16.5px] leading-[1.55]">Open source. The control plane and conductors run on your own machines.</p>
          <img src="/landing/icon-terminal.svg" alt="" width="64" height="64" class="mt-[14px]" />
          <div class="mt-auto w-[271px] max-w-full pt-[22px]"><code class="lp-code block text-[14px] leading-[19.6px]">npm i -g @bakers-build/bakers</code></div>
        </article>
        <article class="lp-card rounded-[18px] bg-[color:var(--lp-butter)] lg:min-h-[425px] lg:rounded-none lg:border-r-0">
          <span class="lp-tag">hosted · free</span>
          <h3 class="lp-display m-0 mt-[18px] max-w-[257px] text-[36px] font-extrabold leading-[0.98] tracking-[-1.26px]">We run the oven</h3>
          <p class="m-0 mt-[14px] max-w-[334px] text-[16.5px] leading-[1.55]">We host the control plane for your team. Conductors and code stay on your machines.</p>
          <img src="/landing/icon-oven-window.svg" alt="" width="64" height="64" class="mt-[14px]" />
          <div class="mt-auto pt-[22px]"><a href="/get-started/" class="lp-btn lp-btn--ink">Sign up</a></div>
        </article>
        <article class="lp-card rounded-[18px] bg-[color:var(--lp-paper)] lg:min-h-[420px] lg:rounded-none lg:rounded-tr-[18px]">
          <span class="lp-tag">Add-ons</span>
          <h3 class="lp-display m-0 mt-[18px] text-[36px] font-extrabold leading-[0.98] tracking-[-1.26px]">More tools</h3>
          <p class="m-0 mt-[14px] max-w-[334px] text-[16.5px] leading-[1.55]">Add-ons extend the line, for example time tracking with effort per billing account.</p>
          <span class="relative mt-[14px] block size-16 shrink-0" aria-hidden="true">
            <span class="absolute inset-[28.57%_2.86%_21.43%_2.86%]">
              <img src="/landing/icon-addons-group.svg" alt="" class="absolute inset-[-2.43%_-1.29%] block h-[104.86%] w-[102.58%] max-w-none" />
            </span>
          </span>
          <div class="mt-auto pt-[22px]"><a href="/addons/" class="lp-btn lp-btn--paper">See add-ons</a></div>
        </article>
      </div>
      <p class="m-0 mt-[22px] max-w-[700px] text-[15.5px] font-semibold leading-[1.55]">
        Self-hosted or hosted, the conductors and your code stay on your team's machines. Hosting means only the control plane runs on bakers.build's servers. It holds tickets, handoffs and each run's footprint; your code and run transcripts stay with you.
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
