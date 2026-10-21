A row of the "Aktive Tickets" table (states except backlog/done/cancelled). Sort by urgency: wait > needs_input > attention > running > idle, then age. `assignee: null` shows NIEMAND + the swimsuit CTA.

```jsx
<TicketRow id="GL-150" title="API-Key fehlt" project="bakers" stateLabel="coding" state="wait"
  statusNode={<StatusPill state="wait">needs_input</StatusPill>}
  lease={{ machine: 'cw-laptop-bakers' }} since="3 h" assignee={null} href="#" />
```
