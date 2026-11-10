# Get emails about ticket activity

Choose which ticket events bakers.build mails you about. Nothing is sent until you tick a box.

**You need:** a bakers.build account with an email address, and access to the tickets you want to hear about.

1. Open your account with the person mark in the navigation, then **Notifications** (`/user/{you}/notifications`). It sits next to **Time** and **Schedule**.

2. Tick the events you want under **Activity mails**:

   | Event | Mailed when |
   |---|---|
   | **Ticket assigned** | You become the assignee of a ticket, when it is created or later, also when bakers.build takes the assignee over from a conductor's owner |
   | **Review requested** | Someone adds you to a ticket's **Reviewers** |
   | **Review completed** | A reviewer you added submits their review. If nobody added that reviewer, the ticket's assignee is told. |

3. Choose **Save notification settings**.

**Done when:** the page confirms "Notification settings saved." and your ticks are still there after a reload.

## What to expect

- A mail goes out as soon as the change is saved. There is no scheduled run to wait for.
- A change that does not go through sends nothing. A mail that cannot be delivered is not sent again.
- You get one mail per event you ticked. One change can be several events, for example a new assignee together with a reviewer, and each ticked one is mailed.
- Your own changes are mailed too.
- A mail names the ticket and the event and links to the ticket. It never names who made the change.
- A mail is sent only if you can open the ticket.
- The three shipped event types default to unticked. A newly installed event type may define its own default; review your settings after an update.
