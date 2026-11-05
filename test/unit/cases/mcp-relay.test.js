/*
 * Unit tests for the local MCP relay, with a stand-in for the Maximo forwarder.
 *
 *   npm run test:unit
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import { Readable } from 'node:stream';
import { startRelay } from '../../../src/mcp-relay.js';

function send(url, { method = 'POST', headers = {}, body } = {}) {
    return new Promise((resolve, reject) => {
        const req = http.request(url, { method, headers }, (res) => {
            let data = '';
            res.setEncoding('utf8');
            res.on('data', (chunk) => (data += chunk));
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
        });
        req.on('error', reject);
        req.end(body);
    });
}

async function withRelay(forward, test) {
    const relay = await startRelay(forward);
    try {
        await test(relay);
    } finally {
        await relay.close();
    }
}

describe('startRelay', () => {
    it('listens on 127.0.0.1 behind a random path', async () => {
        const forward = async () => ({ status: 200 });
        const first = await startRelay(forward);
        const second = await startRelay(forward);
        try {
            assert.match(first.url, /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{48}$/);
            assert.notStrictEqual(new URL(first.url).pathname, new URL(second.url).pathname);
        } finally {
            await first.close();
            await second.close();
        }
    });

    it('reuses a saved address, so clients holding its URL keep working after a restart', async () => {
        const forward = async () => ({ status: 200 });
        const first = await startRelay(forward);
        const address = { port: first.port, path: first.path };
        await first.close();

        const second = await startRelay(forward, {}, address);
        try {
            assert.strictEqual(second.url, first.url);
            assert.strictEqual((await send(second.url, { body: '{}' })).status, 200);
        } finally {
            await second.close();
        }
    });

    it('chooses a new address when the saved port is taken', async () => {
        const forward = async () => ({ status: 200 });
        const holder = await startRelay(forward);
        const address = { port: holder.port, path: `/${'a'.repeat(48)}` };
        const relay = await startRelay(forward, {}, address);
        try {
            assert.notStrictEqual(relay.port, holder.port);
            assert.notStrictEqual(relay.path, address.path);
            assert.strictEqual((await send(relay.url, { body: '{}' })).status, 200);
        } finally {
            await relay.close();
            await holder.close();
        }
    });

    it('ignores a saved address whose path is not a relay path', async () => {
        const relay = await startRelay(async () => ({ status: 200 }), {}, { port: 1, path: '/guessable' });
        try {
            assert.match(relay.url, /^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{48}$/);
            assert.notStrictEqual(relay.port, 1);
        } finally {
            await relay.close();
        }
    });

    it('forwards the request without client credentials and streams the response back', async () => {
        let received;
        const forward = async (request) => {
            received = request;
            return {
                status: 200,
                headers: { 'content-type': 'text/event-stream', 'mcp-session-id': 'session-1', 'set-cookie': 'JSESSIONID=abc' },
                body: Readable.from(['data: one\n\n', 'data: two\n\n'])
            };
        };

        await withRelay(forward, async (relay) => {
            const res = await send(relay.url, {
                headers: {
                    'content-type': 'application/json',
                    'mcp-protocol-version': '2025-06-18',
                    apikey: 'client-key',
                    maxauth: 'client-maxauth',
                    authorization: 'Bearer client-token',
                    cookie: 'client=cookie'
                },
                body: '{"jsonrpc":"2.0"}'
            });

            assert.strictEqual(res.status, 200);
            assert.strictEqual(res.body, 'data: one\n\ndata: two\n\n');
            assert.strictEqual(res.headers['mcp-session-id'], 'session-1');
            assert.strictEqual(res.headers['set-cookie'], undefined);

            assert.strictEqual(received.method, 'POST');
            assert.strictEqual(received.body.toString(), '{"jsonrpc":"2.0"}');
            assert.strictEqual(received.headers['content-type'], 'application/json');
            assert.strictEqual(received.headers['mcp-protocol-version'], '2025-06-18');
            for (const name of ['apikey', 'maxauth', 'authorization', 'cookie', 'host', 'content-length']) {
                assert.strictEqual(received.headers[name], undefined, name);
            }
        });
    });

    it('returns a buffered response and the status it was given', async () => {
        await withRelay(
            async () => ({ status: 202, headers: {}, body: Buffer.from('') }),
            async (relay) => {
                assert.strictEqual((await send(relay.url, { body: '{}' })).status, 202);
            }
        );
    });

    it('answers GET and DELETE with 405 without forwarding them', async () => {
        let forwarded = false;
        await withRelay(
            async () => {
                forwarded = true;
                return { status: 200 };
            },
            async (relay) => {
                for (const method of ['GET', 'DELETE']) {
                    const res = await send(relay.url, { method });
                    assert.strictEqual(res.status, 405, method);
                    assert.strictEqual(res.headers.allow, 'POST');
                }
                assert.strictEqual(forwarded, false);
            }
        );
    });

    it('refuses other paths and foreign Host headers without forwarding them', async () => {
        let forwarded = false;
        await withRelay(
            async () => {
                forwarded = true;
                return { status: 200 };
            },
            async (relay) => {
                const origin = new URL(relay.url).origin;
                assert.strictEqual((await send(`${origin}/maximo/api/script/naviam.mcp`, { body: '{}' })).status, 404);
                assert.strictEqual((await send(`${origin}/.well-known/oauth-protected-resource`, { method: 'GET' })).status, 404);
                assert.strictEqual((await send(relay.url, { headers: { host: 'attacker.example' }, body: '{}' })).status, 404);
                assert.strictEqual(forwarded, false);
            }
        );
    });

    it('answers a Maximo 401 with 502 and no challenge, so the client does not start an OAuth sign-in', async () => {
        await withRelay(
            async () => ({ status: 401, headers: { 'www-authenticate': 'Bearer realm="maximo"' }, body: Readable.from(['{"Error":{}}']) }),
            async (relay) => {
                const res = await send(relay.url, { body: '{}' });
                assert.strictEqual(res.status, 502);
                assert.strictEqual(res.headers['www-authenticate'], undefined);
                assert.match(res.body, /rejected the credentials/);
            }
        );
    });

    it('answers a redirect from Maximo, such as to its login page, with 502', async () => {
        await withRelay(
            async () => ({ status: 302, headers: { location: 'https://maximo.example.com/maximo/webclient/login/login.jsp' }, body: Readable.from(['']) }),
            async (relay) => {
                const res = await send(relay.url, { body: '{}' });
                assert.strictEqual(res.status, 502);
                assert.strictEqual(res.headers.location, undefined);
                assert.match(res.body, /redirected the request \(302\)/);
            }
        );
    });

    it('drops WWW-Authenticate from other responses', async () => {
        await withRelay(
            async () => ({ status: 403, headers: { 'www-authenticate': 'Bearer error="insufficient_scope"' }, body: 'denied' }),
            async (relay) => {
                const res = await send(relay.url, { body: '{}' });
                assert.strictEqual(res.status, 403);
                assert.strictEqual(res.headers['www-authenticate'], undefined);
                assert.strictEqual(res.body, 'denied');
            }
        );
    });

    it('answers 502 with the reason when forwarding fails', async () => {
        await withRelay(
            async () => {
                throw new Error('no password or API key is available for the environment');
            },
            async (relay) => {
                const res = await send(relay.url, { body: '{}' });
                assert.strictEqual(res.status, 502);
                assert.match(res.body, /no password or API key/);
            }
        );
    });
});
