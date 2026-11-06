export type ContextRole = 'global' | 'scope' | 'input';

export interface ContextKey<T> {
  readonly name: string;
  readonly role: ContextRole;
  /** Type-only marker keeps differently typed keys distinct to TypeScript. */
  readonly __value?: T;
}

export const defineContext = <T>(
  name: string,
  role: ContextRole,
): ContextKey<T> => ({ name, role });

export interface ProjectContextValue {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
}

export interface WorkspaceContextValue {
  readonly id: string;
  readonly name: string;
}

export const workspaceContext = defineContext<WorkspaceContextValue>(
  'workspace',
  'scope',
);

export const projectContext = defineContext<ProjectContextValue>(
  'project',
  'scope',
);
export const ticketContext = defineContext<{ readonly id: string }>(
  'ticket',
  'scope',
);
export const runContext = defineContext<{ readonly id: string }>(
  'run',
  'scope',
);

export interface UserContextValue {
  readonly id: string;
  readonly name: string;
}

export const userContext = defineContext<UserContextValue>('user', 'scope');

export class ContextBag {
  private constructor(
    private readonly values: ReadonlyMap<ContextKey<unknown>, unknown>,
  ) {}

  static empty(): ContextBag {
    return new ContextBag(new Map());
  }

  set<T>(key: ContextKey<T>, value: T): ContextBag {
    const next = new Map(this.values);
    const stored =
      typeof value === 'object' && value !== null
        ? Object.freeze({ ...value })
        : value;
    next.set(key as ContextKey<unknown>, stored);
    return new ContextBag(next);
  }

  get<T>(key: ContextKey<T>): T {
    if (!this.values.has(key as ContextKey<unknown>)) {
      throw new Error(`missing route context: ${key.name}`);
    }
    return this.values.get(key as ContextKey<unknown>) as T;
  }

  has<T>(key: ContextKey<T>): boolean {
    return this.values.has(key as ContextKey<unknown>);
  }

  scopeKey(): string {
    return [...this.values]
      .filter(([key]) => key.role === 'scope')
      .sort(([left], [right]) => left.name.localeCompare(right.name))
      .map(
        ([key, value]) =>
          `${key.name}:${String((value as { id?: unknown })?.id ?? value)}`,
      )
      .join('|');
  }
}

/** Stable route references only; loaded documents remain screen-owned input. */
export const contextsForParams = (
  params: Readonly<Record<string, string>>,
): ContextBag => {
  let contexts = ContextBag.empty();
  if (params.workspaceId)
    contexts = contexts.set(workspaceContext, {
      id: params.workspaceId,
      name: params.workspaceName ?? params.workspaceId,
    });
  if (params.projectId)
    contexts = contexts.set(projectContext, {
      id: params.projectId,
      name: params.projectName ?? params.projectSlug ?? params.projectId,
      slug: params.projectSlug ?? params.projectName ?? params.projectId,
    });
  if (params.ticketId)
    contexts = contexts.set(ticketContext, { id: params.ticketId });
  if (params.runId) contexts = contexts.set(runContext, { id: params.runId });
  if (params.userId)
    contexts = contexts.set(userContext, {
      id: params.userId,
      name: params.userName ?? params.userId,
    });
  return contexts;
};
