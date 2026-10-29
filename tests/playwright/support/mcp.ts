import { expect, type APIRequestContext } from '@playwright/test';

/** One bakers tool call's MCP result. */
export interface ToolResult {
  isError: boolean;
  /** The tool's message, e.g. `Invalid input: Entry 1 (key): …`. */
  message: string;
  structuredContent?: Record<string, unknown>;
}

const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };

/**
 * Calls one bakers tool over `/mcp` as the request's signed-in session.
 *
 * Consumers: work-activity-input.steps.ts, week-sheet.steps.ts.
 */
export async function callTool(request: APIRequestContext, tool: string, args: Record<string, unknown>): Promise<ToolResult> {
  const init = await request.post('/mcp', { headers, data: { jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'playwright', version: '0' } } } });
  expect(init.status(), await init.text()).toBe(200);
  const session = { ...headers, 'Mcp-Session-Id': init.headers()['mcp-session-id'] ?? '' };
  await request.post('/mcp', { headers: session, data: { jsonrpc: '2.0', method: 'notifications/initialized' } });
  const response = await request.post('/mcp', { headers: session, data: { jsonrpc: '2.0', id: 2, method: 'tools/call',
    params: { name: `tool_api__${tool}`, arguments: args } } });
  expect(response.status(), await response.text()).toBe(200);
  const { result } = await response.json();
  expect(result, 'tools/call returned no result').toBeTruthy();
  return { isError: result.isError === true, message: result.content?.[0]?.text ?? '', structuredContent: result.structuredContent };
}
