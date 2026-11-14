// The landing page copy, one set per language (Figma section 667:258: EN frame 667:698,
// DE frame 667:259). Both render through the same components; German is allowed for
// landing copy only (docs/bakers/conventions.md › English only).

export const SIGN_UP_URL = 'https://app.bakers.build/'
export const ADDONS_URL = '/addons/'
export const DOCS_URL = '/get-started/'
export const SELF_HOST_URL = '/self-hosting/'
export const SECURITY_URL = '/agents/security'
export const REPO_URL = 'https://github.com/bakers-build/bakers-build'
// The language switch, in the design's fixed order.
export const LANGUAGES = [
  { code: 'de', label: 'DE', name: 'Deutsch', href: '/de/' },
  { code: 'en', label: 'EN', name: 'English', href: '/' },
]

const en = {
  lang: 'en',
  home: '/',
  nav: { label: 'Main', menu: 'Menu' },
  signUp: 'Sign up',
  docs: 'Read the docs',
  hero: {
    title: 'A ticket-driven AI software factory.',
    text: "Before your team is up, the prep is done. Agents work every ticket on your development machine or on remote workers, and at every step you can look into the oven.",
    note: 'Open source. Runs on your machines.',
    lineLabel: 'The line: four stations, Plan, Build, Review and Ship, each worked by an agent. At each one a person decides: approve plan, confirm result, confirm verdict, authorize merge.',
    tag: 'Human',
    stations: [
      ['Plan', 'weighs it', 'Approve plan'],
      ['Build', 'bakes it', 'Confirm result'],
      ['Review', 'checks it', 'Confirm verdict'],
      ['Ship', 'ready', 'Authorize merge'],
    ],
  },
  trust: ['Open source', 'Your code stays on your machines', 'Every run recorded'],
  line: {
    eyebrow: 'How it works',
    title: 'Every ticket passes the same line.',
    text: 'Four stations. Agents do the work, and a person decides at every station. You choose who: your customer, a developer or you.',
    stations: [
      ['Plan', 'You describe what you need: in the browser, in a chat with Claude or in the terminal. The agent sorts it, asks what’s unclear and proposes a plan with acceptance criteria you can check.', 'Nothing gets built until you approve the scope.'],
      ['Build', 'The agent works on its own branch, in its own environment on your machines. Automated tests run before the ticket moves on.', 'You confirm the result.'],
      ['Review', 'A second agent reviews independently and gives a verdict. When it needs an expert eye, a developer joins.', 'Confirm it, or send it back with a clear expectation.'],
      ['Ship', 'After the merge, a deployment ticket can roll a batch of merged tickets out to an environment and tag the release.', 'A person authorizes the merge: you or someone on your team.'],
    ],
  },
  run: {
    title: 'This is what a run looks like.',
    text: 'The agent works and tests. If something is missing, you send the ticket back with one sentence. If it fits, you authorize the merge.',
    sendBack: 'The redirect works, but keep the return URL after login. Sending it back.',
    merge: 'Review is OK. Merge it.',
  },
  pains: {
    eyebrow: 'Why bakers.build',
    title: 'What used to hold you back.',
    text: 'And what the line changes about it.',
    items: [
      ['“My idea has been sitting in the backlog for weeks.”', 'You start tickets yourself. Building starts once you approve the scope, not once a developer is free.'],
      ['“AI in our project? Who makes sure nothing breaks?”', 'Tests run before every handoff, a second agent reviews independently, and a person authorizes the merge.'],
      ['“I can’t see what’s happening, or what it costs.”', 'Every run is recorded: who or what worked on it, when, with which result and how many tokens, tool calls and agent turns it used.'],
      ['“Another tool that forces a process on us.”', 'Your process lives in WORKFLOW.md in your repo. One text edit, and the line works differently.'],
      ['“Our code must not end up in someone else’s cloud.”', 'Agents run on your machines, with your own agent subscription.'],
    ],
  },
  recipe: {
    title: 'Change the recipe, and the line changes.',
    text: 'How your line works lives in WORKFLOW.md next to your code. No migration, no support ticket.',
    points: [
      'Set which checks must pass before the merge.',
      'Add your own skills for your stack’s builds, tests and deployments.',
      'The recipe goes through code review like everything else.',
    ],
  },
  oven: {
    title: 'Bake it yourself or let us run the oven. Both free.',
    text: 'The core is open source. Self-hosted and hosted are both free for now. Start on one laptop and add machines when it is no longer enough. Addons come in when you need them.',
    self: ['self-hosted · free', 'Self-host', 'Open source. The control plane and conductors run on your own machines.', 'Set it up yourself'],
    hosted: ['hosted · free', 'We run the oven', 'We host the control plane for your team. Conductors and code stay on your machines.'],
    addons: ['Addons', 'More tools', 'Addons connect agents, clients and tunnels, and add time evidence. Every shipped addon is open source and free.', 'See addons'],
    note: "Self-hosted or hosted, the conductors and your code stay on your team's machines. Hosting means only the control plane runs on bakers.build's servers. It holds tickets, handoffs and each run's footprint; your code and run transcripts stay with you.",
  },
  faq: {
    eyebrow: 'Questions',
    title: 'What people ask first.',
    text: ['The full answer on privacy and security is in the ', 'security guide', '.'],
    items: [
      ['Does our code leave our machines?', "No. Agents work in git worktrees on your machines, and your repository stays there. If bakers.build hosts it for you, only the control plane runs on our servers. It holds tickets, handoffs and each run's footprint; your code and run transcripts stay with you."],
      ['What does the AI see?', "The ticket and the code it works on. Requests go from your machine straight to your agent's provider, on your own subscription. By default the agent runs in a sandbox and writes only to its own working folder."],
      ['Do I need to install anything?', 'Not if you only write tickets and approve them: you work in the browser or in a chat with Claude. Whoever sets up the line installs the CLI once.'],
      ['Who merges?', 'A person. You approve the plan, confirm the result, confirm the review verdict and authorize the merge.'],
      ['Do I need developers for this?', 'Once, for the setup: a developer sets up the line and the conductor. After that you write tickets and approve them without waiting for free capacity. For more complex changes, you bring in a developer.'],
      ['Which agents can I use?', 'Claude Code, Codex, Grok, Kimi, OpenCode and Pi, on your own subscription. Swappable per project.'],
      ['How is this different from a coding agent in my editor?', 'An editor agent helps one person in one session. bakers.build runs the whole process for a team: tickets queue up centrally, any registered machine can pick them up, every run is recorded, and the process itself is versioned.'],
      ['Does it fit our stack?', 'Drupal and documentation come with ready skills. For another stack, a developer writes a skill once. Until then, documentation tickets and anything without build checks already run.'],
      ['What does a machine need?', 'Your repository on GitHub or GitLab for merge requests, and a worker machine with Git, Node.js 20.19 or later and a signed-in coding agent.', 'See every check in the machine guide.', '/provision/machine'],
      ['What does it cost?', 'Nothing for now. The core is open source, and self-hosted and hosted are both free. So is every shipped addon, the agent addons included.'],
    ],
  },
  closing: {
    title: 'Try it on a real ticket.',
    text: 'Sign up, create your workspace and invite your team.',
  },
  footer: ['Open source', 'Docs', 'GitHub'],
}

export type Copy = typeof en

const de: Copy = {
  lang: 'de',
  home: '/de/',
  nav: { label: 'Hauptmenü', menu: 'Menü' },
  signUp: 'Anmelden',
  docs: 'Docs lesen',
  hero: {
    title: 'Eine KI-Softwarefabrik. Vom Ticket bis zum Merge.',
    text: 'Bevor dein Team da ist, ist die Vorbereitung erledigt. Agenten arbeiten jedes Ticket auf deinem Entwicklungsrechner oder auf Remote-Workern ab, und bei jedem Schritt kannst du in den Ofen schauen.',
    note: 'Open Source. Läuft auf deinen Rechnern.',
    lineLabel: 'Die Backstraße: vier Stationen, Planen, Umsetzen, Prüfen und Fertig, jede von einem Agenten bearbeitet. An jeder entscheidet ein Mensch: Plan freigeben, Ergebnis bestätigen, Urteil bestätigen, Merge freigeben.',
    tag: 'Mensch',
    stations: [
      ['Planen', 'wiegt ab', 'Plan freigeben'],
      ['Umsetzen', 'backt', 'Ergebnis bestätigen'],
      ['Prüfen', 'schaut hin', 'Urteil bestätigen'],
      ['Fertig', 'ofenfrisch', 'Merge freigeben'],
    ],
  },
  trust: ['Open Source', 'Dein Code bleibt auf deinen Rechnern', 'Jeder Lauf protokolliert'],
  line: {
    eyebrow: 'So funktioniert’s',
    title: 'Jedes Ticket läuft über dieselbe Backstraße.',
    text: 'Vier Stationen. Agenten machen die Arbeit, an jeder Station entscheidet ein Mensch. Wer das ist, legst du fest: dein Kunde, ein Entwickler oder du selbst.',
    stations: [
      ['Planen', 'Du beschreibst, was du brauchst: im Browser, im Chat mit Claude oder im Terminal. Der Agent ordnet ein, fragt nach und legt einen Plan mit prüfbaren Abnahmekriterien vor.', 'Gebaut wird erst, wenn du den Umfang freigibst.'],
      ['Umsetzen', 'Der Agent arbeitet auf eigenem Branch in einer eigenen Umgebung auf deinen Rechnern. Automatische Tests laufen, bevor das Ticket weitergeht.', 'Du bestätigst das Ergebnis.'],
      ['Prüfen', 'Ein zweiter Agent prüft unabhängig und gibt ein Urteil ab. Wenn es den Blick vom Fach braucht, kommt ein Entwickler dazu.', 'Bestätigen oder mit klarer Erwartung zurückschicken.'],
      ['Fertig', 'Nach dem Merge kann ein Deployment-Ticket einen Stapel gemergter Tickets in eine Umgebung ausrollen und das Release taggen.', 'Ein Mensch gibt den Merge frei: du selbst oder jemand aus deinem Team.'],
    ],
  },
  run: {
    title: 'So sieht ein Lauf aus.',
    text: 'Der Agent arbeitet und testet. Fehlt etwas, schickst du das Ticket mit einem Satz zurück. Passt es, gibst du den Merge frei.',
    sendBack: 'Klappt, aber die Rücksprung-URL nach dem Login soll bleiben.',
    merge: 'Review passt. Merge.',
  },
  pains: {
    eyebrow: 'Warum bakers.build',
    title: 'Was dich bisher aufgehalten hat.',
    text: 'Und was die Backstraße daran ändert.',
    items: [
      ['„Meine Idee liegt seit Wochen im Backlog.“', 'Tickets stößt du selbst an. Gebaut wird, sobald du den Umfang freigegeben hast, nicht erst, wenn ein Entwickler frei wird.'],
      ['„KI im Projekt? Wer passt auf, dass nichts kaputtgeht?“', 'Vor jeder Übergabe laufen Tests, ein zweiter Agent prüft unabhängig, und ein Mensch gibt den Merge frei.'],
      ['„Ich sehe nicht, was gerade passiert und was es kostet.“', 'Jeder Lauf ist protokolliert: wer oder was daran gearbeitet hat, wann, mit welchem Ergebnis und wie vielen Tokens, Tool-Aufrufen und Agenten-Turns.'],
      ['„Noch ein Tool, das uns einen Prozess aufzwingt.“', 'Dein Ablauf steht in WORKFLOW.md im Repo. Eine Textänderung, und die Backstraße arbeitet anders.'],
      ['„Unser Code soll nicht in fremden Clouds landen.“', 'Die Agenten laufen auf deinen Rechnern, mit deinem eigenen Agenten-Abo.'],
    ],
  },
  recipe: {
    title: 'Ändere das Rezept, und die Backstraße arbeitet anders.',
    text: 'Wie deine Backstraße arbeitet, steht in WORKFLOW.md neben deinem Code. Keine Migration, kein Support-Ticket.',
    points: [
      'Lege fest, welche Prüfungen vor dem Merge bestehen müssen.',
      'Ergänze eigene Skills für Builds, Tests und Deployments deines Stacks.',
      'Das Rezept geht durchs Code-Review wie alles andere.',
    ],
  },
  oven: {
    title: 'Selbst backen oder wir heizen den Ofen. Beides kostenlos.',
    text: 'Der Kern ist Open Source. Selbst hosten und gehostet kosten vorerst beide nichts. Du startest auf einem Laptop und nimmst weitere Rechner dazu, wenn er nicht mehr reicht. Addons kommen dazu, wenn du sie brauchst.',
    self: ['selbst gehostet · kostenlos', 'Selbst hosten', 'Open Source. Control Plane und Conductors laufen auf deinen eigenen Rechnern.', 'Selbst einrichten'],
    hosted: ['gehostet · kostenlos', 'Wir heizen den Ofen', 'Wir hosten die Control Plane für dein Team. Conductors und Code bleiben auf deinen Rechnern.'],
    addons: ['Addons', 'Mehr Werkzeuge', 'Addons binden Agenten, Clients und Tunnel an und sammeln Zeitnachweise. Jedes mitgelieferte Addon ist Open Source und kostenlos.', 'Addons ansehen'],
    note: 'Selbst betrieben oder gehostet: Conductors und Code bleiben auf den Rechnern deines Teams. Beim Hosting läuft nur die Control Plane auf den Servern von bakers.build. Sie speichert Tickets, Übergaben und den Footprint jedes Laufs; Code und Laufprotokolle bleiben bei dir.',
  },
  faq: {
    eyebrow: 'Fragen',
    title: 'Was zuerst gefragt wird.',
    text: ['Die ganze Antwort zu Datenschutz und Sicherheit steht im ', 'Sicherheitsleitfaden', '.'],
    items: [
      ['Verlässt unser Code unsere Rechner?', 'Nein. Die Agenten arbeiten in Git-Worktrees auf deinen Rechnern, dein Repository bleibt dort. Beim Hosting läuft nur die Control Plane auf den Servern von bakers.build. Sie speichert Tickets, Übergaben und den Footprint jedes Laufs; Code und Laufprotokolle bleiben bei dir.'],
      ['Was sieht die KI?', 'Das Ticket und den Code, an dem sie arbeitet. Die Anfragen gehen von deinem Rechner direkt an den Anbieter deines Agenten, mit deinem eigenen Abo. Standardmäßig läuft der Agent in einer Sandbox und schreibt nur in seinen eigenen Arbeitsordner.'],
      ['Muss ich etwas installieren?', 'Nicht, wenn du nur Tickets schreibst und freigibst: Du arbeitest im Browser oder im Chat mit Claude. Wer die Backstraße einrichtet, installiert einmal die CLI.'],
      ['Wer merged?', 'Ein Mensch. Du gibst den Plan frei, bestätigst das Ergebnis, bestätigst das Urteil des Reviews und gibst den Merge frei.'],
      ['Brauche ich dafür Entwickler?', 'Einmal, für die Einrichtung: Ein Entwickler richtet die Backstraße und den Conductor ein. Danach schreibst du Tickets und gibst frei, ohne auf freie Kapazität zu warten. Für komplexere Änderungen holst du dir einen Entwickler dazu.'],
      ['Welche Agenten kann ich nutzen?', 'Claude Code, Codex, Grok, Kimi, OpenCode und Pi, mit deinem eigenen Abo. Pro Projekt austauschbar.'],
      ['Was ist anders als ein Coding-Agent im Editor?', 'Ein Editor-Agent hilft einer Person in einer Sitzung. bakers.build betreibt den ganzen Ablauf fürs Team: Tickets sammeln sich zentral, jeder angemeldete Rechner kann sie übernehmen, jeder Lauf wird protokolliert, und der Ablauf selbst ist versioniert.'],
      ['Passt das zu unserem Stack?', 'Für Drupal und für Dokumentation gibt es fertige Skills. Für einen anderen Stack schreibt ein Entwickler einmal einen eigenen Skill. Bis dahin laufen Doku-Tickets und alles ohne Build-Checks schon.'],
      ['Was braucht ein Rechner?', 'Dein Repository auf GitHub oder GitLab für Merge Requests und einen Worker-Rechner mit Git, Node.js ab 20.19 und einem angemeldeten Coding-Agenten.', 'Alle Prüfungen stehen im Rechner-Leitfaden.', '/provision/machine'],
      ['Was kostet es?', 'Vorerst nichts. Der Kern ist Open Source, und Selbst hosten und gehostet sind beide kostenlos. Das gilt auch für jedes mitgelieferte Addon, die Agenten-Addons eingeschlossen.'],
    ],
  },
  closing: {
    title: 'Probier es an einem echten Ticket.',
    text: 'Melde dich an, leg deinen Workspace an und lade dein Team ein.',
  },
  footer: ['Open Source', 'Docs', 'GitHub'],
}

export const COPY = { en, de }
