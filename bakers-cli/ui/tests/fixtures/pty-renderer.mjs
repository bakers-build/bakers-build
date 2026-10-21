export default function ptyRenderer() {
  return {
    id: 'bakers-pty-renderer',
    requiredModules: [],
    renderers: [
      {
        id: 'tui',
        interactive: true,
        async run() {
          process.stdout.write('BB_UI_RENDERER_MARKER\n');
        },
      },
    ],
  };
}
