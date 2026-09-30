// 在一次性的验收容器内运行；不读取或修改服务器上的生产数据库。
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');

async function request(path, options = {}) {
  return fetch(`http://127.0.0.1:3000/api/${path}`, {
    ...options,
    signal: AbortSignal.timeout(5000),
  });
}

async function main() {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      if ((await request('login-options')).status === 200) {
        ready = true;
        break;
      }
    } catch {}
    await delay(500);
  }
  assert.ok(ready, '后端在约定时间内没有就绪');
  assert.equal((await request('web-client/config')).status, 401);
  assert.equal(
    (await request('web-client/config', {
      headers: { Authorization: 'Bearer invalid-smoke-token' },
    })).status,
    401,
  );
  const login = await request('login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: process.env.ADMIN_USERNAME,
      password: process.env.ADMIN_PASSWORD,
      type: 'account',
      deviceInfo: { os: 'linux', type: 'browser', name: '验收容器' },
    }),
  });
  assert.equal(login.status, 200, '临时管理员登录失败');
  const session = await login.json();
  assert.equal(typeof session.access_token, 'string');
  assert.ok(session.access_token.length > 32);
  const headers = { Authorization: `Bearer ${session.access_token}` };
  const config = await request('web-client/config', { headers });
  assert.equal(config.status, 200);
  assert.match(config.headers.get('cache-control') || '', /no-store/);
  assert.deepEqual(await config.json(), {
    enabled: true,
    idServerUrl: process.env.WEB_CLIENT_ID_SERVER_URL,
    relayServerUrl: process.env.WEB_CLIENT_RELAY_SERVER_URL,
    serverPublicKey: process.env.WEB_CLIENT_SERVER_PUBLIC_KEY,
  });
  const logout = await request('logout', {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.equal(logout.status, 200);
  assert.equal((await request('web-client/config', { headers })).status, 401);
  console.log(JSON.stringify({
    checks: ['容器就绪', '匿名拒绝', '无效令牌拒绝', '真实登录', '公开配置与禁止缓存', '退出后令牌失效'],
    passed: true,
    platform: `${process.platform}/${process.arch}`,
  }));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
