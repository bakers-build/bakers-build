# Accept results

Check delivered work against the ticket's criteria, submit findings and make the next decision explicit.

**You need:** access to the ticket and its latest summary, criteria and evidence. For code changes, open the linked merge request. For a running application, you also need a working preview and any required application login.

## Agent review and human review

The workflow's `review` state is an **agent code review**: an agent checks the produced changes against requirements and repository standards. Whether this step is mandatory depends on the recipe; Matt requires it for features.

A **human result review** is separate. Someone assigned under **Reviewers** can try the result and submit observations. The assignment does not start a service or tunnel, grant application login, or approve delivery.

## Review the result

1. **Assign the reviewer.** A person with ticket-update permission selects the reviewer in the Properties panel's **Reviewers** field. The reviewer needs access to the ticket's workspace. Being a reviewer does not grant permission to edit the ticket.

2. **Read the handoff.** Start with the latest `summary`, then its `coding` or agent `review` evidence. Identify the tested revision, passing criteria, failed or missing checks and the walkthrough. Ask for missing evidence before treating a criterion as passed.

3. **Open the preview when needed.** Use the URL supplied in the handoff. If the project's Ports addon is enabled, the ticket's message card offers **Share tunnels**, which requests URLs for eligible running worktree services. The operator must first start the service and configure a tunnel transport; follow [Ports](/addons/ports) for setup. If no URL is returned, ask the operator to check those prerequisites. A tunnel URL can be public while it lives; use the supplied test account or login link if the application requires authentication.

4. **Check the criteria.** Follow the walkthrough on the supplied revision, including expected failures or access restrictions. For documentation or another change without a running application, inspect the supplied artifact instead. Record what you tried and what happened. You can ask:

   ```text
   Read <identifier> and its comments. Walk me through the acceptance
   criteria, identify the preview or artifact, and distinguish passing
   evidence from checks that are still missing.
   ```

5. **Submit your findings.** As an assigned reviewer, choose **Write a review** in **Reviews**. Describe the checked revision, actions, results and remaining issues. **Save draft** keeps an editable draft private to you. **Submit review** sends it to the assignee for a publication decision; its text can no longer be edited.

## Publish the review comment

The ticket's current **assignee**, rather than every reviewer, decides what happens to a submitted review:

| Action | Effect |
|---|---|
| **Accept** | Publishes the review comment to the ticket's readers. |
| **Reject** | Keeps it unpublished. |

These buttons decide publication of the comment. They do not accept the implementation, change the ticket's workflow state or merge code. Record the delivery decision explicitly, with the evidence and any unresolved findings.

## Decide what happens next

When work falls short, name the open criterion and the cause:

| Cause | Meaning | Next action |
|---|---|---|
| `implementation` | The result falls short. | Request a correction. |
| `evidence` | A required check is missing or inconclusive. | Request the missing verification. |
| `criterion` | The requirement cannot be met as written. | Agree a scope correction before more work. |

For changed requirements, ask your agent to use `bb-scope-change`.

When the result meets the criteria, state that decision separately from authorization to merge or deploy. Merging requires explicit authorization for the linked merge request, passing required CI checks and a mergeable branch. Follow your project's delivery workflow for deployment. At `done` or `cancelled`, you can give an optional rating from 1 to 5.

**Done when:** your findings and delivery decision are recorded, and the next action has an owner. A submitted or published review alone does not mean the ticket is done.

**Next:** [Follow the ticket](/get-started/daily-work/follow-a-ticket) through corrections or authorized delivery.
