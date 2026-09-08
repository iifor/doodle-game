import { PeerServer } from 'peer';
const port = Number(process.env.PEER_PORT ?? 9000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PEER_PORT 必须是有效端口');
const server = PeerServer({ host: '127.0.0.1', port, path: '/peerjs', allow_discovery: false });
server.on('error', (error) => {
  console.error(error);
  process.exitCode = 1;
});
console.log(`本地联机信令：http://127.0.0.1:${port}/peerjs`);
