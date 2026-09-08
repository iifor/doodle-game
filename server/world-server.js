import { createServer } from 'node:http';
import { readFile, stat, mkdir, open, unlink } from 'node:fs/promises';
import { resolve, extname, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { loadEnvFile } from 'node:process';
import { WorldStore, deepSeekGenerator } from './world-store.js';
import { requireWorld } from '../src/games/shooter/exploration/schema.js';

export function createWorldServer({ store, dist = resolve('dist') }) {
  const sessions = new Set();
  return createServer(async (req, res) => {
    const reply = (status, data) => {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify(data));
    };
    try {
      const expected = `127.0.0.1:${res.socket.localPort}`;
      requireWorld(
        req.headers.host === expected || req.headers.host === `localhost:${res.socket.localPort}`,
        '请求主机不匹配',
      );
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (!url.pathname.startsWith('/api/worlds')) {
        requireWorld(req.method === 'GET' || req.method === 'HEAD', '不支持的请求');
        const requested = decodeURIComponent(url.pathname);
        const path = resolve(dist, `.${requested === '/' ? '/index.html' : requested}`);
        const within = relative(dist, path);
        requireWorld(
          within && !within.startsWith('..') && !isAbsolute(within) && (await stat(path)).isFile(),
          '页面不存在；请先运行 npm run build',
        );
        const mime = {
          '.html': 'text/html',
          '.js': 'text/javascript',
          '.css': 'text/css',
          '.woff2': 'font/woff2',
          '.png': 'image/png',
          '.svg': 'image/svg+xml',
        };
        res.writeHead(200, {
          'Content-Type': mime[extname(path)] ?? 'application/octet-stream',
          'X-Content-Type-Options': 'nosniff',
        });
        res.end(req.method === 'HEAD' ? undefined : await readFile(path));
        return;
      }
      requireWorld(
        !req.headers.origin || req.headers.origin === `http://${req.headers.host}`,
        '只允许同源房主页面访问',
      );
      requireWorld(
        !req.headers['sec-fetch-site'] || ['same-origin', 'none'].includes(req.headers['sec-fetch-site']),
        '拒绝跨站请求',
      );
      if (url.pathname === '/api/worlds/session' && req.method === 'POST') {
        requireWorld(req.headers['x-world-request'] === '1', '缺少房主请求标记');
        const token = randomUUID();
        sessions.add(token);
        reply(200, { token });
        return;
      }
      const owner = req.headers['x-world-session'];
      requireWorld(typeof owner === 'string' && sessions.has(owner), '需要房主本机服务会话');
      let body = {};
      if (req.method !== 'GET') {
        const buffers = [];
        let bytes = 0;
        for await (const part of req) {
          bytes += part.length;
          requireWorld(bytes <= 65536, '请求过大');
          buffers.push(part);
        }
        body = bytes ? JSON.parse(Buffer.concat(buffers).toString('utf8')) : {};
      }
      const parts = url.pathname.split('/').filter(Boolean).slice(2),
        [id, operation, coord] = parts;
      if (!id) {
        if (req.method === 'GET') reply(200, await store.list());
        else {
          requireWorld(req.method === 'POST', '不支持的请求');
          reply(201, await store.create(body.name, body.schemaVersion ?? 1, body.aiGenerated ?? false));
        }
      } else if (operation === 'lease') {
        if (req.method === 'DELETE') {
          store.release(id, owner);
          reply(200, {});
        } else {
          requireWorld(req.method === 'POST', '不支持的请求');
          let info = await store.info(id);
          store.claim(id, owner);
          if (!body.renew) info = await store.prepareEncounters(id, owner);
          reply(
            200,
            body.renew
              ? {}
              : { info, progress: await store.progress(id), manifest: await store.manifest(id) },
          );
        }
      } else {
        store.requireLease(id, owner);
        if (operation === 'progress' && req.method === 'POST')
          reply(200, await store.update(id, owner, body));
        else if (operation === 'progress' && req.method === 'GET') reply(200, await store.progress(id));
        else if (operation === 'building' && req.method === 'POST')
          reply(200, await store.interior(id, coord, owner, body.priority === true));
        else if (operation === 'chunk') {
          requireWorld(typeof coord === 'string', '缺少区块坐标');
          const pair = coord.split(',').map(Number);
          requireWorld(pair.length === 2, '区块坐标无效');
          requireWorld(req.method === 'GET' || req.method === 'POST', '不支持的请求');
          if (req.method === 'POST' && (await store.info(id)).schemaVersion === 2)
            requireWorld(
              pair.every((n) => Number.isInteger(n) && n >= 0 && n < 2),
              '建筑请通过入口加载',
            );
          const block =
            req.method === 'POST' ? await store.ensure(id, ...pair, owner) : await store.chunk(id, ...pair);
          reply(block ? 200 : 404, block ?? { error: '区域尚未生成' });
        } else reply(404, { error: '接口不存在' });
      }
    } catch (error) {
      reply(400, { error: error.message });
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    loadEnvFile('.env.local');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const directory = resolve(process.env.WORLD_DATA_DIR || 'world-data');
  await mkdir(directory, { recursive: true });
  const lockPath = join(directory, '.service.lock');
  try {
    const pid = Number(await readFile(lockPath, 'utf8'));
    let live = true;
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === 'ESRCH') live = false;
      else throw error;
    }
    requireWorld(!live, '该存档目录已有服务运行');
    await unlink(lockPath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const lock = await open(lockPath, 'wx', 0o600);
  await lock.writeFile(String(process.pid));
  await lock.close();
  const port = Number(process.env.WORLD_PORT || 8787);
  requireWorld(Number.isInteger(port) && port > 0 && port <= 65535, 'WORLD_PORT 无效');
  const server = createWorldServer({ store: new WorldStore(directory, deepSeekGenerator()) });
  server.listen(port, '127.0.0.1', () =>
    console.log(`开放世界：http://127.0.0.1:${port} · 存档：${directory}`),
  );
  server.on('error', async (error) => {
    await unlink(lockPath);
    console.error(error);
    process.exitCode = 1;
  });
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, async () => {
      await unlink(lockPath);
      server.close();
    });
}
