import { describe, expect, it } from 'vitest';
import { parseSocketListeners } from '../src/discovery.js';

// A real `ss -ltnp` capture: a Storybook node listener, a Vite one, and a
// docker-proxy row (DDEV's published container port) whose owning process is
// NOT the worktree's — the socket table reports it while the /proc match
// rejects it (this addon no longer resolves DDEV container identity itself;
// `@bakers-build/addon-ddev` does — see `discoverHostPorts`'s own tests in
// `raw-discovery.test.ts` for the worktree-match behavior).
const SS_CAPTURE = `State  Recv-Q Send-Q Local Address:Port  Peer Address:Port Process
LISTEN 0      511    127.0.0.1:38581     0.0.0.0:*          users:(("node",pid=12345,fd=23))
LISTEN 0      511    127.0.0.1:5173      0.0.0.0:*          users:(("node",pid=12346,fd=24))
LISTEN 0      4096   0.0.0.0:33000       0.0.0.0:*          users:(("docker-proxy",pid=999,fd=4))
LISTEN 0      128    127.0.0.1:8025      0.0.0.0:*          users:(("python3",pid=12399,fd=7))`;

describe('parseSocketListeners', () => {
  it('reads each listener as port + owning command + pid', () => {
    const listeners = parseSocketListeners(SS_CAPTURE);
    expect(listeners).toContainEqual({
      address: '127.0.0.1',
      port: 38581,
      command: 'node',
      pid: 12345,
    });
    expect(listeners).toContainEqual({
      address: '0.0.0.0',
      port: 33000,
      command: 'docker-proxy',
      pid: 999,
    });
    expect(listeners).toHaveLength(4);
  });
});
