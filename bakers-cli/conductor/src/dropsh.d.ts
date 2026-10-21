declare module 'dropsh/plugin' {
  export interface HttpRequest {
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    url: string;
    headers?: Record<string, string>;
    body?: string | Uint8Array;
  }

  export interface HttpResponse {
    status: number;
    headers: Record<string, string>;
    body: string;
  }

  export interface HttpClient {
    send(req: HttpRequest): Promise<HttpResponse>;
  }

  export interface JsonApiResourceObject {
    id: string;
    type: string;
    attributes?: Record<string, unknown>;
    relationships?: Record<
      string,
      {
        data:
          | { id: string; type: string }
          | Array<{ id: string; type: string }>
          | null;
      }
    >;
  }

  export interface Resource {
    readonly id: string;
    readonly type: string;
    attr<T = unknown>(key: string): T | undefined;
    rel(key: string): string | null;
    rels(key: string): string[];
    readonly raw: JsonApiResourceObject;
  }

  export type FilterOp =
    | '='
    | '<>'
    | '>'
    | '>='
    | '<'
    | '<='
    | 'STARTS_WITH'
    | 'CONTAINS';

  export interface Collection {
    where(path: string, op: FilterOp, value: string | number): Collection;
    whereIn(path: string, values: Array<string | number>): Collection;
    notExists(path: string): Collection;
    fields(names: string[]): Collection;
    sort(path: string, dir?: 'ASC' | 'DESC'): Collection;
    page(limit: number): Collection;
    list(): Promise<Resource[]>;
    first(): Promise<Resource | null>;
    count(): Promise<number>;
  }

  export interface ResourceWriteBody {
    attributes?: Record<string, unknown>;
    relationships?: Record<string, unknown>;
  }

  export interface JsonApiClient {
    get(path: string, params?: unknown): Promise<unknown>;
    post(path: string, body: unknown): Promise<unknown>;
    patch(path: string, body: unknown): Promise<unknown>;
    delete(path: string): Promise<unknown>;
    upload(
      path: string,
      filename: string,
      data: Uint8Array | Buffer,
    ): Promise<unknown>;
    collection(type: string): Collection;
    resource(type: string, id: string): Promise<Resource>;
    create(type: string, body: ResourceWriteBody): Promise<Resource>;
    update(
      type: string,
      id: string,
      body: ResourceWriteBody,
    ): Promise<Resource>;
    upsert(
      type: string,
      match: { path: string; value: string },
      body: ResourceWriteBody,
    ): Promise<Resource>;
    me(): Promise<string>;
  }

  export interface JsonApiOptions {
    baseUrl: string;
    prefix: string;
    http: HttpClient;
    auth: { apply(req: HttpRequest): Promise<HttpRequest> };
  }

  export interface PluginContext {
    http: HttpClient;
    auth: { apply(req: HttpRequest): Promise<HttpRequest> };
    baseUrl: string;
  }

  export type SchemaOperation = unknown;

  export interface DropSHPlugin {
    readonly id: string;
    readonly requiredModules: string[];
    authProvider?: unknown;
    extendSchema?(
      entityType: string,
      bundle: string,
      baseSchema: unknown,
      ctx: PluginContext,
    ): Promise<unknown>;
    extendOperationSchema?(
      entityType: string,
      bundle: string,
      operation: SchemaOperation,
      operationSchema: unknown,
      ctx: PluginContext,
    ): Promise<unknown>;
    registerCommands?(program: unknown): void;
  }

  export class HttpError extends Error {
    readonly status: number;
    readonly body: unknown;
    constructor(status: number, message: string, body?: unknown);
  }

  export function createHttpClient(): HttpClient;
  export function createJsonApiClient(opts: JsonApiOptions): JsonApiClient;
  export function loadConfig(filePath: string): Promise<{
    site: { base_url: string; jsonapi_prefix: string };
    defaults: { timeout_ms: number };
    plugins?: DropSHPlugin[];
  }>;
}

declare module 'dropsh' {
  import type { Command } from 'commander';
  import type { DropSHPlugin, HttpClient } from 'dropsh/plugin';

  export interface ResolveAuthOptions {
    baseUrl: string;
    plugins: DropSHPlugin[];
    http: HttpClient;
    now: () => number;
    stateDir?: string;
  }

  export interface AuthAdapter {
    apply(
      req: import('dropsh/plugin').HttpRequest,
    ): Promise<import('dropsh/plugin').HttpRequest>;
  }

  export function resolveAuth(
    options: ResolveAuthOptions,
  ): Promise<AuthAdapter>;

  export interface AuthStatusInfo {
    loggedIn: boolean;
    provider?: string;
    host?: string;
    expiresAt?: number;
    state?: 'valid' | 'expired';
    sessionless?: boolean;
  }

  export interface AuthStatusDeps {
    baseUrl: string;
    plugins: DropSHPlugin[];
    stateDir?: string;
  }

  export function authStatus(deps: AuthStatusDeps): Promise<AuthStatusInfo>;

  export function buildProgram(options?: { plugins?: DropSHPlugin[] }): Command;
}
