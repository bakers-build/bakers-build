# Answer an agent's question

**When an agent needs a decision only you can make, it asks on the ticket and waits.**

**You need:** permission to update the ticket.

1. **Spot the question.** The ticket carries the label *Question* and is [frozen](/get-started/daily-work/freeze-a-ticket). Its newest comment starting with *Question* holds the question, often with numbered choices and a recommendation.
2. **Answer in a comment.** Write any comment after the question; anyone who can comment may answer or approve.
3. **Release the ticket.** Remove the label *Question* and choose **Unfreeze ticket**. A comment alone keeps the ticket waiting.

The next run reads every comment after the question as the answer and continues the same step. On the same machine and in the same state it resumes the agent session that asked.

**Done when:** the label is gone, the ticket is unfrozen, and the next run continues with your answer.

On a ticket labelled *Autopilot*, nobody watches the terminal, so a Claude run cannot open its question dialog: the [ask hook](/addons/claude#good-to-know) sends the agent to the ticket question instead.
