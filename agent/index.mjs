import { createAgent } from './app.mjs';
import { DockerDriver } from './docker.mjs';

const nodeId = process.env.NODE_ID || 'local';
const agent = createAgent({
  nodeId,
  token: process.env.NODE_AGENT_TOKEN,
  serverToken: process.env.SERVER_MANAGEMENT_TOKEN,
  directory: process.env.MANAGEMENT_DIR || '/data/management',
  docker: new DockerDriver({
    nodeId,
    socket: process.env.DOCKER_SOCKET || '/var/run/docker.sock',
    containers: {
      hbbs: process.env.HBBS_CONTAINER || 'hbbs',
      hbbr: process.env.HBBR_CONTAINER || 'hbbr',
    },
  }),
  urls: {
    hbbs: process.env.HBBS_MANAGEMENT_URL || 'http://hbbs:21120',
    hbbr: process.env.HBBR_MANAGEMENT_URL || 'http://hbbr:21121',
  },
});
const server = agent.server();
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.listen(Number(process.env.PORT || 3001), '0.0.0.0');
// Persisted desired bans are reconciled after a service or agent restart.
const timer = setInterval(() => {
  void agent
    .syncPolicy()
    .catch(() => console.error('Policy synchronization failed'));
}, 10000);
timer.unref();
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, () => {
    clearInterval(timer);
    server.close();
  });
