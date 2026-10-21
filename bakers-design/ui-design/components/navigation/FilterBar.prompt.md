Global filter bar above the sections: Projekte + Conductors multiselects and a "Meine" toggle. Writes to the querystring; every htmx fragment reads the same params (`hx-include="#filters"`).

```jsx
<FilterBar projectsLabel="alle" conductorsCount={2} mineOn
  querystring="?projects=alle&conductors=srv01-bakers&mine=1&wf=feature" />
```
