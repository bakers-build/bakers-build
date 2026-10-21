export default async (page, ctx) => {
  if (ctx.state !== 'about-you') {
    return;
  }
  const skip = page.getByRole('button', { name: 'Skip' });
  await skip.click();
  await page.waitForLoadState('networkidle');
};
