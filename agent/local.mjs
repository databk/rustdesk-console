import { randomBytes } from 'node:crypto';
import { createAgent } from './app.mjs';
import { DockerDriver } from './docker.mjs';

// In-process adapter: no listener, subprocess or extra deployment.
export function createLocalManagement({
  nodeId = 'local',
  serverToken,
  directory,
  socket = '/var/run/docker.sock',
  containers = { hbbs: 'hbbs', hbbr: 'hbbr' },
  urls,
}) {
  return createAgent({
    nodeId,
    token: randomBytes(32).toString('hex'),
    serverToken,
    directory,
    docker: new DockerDriver({ nodeId, socket, containers }),
    urls,
  });
}
