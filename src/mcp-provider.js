// @ts-nocheck
import * as vscode from 'vscode';
import crypto from 'crypto';
import Logger from './logger';
import {
    hasStoredCredentials,
    getMcpScriptName,
    getScriptCheckKey,
    getConnectionKey,
    describeScriptStatus,
    isSessionRejected,
    createSessionRenewer
} from './mcp-core';
import { findSelectedEnvironment, resolveEnvironment } from './environment';
import { startRelay } from './mcp-relay';
import { isLoginRejection } from './core/maximo/errors.js';

const mcpServerDefinitionsChanged = new vscode.EventEmitter();

// Script lookup results keyed by getScriptCheckKey(), kept until the environment or settings change.
const scriptStatusCache = new Map();

// The check run before the definition is offered, as {key, promise}; the refresh generation, so a
// check started before a refresh does not cache its result; and whether the next check may prompt.
let pendingCheck = null;
let checkGeneration = 0;
let interactiveCheck = false;

// Auto-start state: whether the next definition served should be started, which request is current,
// when the last attempt was made, and how many times VS Code has resolved a server.
let autoStartRequested = true;
let autoStartGeneration = 0;
let lastAutoStartAt = 0;
let resolveCount = 0;

// Delays before each attempt, since VS Code only knows the server once it has processed the definition.
const AUTO_START_DELAYS = [1000, 2000, 4000];
const AUTO_START_QUIET_MS = 15000;

// The local relay, started once as Promise<{url, close}>, and the Maximo connection it forwards
// through, as {key, client: Promise<MaximoClient>}. See getRelayUrl() and getClient().
let relay = null;
let connection = null;

// The relay's port and path, kept in SecretStorage per workspace so its URL survives reloads. See
// getRelayUrl().
const RELAY_ADDRESS_KEY = 'mcpRelayAddress';
let secrets = null;

// The connection key whose credentials Maximo rejected. Nothing reconnects with them until they
// change or the user refreshes, so a wrong password is not retried into a lockout.
let rejectedKey = null;

// Retries of a check that failed, such as when Maximo is unreachable at startup, about 18 minutes in
// all; after the last one the refresh command checks again.
const CHECK_RETRY_DELAYS = [30000, 60000, 120000, 300000, 300000, 300000];
let checkRetries = 0;
let retryTimer = null;

// Shares one login between parallel requests rejected for the same session.
const sessionRenewer = createSessionRenewer();

// Notifications arrive in bursts, such as several file events for one save, so VS Code is asked for
// the definition once they settle.
const NOTIFY_SETTLE_MS = 250;
let notifyTimer = null;

/**
 * Forgets every script check and asks VS Code for the server definition again. Called whenever the
 * resolved environment could have changed, and by the refresh command, which passes interactive so
 * the check may prompt for a password and retries credentials Maximo rejected. The Maximo
 * connection is kept, and replaced by getClient() only when the environment really changed.
 *
 * @param {{interactive?: boolean}} [options]
 */
export function notifyMcpEnvironmentChanged(options = {}) {
    scriptStatusCache.clear();
    pendingCheck = null;
    checkGeneration++;
    interactiveCheck = interactiveCheck || Boolean(options.interactive);
    if (options.interactive) {
        rejectedKey = null;
    }
    autoStartRequested = true;
    clearTimeout(retryTimer);
    retryTimer = null;
    checkRetries = 0;

    clearTimeout(notifyTimer);
    notifyTimer = setTimeout(() => {
        notifyTimer = null;
        mcpServerDefinitionsChanged.fire();
    }, NOTIFY_SETTLE_MS);
}

/**
 * Resolves the selected Maximo environment as the commands do, from .devtools-config.json and then
 * the naviam.maximo settings, read through the extension's getLocalConfig() so the file is loaded,
 * encrypted and decrypted in one place.
 */
async function getSelectedEnvironment(getLocalConfig) {
    const localConfig = await getLocalConfig();
    return resolveEnvironment(findSelectedEnvironment(await localConfig.config), vscode.workspace.getConfiguration('naviam'));
}

/**
 * Registers the Model Context Protocol (MCP) server definition provider.
 *
 * The definition points at a local relay that forwards to the MCP automation script through a
 * MaximoClient, so every MCP client is authenticated the same way as the extension's commands. The
 * server is only usable where the script is installed and active, which is checked for when VS
 * Code starts the server. See docs/modules/mcp-server.md.
 *
 * @param {vscode.ExtensionContext} context
 * @param {{ connect: (options: {interactive: boolean}) => Promise<Object>, getLocalConfig: () => Promise<{config?: Promise<Array|Object>}> }} options
 */
export function registerMcpProvider(context, options) {
    if (!vscode.lm || typeof vscode.lm.registerMcpServerDefinitionProvider !== 'function' || typeof vscode.McpHttpServerDefinition !== 'function') {
        Logger.debug('vscode.lm.registerMcpServerDefinitionProvider or McpHttpServerDefinition not supported in this VS Code version.');
        return;
    }

    context.subscriptions.push(mcpServerDefinitionsChanged, { dispose: () => shutdown() });
    secrets = context.secrets;
    relayAddressKey = getRelayAddressKey();

    const extensionVersion = context.extension?.packageJSON?.version || '1.0.0';
    const getEnvironment = () => getSelectedEnvironment(options.getLocalConfig);
    const getScriptName = () => getMcpScriptName(vscode.workspace.getConfiguration('naviam').get('mcp.script'));
    const forward = (request) => forwardToMaximo(request, getEnvironment, getScriptName, options.connect);

    const provider = {
        onDidChangeMcpServerDefinitions: mcpServerDefinitionsChanged.event,

        provideMcpServerDefinitions: async () => {
            Logger.debug(`[MCP provide] VS Code requested server definitions (autoStartRequested=${autoStartRequested}).`);
            try {
                const env = await getEnvironment();
                if (!env || !env.host) {
                    Logger.debug('No active Maximo environment found for MCP provider.');
                    return [];
                }

                const scriptName = getScriptName();
                const cachedStatus = scriptStatusCache.get(getScriptCheckKey(env, scriptName));
                if (!cachedStatus) {
                    checkBeforeProviding(env, scriptName, options.connect);
                    return [];
                }
                if (describeScriptStatus(cachedStatus, scriptName, environmentLabel(env))) {
                    Logger.debug(`Not providing the MCP server definition: ${scriptName.toUpperCase()} is not usable on ${environmentLabel(env)}.`);
                    return [];
                }

                const url = await getRelayUrl(forward);
                const label = `Maximo: ${environmentLabel(env)}`;
                const version = `${extensionVersion}:${environmentLabel(env)}:${scriptName}`;

                Logger.debug(`Providing MCP server definition "${label}" for ${scriptName} through the local relay.`);
                if (autoStartRequested) {
                    autoStartRequested = false;
                    autoStart(`${context.extension.id.toLowerCase()}/${label}`, env);
                }
                return [new vscode.McpHttpServerDefinition(label, vscode.Uri.parse(url), {}, version)];
            } catch (error) {
                Logger.error(`Error providing MCP server definitions: ${error?.message ?? error}`);
                return [];
            }
        },

        resolveMcpServerDefinition: async (server) => {
            resolveCount++;
            const quiet = Date.now() - lastAutoStartAt < AUTO_START_QUIET_MS;
            const started = Date.now();
            const elapsed = () => `${Date.now() - started}ms`;
            Logger.debug(`[MCP resolve #${resolveCount}] Resolving "${server.label}" (quiet=${quiet}).`);
            try {
                const env = await getEnvironment();
                if (!env || !env.host) {
                    Logger.error('Failed to resolve MCP server definition: selected environment is missing or has no host.');
                    return undefined;
                }

                server.uri = vscode.Uri.parse(await getRelayUrl(forward));
                Logger.debug(`[MCP resolve #${resolveCount}] Relay ready after ${elapsed()}; checking the script on ${environmentLabel(env)}.`);
                if (!(await isScriptUsable(env, getScriptName(), options.connect, quiet))) {
                    Logger.debug(`[MCP resolve #${resolveCount}] Returning undefined after ${elapsed()}: the script check failed.`);
                    return undefined;
                }
                Logger.debug(`[MCP resolve #${resolveCount}] Resolved after ${elapsed()}.`);
                return server;
            } catch (error) {
                Logger.error(`Error resolving MCP server definition: ${error?.message ?? error}`);
                Logger.debug(`[MCP resolve #${resolveCount}] Returning undefined after ${elapsed()}: ${error?.stack ?? error}`);
                return undefined;
            }
        }
    };

    context.subscriptions.push(vscode.lm.registerMcpServerDefinitionProvider('maximo-script-deploy.mcp', provider));
    Logger.info('Registered Maximo MCP server definition provider (maximo-script-deploy.mcp).');
}

/**
 * Checks the script in the background and asks VS Code for the definition again once it is usable.
 * Without stored credentials the check would prompt for a password, so it waits for the refresh
 * command. A check that fails without a definite answer, such as when Maximo is unreachable, is
 * retried with a growing delay; rejected credentials are not.
 */
function checkBeforeProviding(env, scriptName, connect) {
    const key = getScriptCheckKey(env, scriptName);
    if (pendingCheck && pendingCheck.key === key) {
        return;
    }

    const interactive = interactiveCheck;
    if (!interactive && !canConnectQuietly(env)) {
        Logger.info(
            `Not offering the Maximo MCP server for ${environmentLabel(env)}: it has no stored password or API key. Run "Refresh Maximo MCP Server" to sign in and check ${scriptName.toUpperCase()}.`
        );
        return;
    }
    interactiveCheck = false;

    const entry = { key };
    const generation = checkGeneration;
    entry.promise = isScriptUsable(env, scriptName, connect, !interactive, checkRetries > 0)
        .then((usable) => {
            if (usable && pendingCheck === entry) {
                checkRetries = 0;
                mcpServerDefinitionsChanged.fire();
            } else if (!usable && generation === checkGeneration && !scriptStatusCache.has(key) && rejectedKey !== getConnectionKey(env)) {
                scheduleCheckRetry(env);
            }
        })
        .finally(() => {
            if (pendingCheck === entry) {
                pendingCheck = null;
            }
        });
    pendingCheck = entry;
}

function scheduleCheckRetry(env) {
    if (retryTimer) {
        return;
    }
    if (checkRetries >= CHECK_RETRY_DELAYS.length) {
        Logger.warn(`Stopped checking the Maximo MCP server for ${environmentLabel(env)}. Run "Refresh Maximo MCP Server" to check again.`);
        return;
    }
    const delay = CHECK_RETRY_DELAYS[checkRetries];
    checkRetries++;
    Logger.debug(`[MCP script check] Checking ${environmentLabel(env)} again in ${delay / 1000}s.`);
    const generation = checkGeneration;
    retryTimer = setTimeout(() => {
        retryTimer = null;
        if (generation === checkGeneration) {
            mcpServerDefinitionsChanged.fire();
        }
    }, delay);
}

/**
 * Starts the server once VS Code has the definition, when naviam.mcp.autoStart is on and the
 * environment has stored credentials, so no prompt appears unprompted. There is no public API for
 * this, so it uses the internal workbench.mcp.startServer command, keyed by VS Code's server id.
 * See docs/modules/mcp-server.md.
 */
async function autoStart(serverId, env) {
    if (!vscode.workspace.getConfiguration('naviam').get('mcp.autoStart')) {
        Logger.debug('[MCP autoStart] Skipped: naviam.mcp.autoStart is off.');
        return;
    }
    if (!canConnectQuietly(env)) {
        Logger.debug(`Not starting the MCP server automatically: ${environmentLabel(env)} has no stored password or API key.`);
        return;
    }

    const generation = ++autoStartGeneration;
    for (const delay of AUTO_START_DELAYS) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        if (generation !== autoStartGeneration) {
            Logger.debug(`[MCP autoStart] Generation ${generation} superseded by ${autoStartGeneration}; stopping.`);
            return;
        }

        const resolved = resolveCount;
        lastAutoStartAt = Date.now();
        try {
            Logger.debug(`Starting MCP server ${serverId}.`);
            const result = await vscode.commands.executeCommand('workbench.mcp.startServer', serverId);
            Logger.debug(`[MCP autoStart] workbench.mcp.startServer returned after ${Date.now() - lastAutoStartAt}ms: ${JSON.stringify(result) ?? 'undefined'}.`);
        } catch (error) {
            Logger.debug(`Could not start the MCP server automatically: ${error?.message ?? error}`);
            return;
        }
        if (resolveCount !== resolved) {
            Logger.debug(`[MCP autoStart] VS Code resolved the server (${resolved} -> ${resolveCount}); done.`);
            return;
        }
        Logger.debug(`[MCP autoStart] VS Code has not resolved ${serverId} yet; retrying.`);
    }
}

/**
 * Returns the local relay's URL, starting the relay on first use. It lives until the extension
 * deactivates; the environment it reaches follows the selection through getClient(). The address
 * is saved per workspace and reused, because Agent Host sessions keep the URL they were given and
 * are not told when it changes, and a workspace's cached definition must not reach the relay of a
 * window open on another workspace.
 */
async function getRelayUrl(forward) {
    if (!relay) {
        const started = (async () => {
            const saved = await readRelayAddress();
            const running = await startRelay(forward, { warn: (message) => Logger.warn(message), debug: (message) => Logger.debug(message) }, saved);
            if (secrets && relayAddressKey && (saved?.port !== running.port || saved?.path !== running.path)) {
                await secrets.store(relayAddressKey, JSON.stringify({ port: running.port, path: running.path }));
            }
            return running;
        })();
        relay = started;
        started.then(
            () => Logger.info('Started the local Maximo MCP relay.'),
            (error) => {
                Logger.error(`Could not start the local Maximo MCP relay: ${error?.message ?? error}`);
                if (relay === started) {
                    relay = null;
                }
            }
        );
    }
    return (await relay).url;
}

// The SecretStorage key for this workspace's relay address, or null without a workspace.
let relayAddressKey = null;

function getRelayAddressKey() {
    const workspace = vscode.workspace.workspaceFile ?? vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!workspace) {
        return null;
    }
    return `${RELAY_ADDRESS_KEY}:${crypto.createHash('sha256').update(workspace.toString()).digest('hex')}`;
}

async function readRelayAddress() {
    try {
        const value = secrets && relayAddressKey && (await secrets.get(relayAddressKey));
        return value ? JSON.parse(value) : undefined;
    } catch (error) {
        Logger.debug(`Ignoring the saved MCP relay address: ${error?.message ?? error}`);
        return undefined;
    }
}

/**
 * Sends one relayed MCP request to the script through the shared MaximoClient. A password session
 * that Maximo rejects, with a 401 or a redirect to its login page, is reconnected once and the
 * request repeated; a rejection that remains is answered by the relay. Relayed requests never
 * prompt: a missing password is reported, and the user signs in through the refresh command.
 */
async function forwardToMaximo(request, getEnvironment, getScriptName, connect) {
    const env = await getEnvironment();
    if (!env || !env.host) {
        throw new Error('no Maximo environment is selected');
    }

    const key = getConnectionKey(env);
    const client = await getClient(env, connect, false);
    const session = sessionRenewer.session(client);
    let response = await sendToScript(client, getScriptName(), request);
    if (isSessionRejected(response.status) && !client.config.apiKey) {
        response.body.resume();
        try {
            await sessionRenewer.renew(client, session, () => {
                Logger.debug(`The Maximo session for the MCP relay was rejected; reconnecting to ${environmentLabel(env)}.`);
                return client.connect();
            });
        } catch (error) {
            if (isLoginRejection(error)) {
                rejectCredentials(key, env);
            }
            throw error;
        }
        response = await sendToScript(client, getScriptName(), request);
    }
    return response;
}

/**
 * Stops the relay from logging in with credentials Maximo rejected, until they change or the user
 * refreshes.
 */
function rejectCredentials(key, env) {
    rejectedKey = key;
    if (connection && connection.key === key) {
        closeConnection();
    }
    Logger.warn(
        `Maximo rejected the credentials for ${environmentLabel(env)}. The MCP relay will not sign in again until they change or "Refresh Maximo MCP Server" is run.`
    );
}


async function sendToScript(client, scriptName, { method, headers, body, signal }) {
    const response = await client.client.request({
        url: `script/${scriptName}`,
        method,
        // Passed through compressed, so only compress for a client that asked for it.
        headers: { 'accept-encoding': 'identity', ...headers },
        data: body.length > 0 ? body : undefined,
        signal,
        responseType: 'stream',
        decompress: false,
        maxRedirects: 0,
        timeout: client.config.configurationTimeout || 0,
        validateStatus: () => true
    });
    return { status: response.status, headers: { ...response.headers }, body: response.data };
}

/**
 * Returns a MaximoClient connected to the environment, reusing the current one while the
 * environment is unchanged. A failed connection is forgotten so the next request tries again,
 * unless Maximo rejected the credentials. Only an interactive connection may prompt.
 */
function getClient(env, connect, interactive) {
    if (env.apiKey && env.apiKey.startsWith('{encrypted}')) {
        return Promise.reject(new Error(`the API key for ${environmentLabel(env)} could not be decrypted`));
    }

    const key = getConnectionKey(env);
    if (rejectedKey === key && !interactive) {
        return Promise.reject(new Error(`Maximo rejected the credentials for ${environmentLabel(env)}; correct them or run "Refresh Maximo MCP Server"`));
    }
    if (!connection || connection.key !== key) {
        Logger.debug(`[MCP connection] ${connection ? 'Environment changed; replacing' : 'Opening'} the connection to ${environmentLabel(env)}.`);
        closeConnection();
        const client = connect({ interactive });
        connection = { key, client };
        client.then(
            () => {
                if (rejectedKey === key) {
                    rejectedKey = null;
                }
                Logger.debug(`Connected the MCP relay to ${environmentLabel(env)}.`);
            },
            (error) => {
                Logger.debug(`[MCP connection] Connecting to ${environmentLabel(env)} failed (code=${error?.code}, reasonCode=${error?.reasonCode}): ${error?.message ?? error}`);
                if (connection && connection.client === client) {
                    connection = null;
                }
                if (isLoginRejection(error)) {
                    rejectCredentials(key, env);
                }
            }
        );
    } else {
        Logger.debug(`[MCP connection] Reusing the connection to ${environmentLabel(env)}.`);
    }
    return connection.client;
}

function closeConnection() {
    const current = connection;
    connection = null;
    if (current) {
        current.client.then(
            (client) => client.disconnect(),
            () => {}
        );
    }
}

async function shutdown() {
    clearTimeout(notifyTimer);
    clearTimeout(retryTimer);
    closeConnection();
    const current = relay;
    relay = null;
    if (current) {
        try {
            await (await current).close();
        } catch {
            // It never started, so there is nothing to close.
        }
    }
}

/**
 * Whether connecting needs no prompt: the environment has stored credentials, or the relay is
 * already connected to it, such as after the user signed in through the refresh command.
 */
function canConnectQuietly(env) {
    return hasStoredCredentials(env) || Boolean(connection && connection.key === getConnectionKey(env));
}

function environmentLabel(env) {
    return env.name || env.host;
}

/**
 * Checks that the MCP script is installed and active on the environment, telling the user why not
 * when it is not, or only logging it when quiet. A definite answer is cached, and a negative one
 * also removes the server from the list. A failed check is not cached, so the next start tries again.
 * A repeated background check logs its failure at debug level, as the first one already reported it.
 */
async function isScriptUsable(env, scriptName, connect, quiet, repeated = false) {
    const key = getScriptCheckKey(env, scriptName);
    const generation = checkGeneration;
    let status = scriptStatusCache.get(key);

    if (!status) {
        let stage = 'connect';
        const started = Date.now();
        try {
            const client = await getClient(env, connect, !quiet);
            Logger.debug(`[MCP script check] Connected to ${environmentLabel(env)} after ${Date.now() - started}ms; looking up ${scriptName.toUpperCase()}.`);
            stage = 'scriptStatus';
            status = await client.scriptStatus(scriptName.toUpperCase());
            Logger.debug(`[MCP script check] ${scriptName.toUpperCase()} status after ${Date.now() - started}ms: ${JSON.stringify(status)}.`);
        } catch (error) {
            if (generation !== checkGeneration) {
                Logger.debug(`[MCP script check] Discarding a check superseded by a newer one: ${error?.message ?? error}`);
                return false;
            }
            const message = `Could not check whether the ${scriptName.toUpperCase()} automation script is installed on ${environmentLabel(env)}: ${error?.message ?? error}`;
            if (repeated) {
                Logger.debug(message);
            } else {
                Logger.error(message);
            }
            Logger.debug(
                `[MCP script check] Failed in ${stage} after ${Date.now() - started}ms (quiet=${quiet}, code=${error?.code}, status=${error?.response?.status}, reasonCode=${error?.reasonCode}): ${error?.stack ?? error}`
            );
            if (!quiet) {
                vscode.window.showWarningMessage(message);
            }
            return false;
        }
        if (generation !== checkGeneration) {
            return false;
        }
        scriptStatusCache.set(key, status);
    } else {
        Logger.debug(`[MCP script check] Using cached status for ${scriptName.toUpperCase()}: ${JSON.stringify(status)}.`);
    }

    const problem = describeScriptStatus(status, scriptName, environmentLabel(env));
    if (problem) {
        Logger.warn(problem);
        if (!quiet) {
            vscode.window.showWarningMessage(problem);
        }
        mcpServerDefinitionsChanged.fire();
        return false;
    }

    return true;
}
