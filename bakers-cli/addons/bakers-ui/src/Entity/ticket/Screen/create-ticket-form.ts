import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { VNode } from '@opentui/core';
import { buildCreateLaunch, shortName } from '../../../Agent/launch.js';
import {
  actionItem,
  formatActionLadder,
} from '../../../Component/footer-actions/index.js';
import { serverMessage } from '../../../lib/jsonapi-error.js';
import { columnNode } from '../../../lib/vnode.js';
import type { RouteMetadata } from '../../../Routing/route.js';
import { AsyncModalScreen } from '../../../Screen/async-modal-screen.js';
import type { ModalChrome } from '../../../Screen/modal-screen.js';
import type { ScreenAction, ScreenContext } from '../../../Screen/screen.js';
import {
  createOptionLoader,
  type OptionLoader,
  type OptionSources,
} from '../../../Widget/option-source.js';
import { OwnerIdentity } from '../../conductor/Data/own-rows.js';
import { runTemplate } from '../../ticket-template/Data/templates.js';
import { resolveWhoCandidate } from '../../user/Data/users.js';
import {
  CREATE_FORM_REGION,
  createFormTree,
} from '../Component/create-form/index.js';
import { buildTicketCreateBody, createTicket } from '../Data/write.js';
import {
  AGENT_ACTION_ID,
  CREATE_FORM,
  CREATE_FORM_WITH_PROJECT,
  type CreateFormOptions,
  type CreateFormPayload,
  type CreateFormState,
  type CreateRemembered,
  DIRECT_ACTION_ID,
  FIELDS,
  FIELDS_WITH_PROJECT,
  optionFor,
  rememberedValues,
} from '../Form/create.js';
import {
  type CreateFormHints,
  composeCreateFormOptions,
  conductorOptionSource,
  createFormSources,
  templateOptionSource,
} from '../Form/create-data.js';
import { keyToIntent } from '../Form/keys.js';
import { parentOptionSource } from '../Form/parent-source.js';

// The key hints, on TWO rows (BB-309 D7 / AC-1).
//
// Not a style choice. The popup is a fixed overlay — the kernel draws it at
// `innerWidth = Math.min(60, terminalWidth - 8)` — and every row goes through
// `fitLine`, which TRUNCATES what does not fit with an ellipsis. Naming both
// submit actions on one row costs 81 columns, so `Ctrl+D direct` would have
// been clipped away on every real terminal while a wide-viewport test still
// read it back off the string. Measured on the shipped build before this
// change, the ONE-row hint was already clipped:
//
//     ↑↓ field · ←→ change · Space toggle · Ctrl+S create · Esc …
//
// Shortening the wording instead would have cost `Space toggle` — a hint that
// is the only clue the label list is togglable — to buy room for the new keys.
// The modal frame splits a body row on `\n` already (`tui-kernel.ts`), so a
// second row costs no kernel change; R3 already accepts that the popup grew.

export class CreateTicketFormScreen extends AsyncModalScreen<CreateFormOptions> {
  readonly modal = true;
  static readonly route = {
    id: 'ticket.create',
    path: '/tickets/new',
    parent: 'project.overview',
    presentation: 'modal',
  } satisfies RouteMetadata;
  readonly id = CreateTicketFormScreen.route.id;
  private form: CreateFormState | undefined;
  /**
   * The routing choices carried from the previous open (BB-314 D6).
   *
   * On the screen rather than in a module: it is per-popup state with the same
   * lifetime as the loaded option bags, and `reset()` — the codebase's "this
   * screen belongs to a different session or scope now" signal — must be able
   * to drop it. A module-level cache would outlive the Router, and
   * `Router`'s constructor states exactly why that is not allowed.
   */
  private remembered: CreateRemembered | undefined;
  private action: ScreenAction | undefined;
  private context: ScreenContext | undefined;
  private sources: OptionSources = {};
  private optionLoader: OptionLoader | undefined;
  /**
   * Which declared form is standing (BB-664 AC-8): the ordinary one when a
   * project is already in scope (unchanged), or the one with the extra
   * Project field when it is not. Set once per `load()` — a scope change goes
   * through `reset()`, which drops the whole screen, not just this flag.
   */
  private hasProjectContext = false;
  /** The hints `load()` resolved, MINUS `projectId` — kept so a project picked
   *  in the new field can rebuild the Conductor source with the rest intact
   *  (BB-664 AC-8). */
  private hints: Omit<CreateFormHints, 'projectId'> = {};
  /** The last refusal, drawn inside the popup (BB-309 D6). */
  private message = '';
  /** In-flight guard against a second POST from a second keypress. */
  private submitting = false;
  /**
   * The operator's uuid, resolved at most once per screen lifetime (BB-460
   * fix round 1). `context.services.currentUser` is a USERNAME, not the uuid
   * `Conductor.ownerUserId` compares against — threading it straight through
   * silently no-oped the owner-first ordering.
   */
  private readonly ownerIdentity = new OwnerIdentity(resolveWhoCandidate);

  get options(): CreateFormOptions | undefined {
    return this.readyValue;
  }
  /** The declared form standing right now (BB-664 AC-8). */
  private declaration() {
    return this.hasProjectContext ? CREATE_FORM : CREATE_FORM_WITH_PROJECT;
  }
  /** `declaration()`'s own field list — what the component walks to render. */
  private fieldList() {
    return this.hasProjectContext ? FIELDS : FIELDS_WITH_PROJECT;
  }
  protected async load(context: ScreenContext): Promise<CreateFormOptions> {
    this.context = context;
    if (!context.services) throw new Error('New-ticket form requires services');
    // BB-460 fix round 1: `currentUser` is a username; `ownerUserId` must be
    // the operator's uuid (`Conductor.ownerUserId`'s shape), so it is resolved
    // once per screen lifetime through `OwnerIdentity` rather than threaded
    // straight through. Fails open: `unavailable` omits the hint entirely.
    const ownerOutcome = await this.ownerIdentity.resolve(
      context.services.client,
      context.services.currentUser,
    );
    this.hasProjectContext = context.project !== undefined;
    this.hints = {
      ...(context.services.currentUser === undefined
        ? {}
        : { currentUser: context.services.currentUser }),
      ...(ownerOutcome.kind === 'resolved'
        ? { ownerUserId: ownerOutcome.id }
        : {}),
      ...(context.services.ownConductorMachineId === undefined
        ? {}
        : { ownConductorMachineId: context.services.ownConductorMachineId }),
      ...(context.services.workspaceId === undefined
        ? {}
        : { workspaceId: context.services.workspaceId }),
    };
    const sources = createFormSources(context.services.client, {
      ...this.hints,
      ...(context.project === undefined
        ? {}
        : { projectId: context.project.id }),
    });
    this.sources = sources;
    return composeCreateFormOptions(sources).catch((caught: unknown) => ({
      users: [],
      reviewers: [],
      conductors: [],
      labels: [],
      workflows: [],
      errors: {
        form: caught instanceof Error ? caught.message : String(caught),
      },
    }));
  }
  /**
   * Reopening the popup starts a NEW ticket (BB-314 D1/D3).
   *
   * `AsyncScreen.enter` returns early while the state is still `ready`, so
   * `didLoad` — the only place that ever built the form — does not run again,
   * and the whole form of the ticket that was just submitted was still standing
   * (spec F1/F2). The rule is a STATE, not an after-submit hook: the content
   * fields are empty whenever the popup opens, after a submit and after an Esc
   * alike.
   *
   * The snapshot is taken BEFORE `super.enter`, because the session/scope branch
   * inside it calls `reset()` — which clears both the form and this memory. That
   * ordering is the decision, not an accident: a scope change genuinely starts
   * over (R1).
   */
  override enter(context: ScreenContext): void {
    if (this.form) this.remembered = rememberedValues(this.form);
    super.enter(context);
    // Ready ⇒ `super.enter` reused the cached bags and rebuilding is ours to do.
    // Loading/error ⇒ there is nothing to build from, and `didLoad` will build
    // it through the very same rule.
    const options = this.readyValue;
    if (options) {
      this.form = this.freshForm(options);
      // `super.enter`'s `ready` branch already painted — from the form we just
      // replaced. The kernel draws SYNCHRONOUSLY inside `requestDraw`, so that
      // paint is the only one this navigation issues, and without a second one
      // the operator keeps looking at the previous ticket's content until some
      // unrelated keystroke forces a repaint. Only when a rebuild actually
      // happened: the loading/error branches have nothing new to show, and
      // `didLoad` requests its own draw when the load lands.
      context.requestDraw();
    }
  }
  protected override didLoad(options: CreateFormOptions): void {
    this.form = this.freshForm(options);
    this.startOptionLoader();
  }
  /**
   * A new ticket's form. The template is forced to none: a select opens on its
   * first option, and a template must be chosen, never preselected.
   */
  private freshForm(options: CreateFormOptions): CreateFormState {
    return this.declaration().initial(options, {
      ...(this.remembered ?? {}),
      template: null,
    });
  }
  /** The template picked in the form, or null. */
  private pickedTemplate(): string | null {
    return (
      (this.form as unknown as { template?: string | null } | undefined)
        ?.template ?? null
    );
  }
  private startOptionLoader(): void {
    this.optionLoader?.cancel();
    this.optionLoader = createOptionLoader<CreateFormOptions>({
      sources: this.sources,
      // Absent unless the caller injected one: `createOptionLoader` owns the
      // timer default (`timerDebounce`).
      ...(this.context?.options?.debounce
        ? { debounce: this.context.options.debounce }
        : {}),
      current: () => this.readyValue ?? null,
      onLoaded: (next) => {
        this.replaceReady(next);
        this.context?.requestDraw();
      },
    });
  }
  protected renderLoading(): string[] {
    return ['Loading new-ticket form…'];
  }
  /**
   * BB-340 D1/D3 — the popup's body as the tree the widget layer builds.
   *
   * Title, Description and the Parent field's query hold their insertion point
   * as `FieldTextarea` NODES inside that tree, so this screen publishes no
   * `caret` coordinate any more — and with it goes the whole chain the caret's
   * row travelled: the widget rebased its row onto the fields' rows, the
   * component rebased THAT by the notes it had prepended, and this screen
   * rebased it again onto the `flatMap`ped surface, counting the physical rows
   * of everything above it. A node needs none of those translations: it sits in
   * the layout where the widget put it.
   */
  protected renderReady(options: CreateFormOptions): VNode {
    // Ready without a form is unreachable — `didLoad` and `enter` both build
    // one — and it shows nothing when it happens, exactly as the empty row
    // surface did. Rooted at the SAME id so a frame that did hit it would patch
    // the standing tree rather than build a second one beside it.
    if (!this.form) return columnNode(CREATE_FORM_REGION);
    return createFormTree(this.fieldList(), this.form, options, {
      message: this.message,
    });
  }
  takeAction(): ScreenAction | undefined {
    const action = this.action;
    this.action = undefined;
    return action;
  }
  override handleInput(input: string, context: ScreenContext): boolean {
    if (super.handleInput(input, context)) return true;
    const options = this.readyValue;
    if (!options || !this.form) return false;
    const declaration = this.declaration();
    const field = declaration.activeField(this.form);
    // BB-309 D7 — Ctrl+D is handled HERE rather than in `Form/keys.ts`. The
    // kernel's one `submit` intent cannot say WHICH of two actions was meant,
    // and a generic key module has no business knowing that a form has an
    // "agent" action and a "direct" one. So the second binding belongs to the
    // form that has two, and the kernel's Intent union is untouched.
    if (input === 'ctrl+d') {
      if (this.pickedTemplate() !== null) {
        void this.submitTemplate(context);
        context.requestDraw();
        return true;
      }
      const payload: CreateFormPayload = declaration.toObject(
        this.form,
        options,
      );
      void this.submitDirect(payload, context);
      context.requestDraw();
      return true;
    }
    // BB-300 D3 — the field count is passed so the kernel can scope ↑/↓
    // suggestion-browsing to single-field forms; this form has several, so
    // ↑/↓ keep moving between fields here (AC-5).
    const intent = keyToIntent(input, field, {
      fieldCount: declaration.fields.length,
    });
    if (!intent) return true;
    if (intent.kind === 'cancel') {
      this.action = { type: 'back' };
    } else if (intent.kind === 'submit') {
      const payload: CreateFormPayload = declaration.toObject(
        this.form,
        options,
      );
      // Ctrl+S PRESSES THE ROW YOU ARE STANDING ON; from any other field it
      // means the agent, exactly as it did before this ticket (AC-6). Enter on
      // an action row arrives here as the same `submit` intent, so both keys
      // resolve through one rule and neither can fire the EXPENSIVE path by
      // surprise.
      const target = field.kind === 'action' ? field.id : AGENT_ACTION_ID;
      // With a template picked, BOTH rows mean "run the template".
      if (this.pickedTemplate() !== null) void this.submitTemplate(context);
      else if (target === DIRECT_ACTION_ID)
        void this.submitDirect(payload, context);
      else void this.submit(payload, context);
    } else {
      // The message is drawn ABOVE the form, so a refusal that outlives the
      // edit it complained about describes a form that no longer exists: the
      // operator types the missing title and is still told the title is
      // missing. Any field change retires it.
      this.message = '';
      // BB-664 AC-8: a NEW pick (or a clear) on the Project field re-scopes
      // the Conductor bag and drops any conductor picked under the PREVIOUS
      // project — the same staleness `parent`'s project already forbids,
      // applied to the field that now decides it instead of receiving it.
      const previousProject =
        field.id === 'project'
          ? (this.form as unknown as { project: string | null }).project
          : null;
      this.form = declaration.apply(this.form, options, intent);
      // Any change counts, typing included: editing the query drops the
      // pick, and a conductor of the dropped project must go with it.
      if (field.id === 'project') {
        const nextProject = (this.form as unknown as { project: string | null })
          .project;
        if (nextProject !== previousProject) {
          this.form = {
            ...this.form,
            conductor: null,
            parent: null,
            parentQuery: '',
            template: null,
          };
          void this.rescopeToProject(nextProject, context);
        }
      }
      if (
        field.query !== undefined &&
        (intent.kind === 'insert' || intent.kind === 'backspace')
      ) {
        const query = (this.form as unknown as Record<string, unknown>)[
          field.query
        ];
        this.optionLoader?.reload(
          field.id,
          typeof query === 'string' ? query : '',
        );
      }
    }
    context.requestDraw();
    return true;
  }
  /**
   * Re-scope the project-dependent bags to the project just picked in the
   * Project field (BB-664 AC-8): Conductor through the same source
   * `createFormSources` declares, Parent by swapping in that project's parent
   * source (the option loader reads `this.sources` at query time, so later
   * typing searches the new project). No project: no conductor, no parent.
   */
  private async rescopeToProject(
    projectId: string | null,
    context: ScreenContext,
  ): Promise<void> {
    const client = context.services?.client;
    if (!client) return;
    const { parent: _previous, ...rest } = this.sources;
    this.sources =
      projectId === null
        ? rest
        : { ...rest, parent: parentOptionSource(client, projectId) };
    this.startOptionLoader();
    const conductorSource = conductorOptionSource(client, {
      ...this.hints,
      ...(projectId === null ? {} : { projectId }),
    });
    const [conductors, parents, templates] = await Promise.all([
      conductorSource.load(''),
      this.sources.parent?.load(''),
      projectId === null
        ? undefined
        : templateOptionSource(client, projectId, this.hints.workspaceId).load(
            '',
          ),
    ]);
    const current = this.readyValue;
    if (!current || !context.isActive()) return;
    // A later pick supersedes this load: a slow answer for the previous
    // project must not replace the current project's candidates.
    const picked =
      (this.form as unknown as { project: string | null } | undefined)
        ?.project ?? null;
    if (picked !== projectId) return;
    // Errors merged like the option loader's own merge: a failed read shows
    // its error instead of reading as "this project has none".
    const errors: Record<string, string | undefined> = { ...current.errors };
    delete errors.conductors;
    delete errors.parents;
    delete errors.templates;
    if (conductors.error !== undefined) errors.conductors = conductors.error;
    if (parents?.error !== undefined) errors.parents = parents.error;
    if (templates?.error !== undefined) errors.templates = templates.error;
    this.replaceReady({
      ...current,
      conductors: conductors.options,
      parents: parents?.options as CreateFormOptions['parents'],
      templates: templates?.options,
      errors: Object.keys(errors).length > 0 ? errors : undefined,
    });
    context.requestDraw();
  }
  override reset(): void {
    this.form = undefined;
    this.remembered = undefined;
    this.action = undefined;
    this.context = undefined;
    this.message = '';
    this.submitting = false;
    this.optionLoader?.cancel();
    this.optionLoader = undefined;
    this.sources = {};
    this.hasProjectContext = false;
    this.hints = {};
    this.ownerIdentity.reset();
    super.reset();
  }
  protected modalChrome(context: ScreenContext): ModalChrome {
    return {
      title: '⚡ New ticket',
      meta:
        context.project?.name ??
        context.project?.slug ??
        context.options?.project ??
        '',
    };
  }

  protected override actions() {
    return [...this.fieldActions(), ...this.submitActions()];
  }

  /** Two status rows so Ctrl+D is not clipped in the modal box (AC-1). */
  protected override modalStatusLines(): string[] {
    return [
      formatActionLadder(this.fieldActions()),
      formatActionLadder(this.submitActions()),
    ];
  }

  private fieldActions() {
    return this.form &&
      this.declaration().activeField(this.form).kind === 'autocomplete'
      ? [
          actionItem('create-field', '↑↓', 'field'),
          actionItem('create-suggest', '←→', 'suggestion'),
          actionItem('create-pick', 'Enter', 'pick'),
        ]
      : [
          actionItem('create-field', '↑↓', 'field'),
          actionItem('create-change', '←→', 'change'),
          actionItem('create-toggle', 'Space', 'toggle'),
        ];
  }

  private submitActions() {
    if (this.pickedTemplate() !== null) {
      return [
        actionItem('create-template', 'Ctrl+S/D', 'run template'),
        actionItem('create-esc', 'Esc', 'cancel'),
      ];
    }
    return [
      actionItem('create-agent', 'Ctrl+S', 'agent'),
      actionItem('create-direct', 'Ctrl+D', 'direct'),
      actionItem('create-esc', 'Esc', 'cancel'),
    ];
  }

  /**
   * Write the ticket straight to the control plane (BB-309).
   *
   * No agent, no temp spec, no transition: the payload becomes a JSON:API
   * document and one POST. The failure shape is `EditAssignmentFormScreen`'s,
   * verbatim — a `submitting` guard, `writeClient ?? client`, the server's own
   * message into the popup's message line, the form left standing, and
   * `context.back` ONLY on success. AC-7 and AC-8 both fall out of that.
   */
  private async submitDirect(
    payload: CreateFormPayload,
    context: ScreenContext,
  ): Promise<void> {
    if (this.submitting) return;
    // D8 — a project is a PRECONDITION, not a fallback. Without `project_id`
    // the server writes a ticket that draws no number and gets no bakers.build-nnn
    // identifier (`BbTicket::allocateNumber()` returns early), which is worse
    // than not writing one. BB-664 AC-8: with no project already in scope the
    // popup shows a Project field instead of refusing outright, so the
    // precondition is now "a project was picked", not "one happened to be in
    // scope" — `context.project` when there was one, the form's own pick when
    // there was not.
    const projectId =
      context.project?.id ??
      (this.form as unknown as { project: string | null } | undefined)
        ?.project ??
      undefined;
    if (!projectId) {
      this.message = 'no project selected — pick one above to create directly';
      context.requestDraw();
      return;
    }
    // D1 — `bb_ticket.title` is `setRequired(TRUE)`, so an empty title is a
    // 422 the operator waits a whole round trip to be told about. Refused the
    // same way the missing project is, and for the same reason: the popup
    // already knows the answer. The AGENT row is deliberately untouched — it
    // resolves and writes the ticket itself, so nothing here may narrow what it
    // accepts (AC-6).
    if (!payload.title.trim()) {
      this.message = 'title is required — type one, or hand it to the agent';
      context.requestDraw();
      return;
    }
    this.submitting = true;
    this.message = '';
    const client = context.services?.writeClient ?? context.services?.client;
    try {
      const created = await createTicket(
        client,
        buildTicketCreateBody(payload, projectId),
      );
      // dropsh's `create` ends `return toResource(doc.data)`, so what comes back
      // is a RESOURCE with a top-level `id` — not the JSON:API document it
      // posted. Reading `created.data.id` therefore yielded the empty string
      // against the real client and only ever looked right in a test whose
      // double returned the document shape. One shape is read, the seam's own.
      const ticketId = (created as { id?: string } | undefined)?.id ?? '';
      const result = { type: 'ticket-created-directly' as const, ticketId };
      // The D6 reference's fallback, verbatim. The kernel always supplies
      // `back`, so this is unreachable through it — but what a missing fallback
      // produces is a popup left standing over a ticket that WAS written, and a
      // second keypress writes a second one. That is the single outcome AC-2
      // forbids, so it is closed rather than reasoned about.
      if (context.back) context.back(result);
      else this.action = { type: 'back', result };
    } catch (caught: unknown) {
      this.message = serverMessage(caught);
    } finally {
      this.submitting = false;
      if (context.isActive()) context.requestDraw();
    }
  }

  /**
   * Run the picked ticket template instead of the ordinary create.
   *
   * One POST naming the current project; the guard, the server-worded message
   * and the stay-open-on-failure shape are `submitDirect`'s.
   */
  private async submitTemplate(context: ScreenContext): Promise<void> {
    if (this.submitting) return;
    const templateId = this.pickedTemplate();
    const projectId =
      context.project?.id ??
      (this.form as unknown as { project: string | null } | undefined)
        ?.project ??
      undefined;
    if (!templateId) return;
    if (!projectId) {
      this.message = 'no project selected — pick one above to run a template';
      context.requestDraw();
      return;
    }
    this.submitting = true;
    this.message = '';
    const client = context.services?.writeClient ?? context.services?.client;
    try {
      if (!client)
        throw new Error(
          'no write client — `bakers ui` has no connection able to write',
        );
      const run = await runTemplate(client, templateId, projectId);
      const result = {
        type: 'ticket-created-directly' as const,
        ticketId: run.ticketId,
      };
      if (context.back) context.back(result);
      else this.action = { type: 'back', result };
    } catch (caught: unknown) {
      const status = (caught as { status?: unknown } | null)?.status;
      // A transport failure (status 0) may have written the ticket already.
      this.message =
        status === 0
          ? 'network failure — the ticket may have been created; check the project before retrying'
          : serverMessage(caught);
    } finally {
      this.submitting = false;
      if (context.isActive()) context.requestDraw();
    }
  }

  private async submit(
    payload: CreateFormPayload,
    context: ScreenContext,
  ): Promise<void> {
    // The two rows are two answers to the same form: a refusal the DIRECT row
    // collected says nothing about the agent row, so it goes when this one is
    // chosen (the popup usually closes right after, which is why this is
    // belt-and-braces rather than the visible half of the fix).
    this.message = '';
    const agents = context.services?.agents;
    if (!agents) {
      this.action = {
        type: 'back',
        result: { type: 'ticket-create-requested', payload },
      };
      return;
    }
    // BB-664 review F4: a guessed project was a fake resolution, not a real
    // one — the literal `bakers` fallback sent the agent into whatever project
    // happened to carry that slug. BB-664 AC-8: with no project already in
    // scope the popup offers a Project field instead, and a pick there is as
    // real a resolution as `context.project` — checked before the legacy
    // `context.options?.project` default, since an explicit pick says more
    // than an ambient one.
    const formProjectId = (
      this.form as unknown as { project: string | null } | undefined
    )?.project;
    const pickedProject = formProjectId
      ? optionFor(this.readyValue?.projects ?? [], formProjectId)
      : null;
    const project =
      context.project?.slug ?? pickedProject?.label ?? context.options?.project;
    if (!project) {
      this.message =
        'no project selected — pick one above to hand this to the agent';
      context.requestDraw();
      return;
    }
    let specPath: string | undefined;
    try {
      specPath = join(tmpdir(), `bakers-new-ticket-${Date.now()}.json`);
      writeFileSync(
        specPath,
        JSON.stringify({ project, is_new: true, ...payload }, null, 2),
        'utf8',
      );
    } catch {
      specPath = undefined;
    }
    await agents.launch(
      buildCreateLaunch({
        project,
        cwd: context.options?.cwd ?? process.cwd(),
        ...(specPath ? { specPath } : {}),
        workflow: payload.workflow?.id,
        label: shortName(payload),
        createPrompt:
          context.options?.createPrompt ?? context.services?.createPrompt,
      }),
    );
    context.back?.({ type: 'ticket-created', payload });
  }
}
