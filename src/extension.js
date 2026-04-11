/* eslint-disable quotes */
// @ts-nocheck
import { window, commands, workspace, ProgressLocation, Uri, StatusBarAlignment, TextEditorRevealType, Range, Position, debug } from 'vscode';
import * as os from 'os';

import MaximoConfig from './maximo/maximo-config';
import MaximoClient from './maximo/maximo-client';
import ServerSourceProvider from './maximo/provider';

import deployCommand from './commands/deploy-command';
import compareCommand from './commands/compare-command';
import extractScriptsCommand from './commands/extract-scripts-command';
import extractScreensCommand from './commands/extract-screens-command';
import extractFormsCommand from './commands/extract-forms-command';
import extractDBCCommand from './commands/extract-dbc';

import extractReportsCommand from './commands/extract-reports-command';

import selectEnvironment from './commands/select-environment';
import extractObjectCommand from './commands/extract-objects-command';
import initTsTemplateCommand from './commands/init-ts-template-command';
import * as schemaSupport from './schemas/schema-support';
import { validateSettings } from './settings';
import {
    AutoScriptDebugConfigurationProvider,
    AutoScriptDebugAdapterDescriptorFactory,
    CleanupManager,
    AutoScriptDebugAdapterTrackerFactory
} from './debug/debug';

import * as path from 'path';
import * as fs from 'fs';

import * as temp from 'temp';
import { TextDecoder, TextEncoder } from 'text-encoding';
import Logger from './logger';

import LocalConfiguration from './config';

temp.track();

var password;
var lastUser;
var lastHost;
var lastPort;
var lastContext;
var logState = false;
var currentLogPath;
var currentWindow;
var currentFollow;
var logClient;

var statusBar;
var selectedEnvironment;
var secretStorage;

let activeCleanupManager = null;

export let fetchedSource = new Map();

export function activate(context) {
    secretStorage = context.secrets;

    // Initialize the logger once
    Logger.configure('MaximoDevTools');

    Logger.debug('The Maximo Dev Tools extension is activating.');

    context.subscriptions.push(Logger.channel);

    // Check ~/.gitconfig for user email to gate internal commands.
    try {
        const gitConfigPath = path.join(os.homedir(), '.gitconfig');
        if (fs.existsSync(gitConfigPath)) {
            const content = fs.readFileSync(gitConfigPath, 'utf8');
            const userSectionMatch = content.match(/\[user\][^\[]*?email\s*=\s*(.+)/i);
            const email = userSectionMatch ? userSectionMatch[1].trim() : '';
            commands.executeCommand('setContext', 'maximo-script-deploy.isNaviamUser', email.endsWith('naviam.io'));
        } else {
            commands.executeCommand('setContext', 'maximo-script-deploy.isNaviamUser', false);
        }
    } catch {
        commands.executeCommand('setContext', 'maximo-script-deploy.isNaviamUser', false);
    }

    context.subscriptions.push(workspace.onDidChangeConfiguration(_onConfigurationChange.bind(workspace)));

    context.subscriptions.push(schemaSupport.onDidCreateFiles);
    context.subscriptions.push(schemaSupport.onFileRename);
    context.subscriptions.push(schemaSupport.onDidOpenTextDocument);
    context.subscriptions.push(schemaSupport.onFileDelete);

    currentWindow = window;
    const logCommandId = 'maximo-script-deploy.log';
    context.subscriptions.push(commands.registerCommand(logCommandId, toggleLog));

    // create a new status bar item that we can now manage
    statusBar = window.createStatusBarItem(StatusBarAlignment.Left, 0);
    statusBar.command = logCommandId;
    // eslint-disable-next-line quotes
    statusBar.text = `$(book) Maximo Log`;
    // eslint-disable-next-line quotes
    statusBar.tooltip = `Toggle Maximo log streaming`;
    statusBar.show();

    context.subscriptions.push(statusBar);

    // create a new status bar item that we can now manage
    selectedEnvironment = window.createStatusBarItem(StatusBarAlignment.Left, 0);
    let globalSettings = context.globalStoragePath + path.sep + 'userprefs.json';

    selectedEnvironment.command = 'maximo-script-deploy.selectEnvironment';
    context.subscriptions.push(selectedEnvironment);

    setupEnvironmentSelection();

    if (workspace.workspaceFolders !== undefined) {
        let workspaceConfigPath = workspace.workspaceFolders[0].uri.fsPath + path.sep + '.devtools-config.json';

        // Watch for changes to a specific file
        const fileWatcher = workspace.createFileSystemWatcher(workspaceConfigPath);

        fileWatcher.onDidCreate(() => {
            setupEnvironmentSelection();
        });

        fileWatcher.onDidDelete(() => {
            setupEnvironmentSelection();
        });
    }

    // Get notified when a file is saved
    const saveWatcher = workspace.onDidSaveTextDocument(() => {
        setupEnvironmentSelection();
    });

    context.subscriptions.push(saveWatcher);

    context.subscriptions.push(workspace.registerTextDocumentContentProvider('vscode-autoscript-deploy', new ServerSourceProvider(fetchedSource)));

    let commandList = [
        {
            command: 'maximo-script-deploy.deploy',
            function: deployCommand
        },
        {
            command: 'maximo-script-deploy.compare',
            function: compareCommand
        },
        {
            command: 'maximo-script-deploy.extract',
            function: extractScriptsCommand
        },
        {
            command: 'maximo-script-deploy.screens',
            function: extractScreensCommand
        },
        {
            command: 'maximo-script-deploy.forms',
            function: extractFormsCommand
        },
        {
            command: 'maximo-script-deploy.reports',
            function: extractReportsCommand
        },
        {
            command: 'maximo-script-deploy.extractObject',
            function: extractObjectCommand
        },
        {
            command: 'maximo-script-deploy.extractDBC',
            function: extractDBCCommand
        }
    ];

    context.subscriptions.push(
        commands.registerTextEditorCommand('maximo-script-deploy.id', (editor, edit) => {
            let fileName = path.basename(editor.document.fileName);

            // if we are not dealing with an XML file do nothing.
            if (!fileName.endsWith('.xml')) {
                return;
            }

            var currentSelection = editor.selection;
            var regex = /<[^>]+(>)/g;
            let start = editor.document.offsetAt(new Position(currentSelection.start.line, currentSelection.start.character));

            let match;

            let found = false;
            while ((match = regex.exec(editor.document.getText()))) {
                if (start > match.index && start < regex.lastIndex) {
                    let tag = match[0];
                    let idMatch = /id= *".+?"/.exec(tag);

                    if (idMatch) {
                        let startId = match.index + idMatch.index;
                        let endId = startId + idMatch[0].length;
                        edit.replace(new Range(editor.document.positionAt(startId), editor.document.positionAt(endId)), `id="${Date.now()}"`);
                        found = true;
                    } else {
                        let tagMatch = /<.* /.exec(tag);
                        if (tagMatch) {
                            let startId = match.index + tagMatch.index + tagMatch[0].length;
                            edit.insert(editor.document.positionAt(startId), `id="${Date.now()}" `);
                            found = true;
                        }
                    }

                    break;
                }
            }

            if (!found) {
                if (fs.existsSync(globalSettings)) {
                    workspace.fs.readFile(Uri.file(globalSettings)).then((data) => {
                        if (data) {
                            let settings = JSON.parse(new TextDecoder().decode(data));
                            if (settings && !settings.suppressXMLIdMessage) {
                                window.showWarningMessage('Select an XML tag to insert an Id.', "Don't Show Again").then((selection) => {
                                    if (selection == "Don't Show Again") {
                                        settings.suppressXMLIdMessage = true;
                                        // @ts-ignore
                                        workspace.fs.writeFile(Uri.file(globalSettings), JSON.stringify(settings, null, 4));
                                    }
                                });
                            }
                        }
                    });
                } else {
                    window.showWarningMessage('Select an XML tag to insert an Id.', "Don't Show Again").then((selection) => {
                        if (selection == "Don't Show Again") {
                            let settings = {
                                suppressXMLIdMessage: true
                            };
                            workspace.fs
                                .writeFile(Uri.file(globalSettings), new TextEncoder().encode(JSON.stringify(settings, null, 4)))
                                // @ts-ignore
                                .catch((error) => console.log(error));
                        }
                    });
                }
            }
        })
    );

    commandList.forEach((command) => {
        context.subscriptions.push(
            commands.registerCommand(command.command, async function () {
                const config = await getMaximoConfig();
                if (!config) {
                    return;
                }

                let client;

                try {
                    client = new MaximoClient(config);
                    if (await login(client)) {
                        await command.function(client, window);
                    }
                } catch (error) {
                    if (error && typeof error.reasonCode !== 'undefined' && error.reasonCode === 'BMXAA0021E') {
                        password = undefined;
                        window.showErrorMessage(error.message, { modal: true });
                    } else if (error && typeof error.message !== 'undefined') {
                        window.showErrorMessage(error.message, { modal: true });
                    } else {
                        window.showErrorMessage('An unexpected error occurred: ' + error, { modal: true });
                    }
                } finally {
                    // if the client exists then disconnect it.
                    if (client) {
                        await client.disconnect().catch(() => {
                            //do nothing with this
                        });
                    }
                }
            })
        );
    });

    context.subscriptions.push(
        commands.registerCommand('maximo-script-deploy.selectEnvironment', async () => {
            selectEnvironment(context, selectedEnvironment, getLocalConfig);
        })
    );

    context.subscriptions.push(
        commands.registerCommand('maximo-script-deploy.tsTemplate', async () => {
            await initTsTemplateCommand();
        })
    );

    const provider = new AutoScriptDebugConfigurationProvider(context);
    const factory = new AutoScriptDebugAdapterDescriptorFactory();
    const cleanupManager = new CleanupManager(context);
    const trackerFactory = new AutoScriptDebugAdapterTrackerFactory(cleanupManager);
    activeCleanupManager = cleanupManager;

    Logger.debug('Activating Maximo AutoScript debug extension');

    context.subscriptions.push(
        debug.registerDebugConfigurationProvider('autoscript', provider),
        debug.registerDebugAdapterDescriptorFactory('autoscript', factory),
        debug.registerDebugAdapterTrackerFactory('autoscript', trackerFactory),
        debug.onDidStartDebugSession((session) => cleanupManager.track(session, 'onDidStartDebugSession')),
        debug.onDidTerminateDebugSession((session) => cleanupManager.cleanup(session, 'onDidTerminateDebugSession')),
        cleanupManager
    );
}

async function toggleLog() {
    Logger.debug(`Log toggle requested; streaming is currently ${logState ? 'active (stopping)' : 'inactive (starting)'}.`);
    // if currently logging then stop.
    if (logState) {
        if (logClient) {
            logClient.stopLogging();
            logClient = undefined;
        }
        logState = !logState;
    } else {
        const config = await getMaximoConfig();

        if (!config) {
            return;
        }

        if (logClient) {
            await logClient.disconnect();
            logClient = new MaximoClient(config);
        } else {
            logClient = new MaximoClient(config);
        }

        try {
            if (await login(logClient)) {
                var servers = await logClient.getLoggingServers();
                Logger.debug(`Maximo returned ${servers && Array.isArray(servers) ? servers.length : 0} logging server(s).`);

                var server = null;
                if (servers && Array.isArray(servers) && servers.length > 0) {
                    if (servers.length === 1) {
                        Logger.debug(`Auto-selecting single logging server: ${servers[0].javajvmname || 'unknown'}.`);
                        server = servers[0];
                        startLogging(config, server);
                    } else {
                        Logger.debug('Multiple logging servers available; presenting selection picker.');
                        const quickPick = window.createQuickPick();
                        quickPick.title = 'Select Maximo Server to Stream Log';
                        quickPick.busy = false;
                        quickPick.placeholder = 'Select a Maximo Server';

                        quickPick.onDidHide(() => quickPick.dispose());
                        quickPick.show();
                        quickPick.items = servers.map((s) => {
                            return {
                                label: s.javajvmname,
                                description: s.serverhost
                            };
                        });

                        quickPick.onDidAccept(() => {
                            server = quickPick.selectedItems[0];
                            startLogging(config, server);
                            quickPick.hide();
                        });
                    }
                } else {
                    startLogging(config, null);
                }
            }
        } catch (error) {
            if (logState) {
                toggleLog();
            }

            if (error && typeof error.reasonCode !== 'undefined' && error.reasonCode === 'BMXAA0021E') {
                password = undefined;
                window.showErrorMessage(error.message, { modal: true });
            } else if (error && typeof error.message !== 'undefined') {
                window.showErrorMessage(error.message, { modal: true });
            } else {
                window.showErrorMessage('An unexpected error occurred: ' + error, { modal: true });
            }

            if (logClient) {
                logClient.disconnect();
                logClient = undefined;
            }
        }
    }

    if (logState) {
        statusBar.text = '$(sync~spin) Maximo Log';
    } else {
        statusBar.text = '$(book) Maximo Log';
    }
}

function startLogging(config, server) {
    let logConfig = getLoggingConfig();

    let logFilePath = logConfig.outputFile;
    let isAbsolute = false;
    if (logFilePath) {
        isAbsolute = path.isAbsolute(logFilePath);

        if (!isAbsolute) {
            if (workspace.workspaceFolders !== undefined) {
                logFilePath = workspace.workspaceFolders[0].uri.fsPath + path.sep + logFilePath;
            } else {
                window.showErrorMessage('A working folder must be selected or an absolute log file path configured before retrieving the Maximo logs. ', {
                    modal: true
                });
                return;
            }
        } else {
            let logFolder = path.dirname(logFilePath);
            if (!fs.existsSync(logFolder)) {
                window.showErrorMessage(`The log file folder ${logFolder} does not exist.`, { modal: true });
                return;
            }
        }
    } else {
        // @ts-ignore
        logFilePath = temp.path({
            suffix: '.log',
            defaultPrefix: 'maximo'
        });
    }

    // eslint-disable-next-line no-undef
    const logFile = isAbsolute ? path.resolve(logFilePath) : path.resolve(__dirname, logFilePath);

    currentLogPath = logFile;

    if (!logConfig.append) {
        if (fs.existsSync(logFile)) {
            fs.unlinkSync(logFile);
        }
    }

    if (logConfig.openOnStart) {
        // Touch the log file making sure it is there then open it.
        const time = new Date();

        try {
            fs.utimesSync(logFile, time, time);
        } catch (err) {
            fs.closeSync(fs.openSync(logFile, 'w'));
        }

        workspace.openTextDocument(logFile).then((doc) => {
            window.showTextDocument(doc, { preview: true }).then(
                function (editor) {
                    if (this.follow) {
                        let lineCount = editor.document.lineCount;
                        editor.revealRange(new Range(lineCount, 0, lineCount, 0), TextEditorRevealType.Default);
                    }
                }.bind(logConfig)
            );
        });

        if (logConfig.follow) {
            currentFollow = workspace.onDidChangeTextDocument((e) => {
                let document = e.document;

                // if the file changing is the current log file then scroll
                if (currentWindow && document.fileName == currentLogPath) {
                    const editor = currentWindow.visibleTextEditors.find((editor) => editor.document === document);
                    if (editor) {
                        editor.revealRange(new Range(document.lineCount, 0, document.lineCount, 0), TextEditorRevealType.Default);
                    }
                }
            });
        } else {
            if (currentFollow) {
                currentFollow.dispose();
            }
        }
    }

    currentLogPath = logFile;

    let timeout = logConfig.timeout;
    let responseTimeout = config.responseTimeout;
    if (timeout && responseTimeout && timeout * 1000 > responseTimeout) {
        Logger.debug(`Log timeout (${timeout}s) exceeds response timeout; capping at ${responseTimeout / 1000}s.`);
        timeout = responseTimeout / 1000;
    }

    Logger.debug(
        `Starting log stream: file=${logFile}, timeout=${timeout}s, append=${Boolean(logConfig.append)}, server=${server ? server.description || server.label || 'unknown' : 'default'}.`
    );
    logClient
        .startLogging(logFile, timeout, statusBar, server !== undefined && server !== null && server.description !== '' ? server.description : null)
        .catch((error) => {
            if (typeof error !== 'undefined' && typeof error.toJSON === 'function') {
                let jsonError = error.toJSON();
                if (typeof jsonError.message !== 'undefined') {
                    window.showErrorMessage(jsonError.message, {
                        modal: true
                    });
                } else {
                    window.showErrorMessage(JSON.stringify(jsonError), {
                        modal: true
                    });
                }
            } else if (typeof error !== 'undefined' && typeof error.Error !== 'undefined' && typeof error.Error.message !== 'undefined') {
                window.showErrorMessage(error.Error.message, {
                    modal: true
                });
            } else if (error instanceof Error) {
                window.showErrorMessage(error.message, {
                    modal: true
                });
            } else {
                window.showErrorMessage(error, {
                    modal: true
                });
            }

            if (logState) {
                toggleLog();
            }
        });
    logState = !logState;
}

function _onConfigurationChange(e) {
    if (this) {
        if (e.affectsConfiguration('naviam.maximo.logging.follow')) {
            if (currentFollow) {
                currentFollow.dispose();
            }

            if (this.getConfiguration('naviam').get('maximo.logging.follow')) {
                currentFollow = this.onDidChangeTextDocument((e) => {
                    let document = e.document;

                    // if the file changing is the current log file then scroll
                    if (currentWindow && document.fileName == currentLogPath) {
                        const editor = currentWindow.visibleTextEditors.find((editor) => editor.document === document);
                        if (editor) {
                            editor.revealRange(new Range(document.lineCount, 0, document.lineCount, 0), TextEditorRevealType.Default);
                        }
                    }
                });
            }
        }
    }
}

export async function getMaximoConfig() {
    try {
        let localConfig = await getLocalConfig();
        let selectedConfig = {};

        if (localConfig) {
            selectedConfig = await localConfig.config;
        }

        if (!selectedConfig) {
            selectedConfig = {};
        } else if (Array.isArray(selectedConfig) && selectedConfig.length > 0) {
            if (selectedConfig.length === 1) {
                selectedConfig = selectedConfig[0];
            } else {
                selectedConfig = selectedConfig.find((config) => config.selected) || {};
            }
        }

        let settings = workspace.getConfiguration('naviam');

        let host = selectedConfig.host ?? settings.get('maximo.host');
        let userName = selectedConfig.username ?? settings.get('maximo.user');
        let useSSL = typeof selectedConfig.useSSL !== 'undefined' ? selectedConfig.useSSL : settings.get('maximo.useSSL');
        let port = selectedConfig.port ?? settings.get('maximo.port');
        let apiKey = selectedConfig.apiKey ?? settings.get('maximo.apiKey');

        let allowUntrustedCerts =
            typeof selectedConfig.allowUntrustedCerts !== 'undefined' ? selectedConfig.allowUntrustedCerts : settings.get('maximo.allowUntrustedCerts');
        let maximoContext = selectedConfig.context ?? settings.get('maximo.context');
        let timeout = selectedConfig.timeout ?? settings.get('maximo.timeout');
        let configurationTimeout = selectedConfig.configurationTimeout ?? settings.get('maximo.configurationTimeout');
        let ca = selectedConfig.ca ?? settings.get('maximo.customCA');
        let maxauthOnly = typeof selectedConfig.maxauthOnly !== 'undefined' ? selectedConfig.maxauthOnly : settings.get('maximo.maxauthOnly');
        let extractLocation = selectedConfig.extractLocation ?? settings.get('maximo.extractLocation');
        let extractLocationScreens = selectedConfig.extractLocationScreens ?? settings.get('maximo.extractScreenLocation');
        let extractLocationForms = selectedConfig.extractLocationForms ?? settings.get('maximo.extractInspectionFormsLocation');
        let extractLocationReports = selectedConfig.extractLocationReports ?? settings.get('maximo.extractReportsLocation');
        let extractLocationDBC = selectedConfig.extractLocationDBC ?? settings.get('maximo.extractDBCLocation');
        let proxyHost = selectedConfig.proxyHost ?? settings.get('maximo.proxy.host');
        let proxyPort = selectedConfig.proxyPort ?? settings.get('maximo.proxy.port');
        let proxyUsername = selectedConfig.proxyUsername ?? settings.get('maximo.proxy.user');
        let proxyPassword = selectedConfig.proxyPassword ?? settings.get('maximo.proxy.password');
        let debugPort = selectedConfig.debugPort ?? settings.get('maximo.debugPort');

        Logger.debug(
            `Resolved Maximo config: host=${host}:${port}, useSSL=${useSSL}, auth=${apiKey ? 'apiKey' : 'password'}, proxy=${Boolean(proxyHost)}, allowUntrustedCerts=${allowUntrustedCerts}.`
        );

        // make sure we have all the settings.
        if (
            !validateSettings({
                host: host,
                username: userName,
                port: port,
                apiKey: apiKey
            })
        ) {
            Logger.debug('Config validation failed; at least one required setting is missing.');
            return;
        }

        // if the last user doesn't match the current user then request the password.
        if (lastUser && lastUser !== userName) {
            password = null;
        }

        if (lastHost && lastHost !== host) {
            password = null;
        }

        if (lastPort && lastPort !== port) {
            password = null;
        }

        if (lastContext && lastContext !== maximoContext) {
            password = null;
        }

        if (typeof selectedConfig.password !== 'undefined') {
            password = selectedConfig.password;
            apiKey = selectedConfig.apiKey;
        }

        if (!apiKey) {
            if (!password) {
                password = await window.showInputBox({
                    prompt: `Enter ${userName}'s password`,
                    password: true,
                    validateInput: (text) => {
                        if (!text || text.trim() === '') {
                            return 'A password is required';
                        }
                    }
                });
            }

            // if the password has not been set then just return.
            if (!password || password.trim() === '') {
                return undefined;
            }
        }

        return new MaximoConfig({
            username: userName,
            password: password,
            useSSL: useSSL,
            host: host,
            port: port,
            context: maximoContext,
            connectTimeout: timeout * 1000,
            responseTimeout: timeout * 1000,
            allowUntrustedCerts: allowUntrustedCerts,
            configurationTimeout: configurationTimeout * 60000,
            ca: ca,
            maxauthOnly: maxauthOnly,
            apiKey: apiKey,
            extractLocation: extractLocation,
            extractLocationScreens: extractLocationScreens,
            extractLocationForms: extractLocationForms,
            extractLocationReports: extractLocationReports,
            extractLocationDBC: extractLocationDBC,
            proxyHost: proxyHost,
            proxyPort: proxyPort,
            proxyUsername: proxyUsername,
            proxyPassword: proxyPassword,
            debugPort: debugPort
        });
    } catch (error) {
        if (error.reason == 'WRONG_FINAL_BLOCK_LENGTH') {
            window.showErrorMessage('An error occurred decrypting the password or API Key from the .devtools-config.json file.', { modal: true });
        } else {
            window.showErrorMessage(error.message, { modal: true });
        }

        return;
    }
}

async function getLocalConfig() {
    if (workspace.workspaceFolders !== undefined) {
        let workspaceConfigPath = workspace.workspaceFolders[0].uri.fsPath + path.sep + '.devtools-config.json';
        if (fs.existsSync(workspaceConfigPath)) {
            let localConfig = new LocalConfiguration(workspaceConfigPath, secretStorage);
            if (localConfig.configAvailable) {
                await localConfig.encryptIfRequired();
                return await localConfig;
            }
        }
    }
    return {};
}

async function setupEnvironmentSelection() {
    selectedEnvironment.hide();
    let localConfig = await getLocalConfig();
    let selectedConfig = {};

    if (localConfig) {
        selectedConfig = await localConfig.config;
    }

    if (selectedConfig && Array.isArray(selectedConfig) && selectedConfig.length > 0) {
        if (selectedConfig.length > 1) {
            selectedConfig = selectedConfig.find((config) => config.selected) || {};
            if (typeof selectedConfig.selected !== 'undefined') {
                if (typeof selectedConfig.name !== 'string') {
                    selectedEnvironment.text = 'Missing Maximo Environment Name';
                    selectedEnvironment.tooltip = 'The selected Maximo environment is missing the name attribute';
                    selectedEnvironment.show();
                } else {
                    selectedEnvironment.text = selectedConfig.name;
                    selectedEnvironment.tooltip = typeof selectedConfig.description === 'string' ? selectedConfig.description : 'Current Maximo Environment';
                    selectedEnvironment.show();
                }
            } else {
                selectedEnvironment.text = 'No Maximo Environment Selected';
                selectedEnvironment.tooltip = 'Click to select a Maximo Environment';
                selectedEnvironment.show();
                selectedConfig = {};
            }
        }
    }
}

function getLoggingConfig() {
    let settings = workspace.getConfiguration('naviam');
    let outputFile = settings.get('maximo.logging.outputFile');
    let openEditorOnStart = settings.get('maximo.logging.openEditorOnStart');
    let append = settings.get('maximo.logging.append');
    let timeout = settings.get('maximo.logging.timeout');
    let follow = settings.get('maximo.logging.follow');

    return {
        outputFile: outputFile,
        openOnStart: openEditorOnStart,
        append: append,
        timeout: timeout,
        follow: follow
    };
}

export async function login(client) {
    Logger.debug(`Connecting to Maximo at ${client.config.host}:${client.config.port} (useSSL=${client.config.useSSL}).`);
    let logInSuccessful = await client.connect().then(
        () => {
            lastUser = client.config.userName;
            lastHost = client.config.host;
            lastPort = client.config.port;
            lastContext = client.config.maximoContext;
            return true;
        },
        (error) => {
            // clear the password on error
            password = undefined;
            lastUser = undefined;
            // show the error message to the user.
            if (error.message.includes('ENOTFOUND')) {
                window.showErrorMessage('The host name "' + client.config.host + '" cannot be found.', { modal: true });
            } else if (typeof error.code !== 'undefined' && error.code == 'ECONNRESET') {
                window.showErrorMessage(error.message, { modal: true });
            } else if (error.message.includes('ECONNREFUSED')) {
                window.showErrorMessage('Connection refused to host ' + client.config.host + ' on port ' + client.config.port, { modal: true });
            } else if (error.message.includes('EPROTO')) {
                window.showErrorMessage(
                    'Connection refused to host ' +
                        client.config.host +
                        ' on port ' +
                        client.config.port +
                        ' because of an SSL connection error.\nAre you sure your server is using SSL or did you specify a non-SSL port?.',
                    { modal: true }
                );
            } else if (error.isAxiosError && error.response && error.response.status && error.response.status == 401) {
                window.showErrorMessage('User name and password combination are not valid. Try again.', { modal: true });
            } else if (client.config.apiKey && error.response.status == 400) {
                window.showErrorMessage('The provided API Key is invalid. Try again.', { modal: true });
            } else {
                window.showErrorMessage(error.message, { modal: true });
            }
            return false;
        }
    );

    if (logInSuccessful) {
        Logger.debug('Connection established. Checking if scripts are installed and up to date.');
        if ((await installed(client)) && (await upgraded(client))) {
            Logger.debug('Install and upgrade checks passed.');
            return true;
        } else {
            Logger.debug('Install or upgrade check did not pass; disconnecting.');
            await client.disconnect();
            return false;
        }
    } else {
        Logger.debug('Connection attempt failed.');
        return false;
    }
}

async function installed(client) {
    Logger.debug('Checking if Naviam scripts are installed in Maximo.');
    if (!(await client.installed())) {
        Logger.debug('Naviam scripts are not installed; prompting user to configure Maximo.');
        return await window
            .showInformationMessage(
                'Configurations are required to deploy automation scripts.  Do you want to configure Maximo now?',
                { modal: true },
                ...['Yes']
            )
            .then(async (response) => {
                Logger.debug(`User responded to install prompt: ${response === 'Yes' ? 'proceeding with install' : 'skipped'}.`);
                if (response === 'Yes') {
                    return await window.withProgress(
                        {
                            title: 'Configuring Maximo',
                            location: ProgressLocation.Notification
                        },
                        async (progress) => {
                            var result = await client.installOrUpgrade(progress, true);
                            if (result && result.status === 'error') {
                                window.showErrorMessage(result.message, {
                                    modal: true
                                });
                                return false;
                            } else {
                                Logger.debug('Script installation completed successfully.');
                                window.showInformationMessage('Maximo configuration successful.', { modal: true });
                                return true;
                            }
                        }
                    );
                }
                return false;
            });
    } else {
        Logger.debug('Naviam scripts are already installed.');
        return true;
    }
}

async function upgraded(client) {
    Logger.debug('Checking if Naviam scripts require an upgrade.');
    if (await client.upgradeRequired()) {
        Logger.debug('Script upgrade required; prompting user.');
        return await window
            .showInformationMessage(
                'Updated configurations are required to deploy automation scripts.  Do you want to configure Maximo now?',
                { modal: true },
                ...['Yes']
            )
            .then(async (response) => {
                Logger.debug(`User responded to upgrade prompt: ${response === 'Yes' ? 'proceeding with upgrade' : 'skipped'}.`);
                if (response === 'Yes') {
                    return await window.withProgress(
                        {
                            title: 'Configuring Maximo',
                            location: ProgressLocation.Notification
                        },
                        async (progress) => {
                            var result = await client.installOrUpgrade(progress);
                            if (result && result.status === 'error') {
                                window.showErrorMessage(result.message, {
                                    modal: true
                                });
                                return false;
                            } else {
                                Logger.debug('Script upgrade completed successfully.');
                                window.showInformationMessage('Maximo configuration successful.', { modal: true });
                                return true;
                            }
                        }
                    );
                }
                return false;
            });
    } else {
        Logger.debug('Scripts are already up to date; no upgrade needed.');
        return true;
    }
}

export async function asyncForEach(array, callback) {
    for (let index = 0; index < array.length; index++) {
        await callback(array[index], index, array);
    }
}

// this method is called when your extension is deactivated
async function deactivate() {
    currentWindow = undefined;
    currentLogPath = undefined;

    if (activeCleanupManager) {
        await activeCleanupManager.dispose();
        activeCleanupManager = null;
    }
}

export default {
    activate,
    deactivate
};
