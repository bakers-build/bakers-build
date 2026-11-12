// Gives every pass the 1440x900 desktop frame of the Figma screens; the shell fills the viewport.
export default async (page) => {
  await page.setViewportSize({ width: 1440, height: 900 });
};
