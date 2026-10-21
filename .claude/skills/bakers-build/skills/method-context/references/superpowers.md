# Superpowers skill set

> **Pick for well-understood work you want executed cheaply.** It writes an exhaustive plan up
> front (`brainstorming` → `writing-plans`), so the execution (`executing-plans`) can run on a
> simpler, cheaper model — best when the problem is clear and the value is in a thorough,
> hand-offable plan.

Agent calibre: use strong reasoning for planning; a reliable, efficient implementer can execute
a detailed approved plan, escalating gaps instead of inventing requirements.

Use the original `superpowers` skills as made available by the agent's environment.
Names below identify upstream skills, not installation paths or a bakers.build-managed package.
Use this collection under the loading and ticket-context contract in `@bakers-build/method-context`.

| Work step or condition | Skill |
|---|---|
| Qualification: unresolved requirements | `brainstorming` |
| Specification | `brainstorming`, then `writing-plans` |
| Coding from the approved plan | `executing-plans` |
| Diagnosis | `systematic-debugging` |
| Test-first work at agreed seams | `test-driven-development` |
| Review | `requesting-code-review` |
| Writing reusable skills | `writing-skills` |

Apply conditional rows only when they fit the task. Supply the confirmed ticket specification
and plan to the selected method. bakers.build lifecycle steps without an engineering method use their
existing owner. Restrict each method to the current bakers.build state and reuse the user's scope approval;
method checkpoints do not require repeating an approval already given for the same work.
