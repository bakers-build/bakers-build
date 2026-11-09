# Accept results

Check an agent's delivered change and tell the team whether it is ready or needs more work.

The path is: **open the result → try it → write your findings → agree the next step**.

Two people may be involved:

- The **reviewer** tries the result and writes a review.
- The **assignee**, the person the ticket is assigned to, publishes that review for the ticket's readers.

**You need:** ticket access, acceptance criteria and the latest summary. To try an application, you also need a running preview and any required login.

## Review the result

These steps are for the human reviewer.

1. **Get assigned.** Ask someone who can edit the ticket to add you under **Properties → Reviewers**. You can then choose **Write a review** in **Reviews**. Skip this step if you are already listed. Assignment grants no workspace access or ticket-edit permission.

2. **Open the result.** Read the latest `summary` comment. Follow its preview, document or merge-request link; note the version being checked. Use the supplied test account when needed. Ask for any missing link, login or test instructions.

   With Ports, **Share tunnels** on the ticket's message card requests preview links. The operator must first start the service and configure the tunnel; [Ports](/addons/ports) explains setup. Reviewer assignment starts neither. A tunnel link may be public; the application can still require a login.

3. **Try the task.** Follow the summary's walkthrough and compare the result with each acceptance criterion, including requested error and access checks. For documentation, read the pages and follow their links. Check the recorded test results too; name anything you could not verify.

4. **Write your findings.** Choose **Reviews → Write a review**. Include what you checked and what needs attention. For example:

   > Checked preview abc123 on desktop and mobile. Creating a ticket works on desktop. On mobile, Save is hidden, so criterion 2 fails. Please fix this before delivery.

5. **Submit the review.** **Save draft** keeps your text private and editable. **Submit review** sends it to the assignee and locks the text. Your checking step is complete when the review shows **Submitted**.

## Publish the review comment

This step is for the **assignee**. Open the submitted review in **Reviews** and choose:

- **Accept** to publish the review comment for the ticket's readers.
- **Reject** to leave it unpublished.

::: tip What does Accept mean here?
It means **publish this review**, including any problems it reports. The button does not approve the implementation, finish the ticket or merge code.
:::

## Decide what happens next

Use the findings to tell the agent what should happen next:

- **Something fails:** describe the problem and the affected criterion; request a correction.
- **Something was not checked:** request the missing check before deciding.
- **The requirement needs changing:** agree the new scope first; ask your agent to use `bb-scope-change`.
- **The result meets the criteria:** say so explicitly. Give merge or deployment permission only when you intend that next action.

For example: “The result meets the criteria. Wait for my merge instruction.” A merge needs explicit permission for the specific merge request, passing required CI checks and a mergeable branch. Deployment follows your project's workflow.

**Done when:** the findings and next action are recorded, with someone responsible for that action. This completes your review; the ticket follows its own workflow to completion. Optional completion [ratings](/skills-and-workflows/metrics) are described separately.

## Agent review and human review

You performed a **human result review**. The workflow's `review` state is an **agent code review**: an agent checks the changes against requirements and repository standards.

The recipe decides whether agent review is required; Matt requires it for features. It does not automatically assign a human reviewer. Publishing your review changes neither the workflow state nor its required agent checks.

**Next:** [Follow the ticket](/get-started/daily-work/follow-a-ticket) through corrections or authorized delivery.
