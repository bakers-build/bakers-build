import type { RendererServices } from '../types.js';

/** The connection's site tool caller, or an error naming what is missing. */
export const siteTools = (services: RendererServices | undefined) => {
  const client = services?.writeClient ?? services?.client;
  if (!client?.callTool) throw new Error('No connection to the site tools.');
  return client.callTool.bind(client);
};
