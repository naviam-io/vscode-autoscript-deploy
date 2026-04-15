// @ts-nocheck
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { login, getMaximoConfig } from '../extension';
import MaximoClient from '../maximo/maximo-client';
import Logger from '../logger';

function getDebugVersion(context) {
    const versionPath = path.join(context.extensionPath, 'resources', '.version');

    try {
        return fs.readFileSync(versionPath, 'utf8').trim();
    } catch (error) {
        Logger.error(`Failed to read debug version from ${versionPath}: ${error.message}`);
        return 'unknown';
    }
}

export class AutoScriptDebugConfigurationProvider {
    constructor(context) {
        this.context = context;
        this.password = null;
        this.lastUser = null;
        this.lastHost = null;
        this.lastPort = null;
        this.lastContext = null;
    }

    async resolveDebugConfiguration(folder, config) {
        const workspaceFolder =
            folder?.uri?.fsPath || vscode.window.activeTextEditor?.document?.uri?.fsPath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        // const extensionConfig = vscode.workspace.getConfiguration('autoscriptDebug');
        const scriptRoots = resolveScriptRoots([], workspaceFolder);
        const scriptIndex = buildScriptIndex(scriptRoots);
        const maximoConfig = await getMaximoConfig();
        await this.ensureDebuggerInstalled(this.context, maximoConfig);

        const resolved = {
            type: 'autoscript',
            request: 'attach',
            name: config.name || 'Attach to Maximo AutoScript',
            host: maximoConfig.host || '127.0.0.1',
            port: typeof maximoConfig.debugPort === 'number' ? maximoConfig.debugPort : 4711,
            localRoot: workspaceFolder,
            scriptRoots,
            scriptIndex
        };

        return resolved;
    }

    async ensureDebuggerInstalled(context, config) {
        const debugVersion = getDebugVersion(context);

        if (!config) {
            return;
        }

        let client;

        try {
            client = new MaximoClient(config);
            if (await login(client)) {
                var versionInfo = await client.getDebugVersion();

                if (versionInfo && versionInfo.status === 'success') {
                    if (!versionInfo.driverClassAvailable || versionInfo.version !== debugVersion) {
                        if (versionInfo.canInstall) {
                            Logger.debug('Maximo Debugger is not currently installed in Maximo. Proceeding with installation.');
                            const jarPath = path.join(context.extensionPath, 'resources', 'autoscript-debug.jar');
                            const jarBase64 = fs.readFileSync(jarPath).toString('base64');
                            let resp = await client.installDebugDriver(jarBase64);
                            Logger.debug(`Debug driver installation response: ${JSON.stringify(resp)}`);
                            return;
                        } else {
                            if (versionInfo.version !== debugVersion) {
                                vscode.window.showErrorMessage(
                                    'Maximo Debugger Java class version does not match and cannot be upgraded automatically. Please ensure you are an administrator or have the NAVIAM_UTILS:DEBUGSCRIPT permission.',
                                    { modal: true }
                                );
                            } else {
                                vscode.window.showErrorMessage(
                                    'Maximo Debugger Java class is not installed and cannot be installed automatically. Please ensure you are an administrator or have the NAVIAM_UTILS:DEBUGSCRIPT permission.',
                                    { modal: true }
                                );
                            }
                        }
                    } else if (!versionInfo.driverLoaded) {
                        Logger.debug('Maximo Debugger jar is installed but the driver is not loaded in the current JVM. Attempting to load the driver.');
                        var activateResponse = await client.loadDebugDriver();
                        if (activateResponse.status === 'success') {
                            Logger.debug('Maximo Debugger driver loaded successfully.');
                            return;
                        } else {
                            Logger.debug(`Failed to load Maximo Debugger driver: ${activateResponse.message}`);
                        }
                    }
                } else {
                    Logger.debug('No Maximo Debugger version information found. Ensure that NAVIAM.AUTOSCRIPT.DEBUG script is installed and accessible.');
                }
            }
        } catch (error) {
            if (error && typeof error.reasonCode !== 'undefined' && error.reasonCode === 'BMXAA0021E') {
                this.password = undefined;
                vscode.window.showErrorMessage(error.message, { modal: true });
            } else if (error && typeof error.message !== 'undefined') {
                vscode.window.showErrorMessage(error.message, { modal: true });
            } else {
                vscode.window.showErrorMessage('An unexpected error occurred: ' + error, { modal: true });
            }
        } finally {
            // if the client exists then disconnect it.
            if (client) {
                await client.disconnect().catch(() => {
                    //do nothing with this
                });
            }
        }
    }
}

export class AutoScriptDebugAdapterDescriptorFactory {
    constructor(output) {
        this.output = output;
    }

    createDebugAdapterDescriptor(session) {
        const host = session.configuration.host || '127.0.0.1';
        const port = typeof session.configuration.port === 'number' ? session.configuration.port : 4711;

        Logger.debug(`Creating debug adapter server for ${host}:${port}`);

        // Auto-clear after 10 seconds.
        vscode.window.setStatusBarMessage(`Maximo Automation Script debugger attached to ${host}:${port}`, 5000);

        return new vscode.DebugAdapterServer(port, host);
    }
}

export class AutoScriptDebugAdapterTrackerFactory {
    constructor(cleanupManager) {
        this.cleanupManager = cleanupManager;
    }

    createDebugAdapterTracker(session) {
        try {
            this.cleanupManager.track(session, 'createDebugAdapterTracker');
            return {
                onWillReceiveMessage: (message) => {
                    if (message && message.command === 'disconnect') {
                        this.cleanupManager.cleanup(session, 'dap disconnect request');
                    }
                },
                onDidSendMessage: (message) => {
                    if (!message || message.type !== 'event') {
                        return;
                    }
                    if (message.event === 'terminated' || message.event === 'exited') {
                        this.cleanupManager.cleanup(session, `dap ${message.event} event`);
                    }
                },
                onError: (error) => {
                    let detail = '';
                    if (error) {
                        if (error.message) {
                            detail = error.message;
                        } else if (error.stack) {
                            detail = error.stack;
                        } else {
                            try {
                                detail = JSON.stringify(error);
                            } catch (e) {
                                detail = String(error);
                            }
                        }
                    } else {
                        detail = 'Unknown error (error object was undefined)';
                    }
                    Logger.error(`Debug adapter tracker error for session ${session.id}: ${detail}`);
                }
            };
        } catch (error) {
            const detail = error && error.message ? error.message : String(error);
            Logger.error(`Failed to create debug adapter tracker for session ${session.id}: ${detail}`);
            return {};
        }
    }
}

export class CleanupManager {
    constructor(context, output) {
        this.context = context;
        this.output = output;
        this.trackedSessions = new Map();
        this.pendingCleanups = new Map();
    }

    track(session, source) {
        if (session.type !== 'autoscript') {
            return;
        }
        this.log(`Tracking session ${session.id} from ${source};`);
        this.trackedSessions.set(session.id, session.configuration);
    }

    cleanup(session, source) {
        if (session.type !== 'autoscript') {
            return;
        }
        this.cleanupById(session.id, session.configuration, source);
    }

    async cleanupById(sessionId, sessionConfiguration, source) {
        this.trackedSessions.delete(sessionId);
        if (this.pendingCleanups.has(sessionId)) {
            Logger.info(`Skipping duplicate cleanup for session ${sessionId} from ${source}`);
            return;
        }

        Logger.info(`Starting cleanup for session ${sessionId} from ${source}`);

        const cleanupPromise = ensureDebuggerUninstalled()
            .catch((error) => {
                Logger.error(`AutoDebug cleanup error: ${error.message}`);
            })
            .finally(() => {
                Logger.debug(`Finished cleanup for session ${sessionId}`);
                this.pendingCleanups.delete(sessionId);
            });

        this.pendingCleanups.set(sessionId, cleanupPromise);
        await cleanupPromise;
    }

    async dispose() {
        const cleanups = [];
        for (const [sessionId, config] of this.trackedSessions.entries()) {
            cleanups.push(this.cleanupById(sessionId, config, 'extension deactivate'));
        }
        await Promise.allSettled([...this.pendingCleanups.values(), ...cleanups]);
    }

    log(message) {
        Logger.debug(message);
    }
}

function resolveScriptRoots(scriptRoots, workspaceFolder) {
    const configuredRoots = Array.isArray(scriptRoots) && scriptRoots.length > 0 ? scriptRoots : [workspaceFolder];

    return configuredRoots.map((scriptRoot) => expandWorkspaceFolder(scriptRoot, workspaceFolder)).filter(Boolean);
}

function expandWorkspaceFolder(value, workspaceFolder) {
    if (!value) {
        return null;
    }
    if (value.startsWith('${workspaceFolder}') && workspaceFolder) {
        const suffix = value.slice('${workspaceFolder}'.length).replace(/^[/\\]/, '');
        return path.join(workspaceFolder, suffix);
    }
    return value;
}

function buildScriptIndex(scriptRoots) {
    const index = {};

    for (const scriptRoot of scriptRoots) {
        if (!scriptRoot || !fs.existsSync(scriptRoot)) {
            continue;
        }
        walkScripts(scriptRoot, index);
    }

    return index;
}

function walkScripts(currentPath, index) {
    const stat = fs.statSync(currentPath);
    if (stat.isDirectory()) {
        for (const entry of fs.readdirSync(currentPath)) {
            walkScripts(path.join(currentPath, entry), index);
        }
        return;
    }

    const extension = path.extname(currentPath).toLowerCase();
    if (extension !== '.py' && extension !== '.js') {
        return;
    }

    const fileName = path.basename(currentPath, extension);
    index[fileName.toUpperCase()] = currentPath;
}

async function ensureDebuggerUninstalled() {
    const config = await getMaximoConfig();
    const client = new MaximoClient(config);

    try {
        if (await login(client)) {
            client.unloadDebugDriver();
        }
    } catch (error) {
        if (error && typeof error.message !== 'undefined') {
            vscode.window.showErrorMessage(error.message, { modal: true });
        } else {
            vscode.window.showErrorMessage('An unexpected error occurred: ' + error, { modal: true });
        }
    } finally {
        // if the client exists then disconnect it.
        if (client) {
            await client.disconnect().catch(() => {
                //do nothing with this
            });
        }
    }
}
