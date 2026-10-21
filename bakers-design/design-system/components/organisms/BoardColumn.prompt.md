Board column for one workflow state. Renders BoardCards, or an empty-state hint when there are none.

```jsx
<BoardColumn name="coding" count={3} accent="running">
  <BoardCard … /><BoardCard … />
</BoardColumn>
<BoardColumn name="review" count={0} empty="nichts in review" />
```
