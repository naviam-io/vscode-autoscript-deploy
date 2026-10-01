// @ts-nocheck
import * as vscode from 'vscode';
import Logger from './logger';
import { getScriptUrl, formatMcpHeaders, getMcpScriptName, getScriptCheckKey, describeScriptStatus } from './mcp-core';
import { findSelectedEnvironment, resolveEnvironment } from './environment';

const mcpServerDefinitionsChanged = new vscode.EventEmitter();

// Script lookup results keyed by getScriptCheckKey(), kept until the environment or settings change.
const scriptStatusCache = new Map();

// Auto-start state: whether the next definition served should be started, which request is current,
// when the last attempt was made, and how many times VS Code has resolved a server.
let autoStartRequested = true;
let autoStartGeneration = 0;
let lastAutoStartAt = 0;
let resolveCount = 0;

// Delays before each attempt, since VS Code only knows the server once it has processed the definition.
const AUTO_START_DELAYS = [1000, 2000, 4000];
const AUTO_START_QUIET_MS = 15000;

/**
 * Forgets every script check and asks VS Code for the server definition again. Called whenever the
 * resolved environment could have changed, and by the refresh command after the script is installed.
 */
export function notifyMcpEnvironmentChanged() {
    scriptStatusCache.clear();
    autoStartRequested = true;
    mcpServerDefinitionsChanged.fire();
}

/**
 * Resolves the selected Maximo environment, reading .devtools-config.json through the extension's
 * getLocalConfig() so the file is loaded, encrypted and decrypted in one place.
 */
async function getSelectedEnvironment(getLocalConfig) {
    const localConfig = await getLocalConfig();
    return resolveEnvironment(findSelectedEnvironment(await localConfig.config), vscode.workspace.getConfiguration('naviam'));
}

/**
 * Registers the Model Context Protocol (MCP) server definition provider.
 *
 * The server is only usable where the MCP automation script is installed and active, so it is
 * checked for when VS Code starts the server. See docs/modules/mcp-server.md.
 *
 * @param {vscode.ExtensionContext} context
 * @param {{ checkScript: (scriptName: string, credentials: {password?: string, apiKey?: string}) => Promise<{installed: boolean, active: boolean}>, getLocalConfig: () => Promise<{config?: Promise<Array|Object>}> }} options
 */
export function registerMcpProvider(context, options) {
    if (!vscode.lm || typeof vscode.lm.registerMcpServerDefinitionProvider !== 'function' || typeof vscode.McpHttpServerDefinition !== 'function') {
        Logger.debug('vscode.lm.registerMcpServerDefinitionProvider or McpHttpServerDefinition not supported in this VS Code version.');
        return;
    }

    context.subscriptions.push(mcpServerDefinitionsChanged);

    const extensionVersion = context.extension?.packageJSON?.version || '1.0.0';

    const provider = {
        onDidChangeMcpServerDefinitions: mcpServerDefinitionsChanged.event,

        provideMcpServerDefinitions: async () => {
            try {
                const env = await getSelectedEnvironment(options.getLocalConfig);
                if (!env || !env.host) {
                    Logger.debug('No active Maximo environment found for MCP provider.');
                    return [];
                }

                const scriptName = getMcpScriptName(vscode.workspace.getConfiguration('naviam').get('mcp.script'));
                const cachedStatus = scriptStatusCache.get(getScriptCheckKey(env, scriptName));
                if (cachedStatus && describeScriptStatus(cachedStatus, scriptName, environmentLabel(env))) {
                    Logger.debug(`Not providing the MCP server definition: ${scriptName.toUpperCase()} is not usable on ${environmentLabel(env)}.`);
                    return [];
                }

                const url = getScriptUrl(env, scriptName);
                const label = `Maximo: ${environmentLabel(env)}`;
                const version = `${extensionVersion}:${environmentLabel(env)}`;

                Logger.debug(`Providing MCP server definition: label="${label}", uri="${url}".`);
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
            try {
                const env = await getSelectedEnvironment(options.getLocalConfig);
                if (!env || !env.host) {
                    Logger.error('Failed to resolve MCP server definition: selected environment is missing or has no host.');
                    return undefined;
                }

                const scriptName = getMcpScriptName(vscode.workspace.getConfiguration('naviam').get('mcp.script'));
                server.uri = vscode.Uri.parse(getScriptUrl(env, scriptName));

                const credentials = {};
                let headers = formatMcpHeaders(env);
                if (!headers && env.username) {
                    const promptedPassword = await vscode.window.showInputBox({
                        prompt: `Enter ${env.username}'s password for ${environmentLabel(env)}`,
                        password: true,
                        validateInput: (text) => (!text || text.trim() === '' ? 'A password is required' : null)
                    });
                    if (promptedPassword) {
                        headers = formatMcpHeaders(env, promptedPassword);
                        credentials.password = promptedPassword;
                    } else {
                        Logger.warn('MCP server resolution cancelled: password prompt dismissed.');
                        return undefined;
                    }
                } else if (!headers && env.apiKey && env.apiKey.startsWith('{encrypted}')) {
                    const promptedApiKey = await vscode.window.showInputBox({
                        prompt: `Enter API key for ${environmentLabel(env)}`,
                        password: true,
                        validateInput: (text) => (!text || text.trim() === '' ? 'An API key is required' : null)
                    });
                    if (promptedApiKey) {
                        headers = { apikey: promptedApiKey };
                        credentials.apiKey = promptedApiKey;
                    } else {
                        Logger.warn('MCP server resolution cancelled: API key prompt dismissed.');
                        return undefined;
                    }
                }

                if (!headers) {
                    vscode.window.showErrorMessage('The selected Maximo environment has no API key or password.');
                    Logger.error('MCP server resolution failed: no API key or password configured.');
                    return undefined;
                }

                if (!(await isScriptUsable(env, scriptName, credentials, options.checkScript, quiet))) {
                    return undefined;
                }

                server.headers = headers;
                Logger.debug(`Resolved MCP server definition with auth headers: ${Object.keys(headers).join(', ')}.`);
                return server;
            } catch (error) {
                Logger.error(`Error resolving MCP server definition: ${error?.message ?? error}`);
                return undefined;
            }
        }
    };

    context.subscriptions.push(vscode.lm.registerMcpServerDefinitionProvider('maximo-script-deploy.mcp', provider));
    Logger.info('Registered Maximo MCP server definition provider (maximo-script-deploy.mcp).');
}

/**
 * Starts the server once VS Code has the definition, when naviam.mcp.autoStart is on and the
 * environment has stored credentials, so no prompt appears unprompted. There is no public API for
 * this, so it uses the internal workbench.mcp.startServer command, keyed by VS Code's server id.
 * See docs/modules/mcp-server.md.
 */
async function autoStart(serverId, env) {
    if (!vscode.workspace.getConfiguration('naviam').get('mcp.autoStart')) {
        return;
    }
    if (!formatMcpHeaders(env)) {
        Logger.debug(`Not starting the MCP server automatically: ${environmentLabel(env)} has no stored password or API key.`);
        return;
    }

    const generation = ++autoStartGeneration;
    for (const delay of AUTO_START_DELAYS) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        if (generation !== autoStartGeneration) {
            return;
        }

        const resolved = resolveCount;
        lastAutoStartAt = Date.now();
        try {
            Logger.debug(`Starting MCP server ${serverId}.`);
            await vscode.commands.executeCommand('workbench.mcp.startServer', serverId);
        } catch (error) {
            Logger.debug(`Could not start the MCP server automatically: ${error?.message ?? error}`);
            return;
        }
        if (resolveCount !== resolved) {
            return;
        }
    }
}

function environmentLabel(env) {
    return env.name || env.host;
}

/**
 * Checks that the MCP script is installed and active on the environment, telling the user why not
 * when it is not, or only logging it when quiet. A definite answer is cached, and a negative one
 * also removes the server from the list. A failed check is not cached, so the next start tries again.
 */
async function isScriptUsable(env, scriptName, credentials, checkScript, quiet) {
    const key = getScriptCheckKey(env, scriptName);
    let status = scriptStatusCache.get(key);

    if (!status) {
        try {
            status = await checkScript(scriptName.toUpperCase(), credentials);
        } catch (error) {
            const message = `Could not check whether the ${scriptName.toUpperCase()} automation script is installed on ${environmentLabel(env)}: ${error?.message ?? error}`;
            Logger.error(message);
            if (!quiet) {
                vscode.window.showWarningMessage(message);
            }
            return false;
        }
        scriptStatusCache.set(key, status);
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
