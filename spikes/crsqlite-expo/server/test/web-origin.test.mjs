import assert from 'node:assert/strict';
import test from 'node:test';
import { request } from 'node:http';
import { launch } from './web-helpers.mjs';

function upgrade(port, extra = {}, identity = 'web-test-owner') {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: '/sync', headers: {
      Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13',
      'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
      'Sec-WebSocket-Protocol': Buffer.from('room=stash-backend').toString('base64').replace(/=+$/, ''),
      ...(identity ? { 'X-Auth-User': identity } : {}), ...extra,
    } });
    req.once('upgrade', (response, socket) => { socket.destroy(); resolve(response.statusCode); });
    req.once('response', response => { response.resume(); resolve(response.statusCode); });
    req.once('error', reject);
    req.end();
  });
}

test('browser WS upgrades require exact Origin while native no-Origin and proxy schemes remain compatible', async t => {
  const { base, port, api } = await launch(t);
  const https = base.replace('http:', 'https:');
  for (const [headers, expected] of [
    [{}, 101],
    [{ Origin: base }, 101],
    [{ Origin: https, 'X-Forwarded-Proto': 'https' }, 101],
    [{ 'Sec-Fetch-Site': 'same-origin' }, 101],
    [{ Origin: base.replace('127.0.0.1', 'localhost') }, 401],
    [{ Origin: 'https://attacker.invalid' }, 401],
    [{ Origin: 'null' }, 401],
    [{ Origin: 'not an origin' }, 401],
    [{ Origin: `${base}/path` }, 401],
    [{ Origin: `${base}/path/..` }, 401],
    [{ Origin: `${base}?` }, 401],
    [{ Origin: `${base}/` }, 401],
    [{ Origin: base.replace('http://', 'http://user:secret@') }, 401],
    [{ Origin: https }, 401],
    [{ Origin: base, 'X-Forwarded-Proto': 'https' }, 401],
    [{ Origin: base, 'X-Forwarded-Proto': 'http,https' }, 401],
    [{ 'Sec-Fetch-Site': 'cross-site' }, 401],
    [{ Origin: base, 'Sec-Fetch-Site': 'cross-site' }, 401],
  ]) assert.equal(await upgrade(port, headers), expected, JSON.stringify(headers));
  assert.equal(await upgrade(port, { Origin: base }, null), 401);
  assert.equal(await upgrade(port, {}, 'foreign-owner'), 401);
  assert.equal((await api('/items')).status, 200);
});
