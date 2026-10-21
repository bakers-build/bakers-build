Wrapper for every dashboard section; the `id` doubles as the htmx fragment id and screen label.

```jsx
<SectionShell id="frag-active" title="Aktive Tickets" count={7} countAlert updated="vor 4 s">
  <table className="bakers-table">…</table>
</SectionShell>
```
