// Pins the colour mode per captured state, so neither capture depends on the system scheme,
// and gives every pass the 1440x900 desktop frame of the Figma boards (the shell fills the viewport).
export default async (page, ctx) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const mode = ctx.state === 'ci-dark' ? 'dark' : 'light';
  await page.evaluate((choice) => window.bakersSetMode(choice), mode);
  await page.waitForFunction((choice) => document.documentElement.dataset.mode === choice, mode);
};
