// @ts-nocheck
const crypto = require('crypto');
const http = require('http');

// Connection-scoped headers that must not be forwarded between the two connections.
const HOP_BY_HOP = ['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'te', 'trailer', 'host', 'content-length'];

// Credentials are added by the forwarder, so any the client sends are dropped.
const CREDENTIAL_HEADERS = ['apikey', 'maxauth', 'authorization', 'cookie'];

const ALLOWED_METHODS = ['POST'];

const RELAY_PATH = /^\/[0-9a-f]{48}$/;

// The relay authenticates, so Maximo's challenges are not passed on: a 401 or a WWW-Authenticate
// header makes VS Code start its own OAuth sign-in against the relay. See docs/modules/mcp-server.md.
const AUTH_CHALLENGE_HEADERS = ['www-authenticate'];

function copyHeaders(source, excluded) {
    const headers = {};
    for (const [name, value] of Object.entries(source || {})) {
        if (value !== undefined && value !== null && !excluded.includes(name.toLowerCase())) {
            headers[name] = value;
        }
    }
    return headers;
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
    });
}

/**
 * Starts an HTTP server on 127.0.0.1 that hands MCP requests to forward(), which sends them to
 * Maximo with its own credentials. Only requests for the relay's random path, addressed to its own
 * host and port, are accepted. GET and DELETE are answered with 405, as the server offers no event
 * stream and no session termination, and a 401 or redirect from Maximo with 502. A previous address is reused when given, so clients holding it keep
 * working; a new random one is chosen when there is none or its port is taken. See
 * docs/modules/mcp-server.md.
 *
 * @param {(request: {method: string, headers: Object, body: Buffer, signal: AbortSignal}) => Promise<{status: number, headers?: Object, body?: NodeJS.ReadableStream|Buffer|string}>} forward
 * @param {{warn?: (message: string) => void, debug?: (message: string) => void}} [logger]
 * @param {{port?: number, path?: string}} [address] the address to reuse.
 * @returns {Promise<{url: string, port: number, path: string, close: () => Promise<void>}>}
 */
function startRelay(forward, logger = {}, address = {}) {
    const reuse = Number.isInteger(address.port) && address.port > 0 && address.port < 65536 && RELAY_PATH.test(address.path || '');
    let path = reuse ? address.path : `/${crypto.randomBytes(24).toString('hex')}`;
    const debug = (message) => logger.debug && logger.debug(message);
    let expectedHost;

    const server = http.createServer(async (req, res) => {
        const describe = `${req.method} from "${req.headers['user-agent'] || 'unknown'}"`;
        const requestPath = new URL(req.url, 'http://relay').pathname;

        if (req.headers.host !== expectedHost || requestPath !== path) {
            debug(`MCP relay refused ${describe}: unknown host or path.`);
            res.writeHead(404).end();
            req.resume();
            return;
        }
        if (!ALLOWED_METHODS.includes(req.method)) {
            debug(`MCP relay answered ${describe} with 405.`);
            res.writeHead(405, { allow: ALLOWED_METHODS.join(', ') }).end();
            req.resume();
            return;
        }

        const abort = new AbortController();
        res.on('close', () => abort.abort());

        try {
            const body = await readBody(req);
            const response = await forward({ method: req.method, headers: copyHeaders(req.headers, [...HOP_BY_HOP, ...CREDENTIAL_HEADERS]), body, signal: abort.signal });
            debug(`MCP relay ${describe}: Maximo responded ${response.status}.`);

            if (response.status === 401 || (response.status >= 300 && response.status < 400)) {
                if (response.body && typeof response.body.resume === 'function') {
                    response.body.resume();
                }
                const message =
                    response.status === 401 ? 'Maximo rejected the credentials for the selected environment' : `Maximo redirected the request (${response.status}), so the session was not accepted`;
                if (logger.warn) {
                    logger.warn(`MCP relay ${describe} failed: ${message}.`);
                }
                res.writeHead(502, { 'content-type': 'text/plain' }).end(`Maximo MCP relay: ${message}.`);
                return;
            }

            res.writeHead(response.status, copyHeaders(response.headers, [...HOP_BY_HOP, ...AUTH_CHALLENGE_HEADERS, 'set-cookie']));
            if (response.body && typeof response.body.pipe === 'function') {
                response.body.on('error', (error) => res.destroy(error));
                response.body.pipe(res);
            } else {
                res.end(response.body);
            }
        } catch (error) {
            if (abort.signal.aborted) {
                return;
            }
            const message = error?.message ?? String(error);
            if (logger.warn) {
                logger.warn(`MCP relay ${describe} failed: ${message}`);
            }
            if (!res.headersSent) {
                res.writeHead(502, { 'content-type': 'text/plain' }).end(`Maximo MCP relay: ${message}`);
            } else {
                res.destroy(error);
            }
        }
    });

    const listen = (port) =>
        new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(port, '127.0.0.1', () => {
                server.off('error', reject);
                resolve(server.address().port);
            });
        });

    const start = async () => {
        let port;
        try {
            port = await listen(reuse ? address.port : 0);
        } catch (error) {
            if (!reuse || error.code !== 'EADDRINUSE') {
                throw error;
            }
            debug(`MCP relay port ${address.port} is in use; choosing a new address.`);
            path = `/${crypto.randomBytes(24).toString('hex')}`;
            port = await listen(0);
        }
        expectedHost = `127.0.0.1:${port}`;
        return {
            url: `http://${expectedHost}${path}`,
            port,
            path,
            close: () =>
                new Promise((done) => {
                    server.close(() => done());
                    server.closeAllConnections();
                })
        };
    };

    return start();
}

module.exports = { startRelay };
