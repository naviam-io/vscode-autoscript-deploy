// @ts-nocheck
/* eslint-disable indent */

import * as fs from 'fs';
import * as path from 'path';

import { ProgressLocation, window, env, Uri, workspace, commands } from 'vscode';
import Logger from '../logger';

const LOG_SOURCE = 'ExtractObjectsCommand';

export default async function extractObjectCommand(client) {
    Logger.info('Extract Maximo JSON command requested.', LOG_SOURCE);
    const quickPick = window.createQuickPick();
    quickPick.step = 1;
    quickPick.totalSteps = 2;
    quickPick.title = 'Step 1: Select the type to extract';
    quickPick.placeholder = 'Select the type to extract';

    quickPick.items = [
        {
            label: 'Actions',
            group: 'actions',
            sort: (a, b) => {
                const groupCompare = a.action.localeCompare(b.action);
                if (groupCompare !== 0) return groupCompare;
                return a.action.localeCompare(b.action);
            },
            filter: (a1, a2) => {
                return [...a1, ...a2.filter((b) => !a1.some((a) => a.action === b.action))];
            },
        },
        {
            label: 'Cron Tasks',
            group: 'cronTasks',
            sort: (a, b) => {
                const groupCompare = a.cronTaskName.localeCompare(b.cronTaskName);
                if (groupCompare !== 0) return groupCompare;
                return a.cronTaskName.localeCompare(b.cronTaskName);
            },
            filter: (a1, a2) => {
                return [...a1, ...a2.filter((b) => !a1.some((a) => a.cronTaskName === b.cronTaskName))];
            },
        },
        {
            label: 'Escalations',
            group: 'escalations',
            sort: (a, b) => {
                const groupCompare = a.escalation.localeCompare(b.escalation);
                if (groupCompare !== 0) return groupCompare;
                return a.escalation.localeCompare(b.escalation);
            },
            filter: (a1, a2) => {
                return [...a1, ...a2.filter((b) => !a1.some((a) => a.escalation === b.escalation))];
            },
        },
        {
            label: 'Domains',
            group: 'domains',
            sort: (a, b) => {
                const groupCompare = a.domainId.localeCompare(b.domainId);
                if (groupCompare !== 0) return groupCompare;
                return a.domainId.localeCompare(b.domainId);
            },
            filter: (a1, a2) => {
                return [...a1, ...a2.filter((b) => !a1.some((a) => a.domainId === b.domainId))];
            },
        },
        {
            label: 'Integration Objects',
            group: 'integrationObjects',
            sort: (a, b) => {
                const groupCompare = a.intObjectName.localeCompare(b.intObjectName);
                if (groupCompare !== 0) return groupCompare;
                return a.intObjectName.localeCompare(b.intObjectName);
            },
            filter: (a1, a2) => {
                return [...a1, ...a2.filter((b) => !a1.some((a) => a.intObjectName === b.intObjectName))];
            },
        },
        {
            label: 'Loggers',
            group: 'loggers',
            sort: (a, b) => {
                const groupCompare = a.logger.localeCompare(b.logger);
                if (groupCompare !== 0) return groupCompare;
                return a.logger.localeCompare(b.logger);
            },
            filter: (a1, a2) => {
                return [...a1, ...a2.filter((b) => !a1.some((a) => a.logger === b.logger))];
            },
        },
        {
            label: 'Messages',
            group: 'messages',
            sort: (a, b) => {
                const groupCompare = a.msgGroup.localeCompare(b.msgGroup);
                if (groupCompare !== 0) return groupCompare;
                return a.msgKey.localeCompare(b.msgKey);
            },
            filter: (a1, a2) => {
                return [...a1, ...a2.filter((b) => !a1.some((a) => a.msgGroup === b.msgGroup && a.msgKey === b.msgKey))];
            },
        },
        {
            label: 'Properties',
            group: 'properties',
            sort: (a, b) => {
                const groupCompare = a.propName.localeCompare(b.propName);
                if (groupCompare !== 0) return groupCompare;
                return a.propName.localeCompare(b.propName);
            },
            filter: (a1, a2) => {
                return [...a1, ...a2.filter((b) => !a1.some((a) => a.propName === b.propName))];
            },
        },
        {
            label: 'Queries',
            group: 'queries',
            sort: (a, b) => {
                const appCompare = a.app.localeCompare(b.app);
                if (appCompare !== 0) return appCompare;
                const nameCompare = a.clauseName.localeCompare(b.clauseName);
                if (nameCompare !== 0) return nameCompare;
                return a.owner.localeCompare(b.owner);
            },
            filter: (a1, a2) => {
                return [
                    ...a1,
                    ...a2.filter((b) => !a1.some((a) => a.app === b.app && a.clauseName === b.clauseName && a.owner === b.owner)),
                ];
            },
        },
    ];

    quickPick.onDidAccept(async () => {
        const selection = quickPick.selectedItems[0];
        if (!selection) {
            Logger.info('Extract Maximo JSON command cancelled without selecting a type.', LOG_SOURCE);
            return;
        }
        Logger.info(`Selected ${selection.label} for JSON extraction.`, LOG_SOURCE);

        let selectedObjects = await displayObjectList(client, selection.group, selection.label);
        let results = [];

        if (typeof selectedObjects !== 'undefined' && Array.isArray(selectedObjects) && selectedObjects.length > 0) {
            const selectedLabels = selectedObjects.map((obj) => obj.label).join(', ');
            Logger.info(`Extracting ${selectedObjects.length} ${selection.label.toLowerCase()} item(s): ${selectedLabels}.`, LOG_SOURCE);
            let cancelled = false;
            await window.withProgress(
                {
                    // Display the progress in a notification toast
                    location: ProgressLocation.Notification,
                    // Set a title for the progress notification
                    title: `Extracting ${selection.label}`,
                    // Make it cancellable
                    cancellable: true,
                },
                async (progress, token) => {
                    let total = selectedObjects.length;
                    let i = 0;

                    let increment = Math.round(100 / total);
                    for (var obj of selectedObjects) {
                        if (token.isCancellationRequested) {
                            cancelled = true;
                            break; // Exit the loop if the user cancelled.
                        }

                        let result = await client.getObjectDetail(selection.group.toLowerCase(), obj.id);
                        if (result != null) {
                            results.push(result);
                        }

                        i++;
                        progress.report({
                            increment: increment,
                            message: `${i} of ${total}`,
                        });
                    }
                }
            );

            if (!cancelled && results.length > 0) {
                Logger.info(`Extracted ${results.length} ${selection.label.toLowerCase()} item(s).`, LOG_SOURCE);
                const editor = window.activeTextEditor;

                if (editor) {
                    const document = await editor.document;
                    const documentPath = document.fileName;
                    const folderPath = path.dirname(documentPath);
                    const ext = path.extname(documentPath).toLowerCase();
                    const baseName = path.basename(documentPath, ext);

                    let jsonPath;
                    if (ext === '.json') {
                        const jsFile = path.join(folderPath, baseName + '.js');
                        const pyFile = path.join(folderPath, baseName + '.py');
                        const jyFile = path.join(folderPath, baseName + '.jy');

                        if (fs.existsSync(jsFile) || fs.existsSync(pyFile) || fs.existsSync(jyFile)) {
                            jsonPath = path.join(documentPath);
                        }
                    } else if (ext === '.js' || ext === '.py' || ext === '.jy') {
                        jsonPath = path.join(folderPath, baseName + '.json');
                    }

                    if (jsonPath) {
                        if (fs.existsSync(jsonPath)) {
                            try {
                                const text = fs.readFileSync(jsonPath, 'utf8');
                                if (isBlank(text)) {
                                    const config = {
                                        [selection.group]: results,
                                    };
                                    fs.writeFileSync(jsonPath, JSON.stringify(config, null, 4), 'utf8');
                                } else {
                                    let json = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

                                    if (json[selection.group]) {
                                        if (Array.isArray(json[selection.group])) {
                                            if (typeof selection.filter == 'function') {
                                                json[selection.group] = selection.filter(results, json[selection.group]);
                                            } else {
                                                json[selection.group].push(...results);
                                            }

                                            if (typeof selection.sort == 'function') {
                                                json[selection.group].sort(selection.sort);
                                            }
                                        } else {
                                            copyToClipboard(results, `Copied extracted ${selection.label} to the clipboard.`);
                                        }
                                    } else {
                                        json[selection.group] = results;
                                    }
                                    fs.writeFileSync(jsonPath, JSON.stringify(sortObjectKeys(json), null, 4), 'utf8');
                                }
                            } catch (e) {
                                copyToClipboard(results, `Copied extracted ${selection.label} to the clipboard.`);
                            }
                        } else {
                            const config = {
                                [selection.group]: results,
                            };
                            fs.writeFileSync(jsonPath, JSON.stringify(config, null, 4), 'utf8');
                        }

                        // Close any existing editor for this file
                        const openEditors = window.visibleTextEditors;
                        for (const editor of openEditors) {
                            if (editor.document.fileName === jsonPath) {
                                await window.showTextDocument(editor.document);
                                await commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
                                break;
                            }
                        }

                        // Open the file fresh from disk
                        const uri = Uri.file(jsonPath);

                        workspace.openTextDocument(uri).then((doc) => {
                            window.showTextDocument(doc, { preview: false, preserveFocus: false }).then(() => {
                                const editor = window.activeTextEditor;
                                if (editor) {
                                    commands.executeCommand('editor.action.formatDocument').then(() => {
                                        editor.document.save();
                                    });
                                }
                            });
                        });
                    } else {
                        Logger.info(`Copied extracted ${selection.label} to the clipboard.`, LOG_SOURCE);
                        copyToClipboard(results, `Copied extracted ${selection.label} to the clipboard.`);
                    }
                } else {
                    Logger.info(`Copied extracted ${selection.label} to the clipboard.`, LOG_SOURCE);
                    copyToClipboard(results, `Copied extracted ${selection.label} to the clipboard.`);
                }
            } else if (cancelled) {
                Logger.info(`Extract ${selection.label} command was cancelled.`, LOG_SOURCE);
            }
        } else {
            Logger.info(`Extract ${selection.label} command cancelled without selecting objects.`, LOG_SOURCE);
        }
    });

    quickPick.show();
}

function isBlank(str) {
    return !str || /^\s*$/.test(str);
}

function sortObjectKeys(obj) {
    var sorted = {};
    Object.keys(obj)
        .sort()
        .forEach(function (key) {
            sorted[key] = obj[key];
        });
    return sorted;
}

async function copyToClipboard(text, message) {
    // `text` may be an actual object/array (as passed from the extract flow) or a
    // string that may or may not contain JSON. Normalize to the string we want on
    // the clipboard before writing.
    let clipboardText;
    const value = typeof text === 'string' ? tryParseJson(text) : text;

    if (value !== null && typeof value === 'object') {
        if (Array.isArray(value)) {
            // Strip the outer array brackets so the entries can be pasted into an
            // existing JSON array.
            clipboardText = JSON.stringify(value, null, 4).slice(1, -1);
        } else {
            clipboardText = JSON.stringify(value, null, 4);
        }
    } else {
        clipboardText = String(text);
    }

    await env.clipboard.writeText(clipboardText);

    if (message) {
        window.showInformationMessage(message, { modal: true });
    }
}

function tryParseJson(text) {
    try {
        return JSON.parse(text);
    } catch (e) {
        return text;
    }
}

/**
 * STEP 2: The multi-select quick pick with a loading indicator.
 * This is triggered if the user selects the "Advanced..." option in step 1.
 */
async function displayObjectList(client, objectType, label) {
    const quickPick = window.createQuickPick();
    quickPick.step = 2;
    quickPick.totalSteps = 2;
    quickPick.canSelectMany = true;
    quickPick.title = `Step 2: Select ${label.toLowerCase()} from the list`;
    quickPick.matchOnDescription = true;

    // --- Show loading state ---
    quickPick.placeholder = `Getting ${label.toLowerCase()}\u2026`;
    quickPick.busy = true;
    quickPick.show();

    const objects = await client.getObjectList(objectType);

    if (objects != null && Array.isArray(objects)) {
        var items = objects.map((obj) => {
            return {
                label: obj.label,
                description: obj.description,
                id: obj.id,
            };
        });

        items.sort((a, b) => a.label.localeCompare(b.label));

        quickPick.items = items;
    }
    quickPick.placeholder = `Select all ${label.toLowerCase()}`;
    quickPick.busy = false;

    // --- Wait for user interaction (selection or cancellation) ---
    return new Promise((resolve) => {
        quickPick.onDidAccept(() => {
            resolve([...quickPick.selectedItems]);
            quickPick.dispose();
        });
        quickPick.onDidHide(() => {
            // Resolve with `undefined` if the user cancelled the picker.
            // The `onDidAccept` handler will have already resolved the promise
            // if the user confirmed their selection.
            resolve(undefined);
            quickPick.dispose();
        });
    });
}
