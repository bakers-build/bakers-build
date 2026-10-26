# Accept results

**Check the delivered work against your criteria and record your verdict.**

**You need:** a ticket whose latest `summary` says the work is ready, with its merge request linked.

1. **Read the result.** Start with the `summary`, then the `review` comment: each criterion with PASS or FAIL and the evidence behind it.

2. **Check it yourself.** Try the walkthrough where the summary offers one. Or ask your agent:

   ```text
   Use bb-read-ticket for <identifier> and walk me through the review, criterion by criterion.
   ```

   A criterion counts when you can repeat its evidence.

3. **Record your verdict in the browser.** Add yourself under **Reviewers** in the ticket's Properties panel. The **Reviews** section then offers **Write a review**: describe what you checked, **Submit review**, then **Accept** or **Reject**. Only the decisions you are allowed to make are offered.

   When you reject, name each open criterion and its cause:

   | Cause | Meaning | Next |
   |---|---|---|
   | `implementation` | the change falls short | back to `working` |
   | `evidence` | the change may work, but nothing shows it | back to `working` |
   | `criterion` | the criterion cannot be met as written | you decide on a rewrite |

   Requirement changed? Ask your agent to use `bb-scope-change`.

4. **Merge on purpose.** You authorize review, merge and deployment separately; a verdict authorizes none of them. bakers.build merges only with a linked merge request, a green pipeline and a clean merge, then moves the ticket to `done`. Deployment is its own ticket.

5. **Close.** At `done` or `cancelled` you may give an optional rating from 1 to 5.

**Done when:** the ticket is `done` and holds your decision and its evidence.
