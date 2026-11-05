// @ts-nocheck
/* eslint-disable indent */

import * as fs from 'fs';
import * as path from 'path';

import { window, env, Uri, workspace, commands } from 'vscode';
import Logger from '../logger';
import { CONFIGURATION_TYPES, fetchConfiguration, mergeConfiguration } from '../core/extract/extract-configuration.js';
import vscodeUi from '../vscode-ui.js';

const LOG_SOURCE = 'ExtractObjectsCommand';

export default async function extractObjectCommand(client) {
    Logger.info('Extract Maximo JSON command requested.', LOG_SOURCE);
    const quickPick = window.createQuickPick();
    quickPick.step = 1;
    quickPick.totalSteps = 2;
    quickPick.title = 'Step 1: Select the type to extract';
    quickPick.placeholder = 'Select the type to extract';

    quickPick.items = CONFIGURATION_TYPES.map((type) => ({ ...type }));

    quickPick.onDidAccept(async () => {
        const selection = quickPick.selectedItems[0];
        if (!selection) {
            Logger.info('Extract Maximo JSON command cancelled without selecting a type.', LOG_SOURCE);
            return;
        }
        Logger.info(`Selected ${selection.label} for JSON extraction.`, LOG_SOURCE);

        let selectedObjects = await displayObjectList(client, selection.group, selection.label);

        if (typeof selectedObjects !== 'undefined' && Array.isArray(selectedObjects) && selectedObjects.length > 0) {
            const selectedLabels = selectedObjects.map((obj) => obj.label).join(', ');
            Logger.info(`Extracting ${selectedObjects.length} ${selection.label.toLowerCase()} item(s): ${selectedLabels}.`, LOG_SOURCE);
            let results, cancelled;
            try {
                ({ results, cancelled } = await fetchConfiguration(client, vscodeUi, selection, selectedObjects));
            } catch (error) {
                Logger.error(`Error extracting ${selection.label.toLowerCase()}.`, error, LOG_SOURCE);
                window.showErrorMessage(`Error extracting ${selection.label.toLowerCase()}:\n${error.message}`, { modal: true });
                return;
            }

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
                        jsonPath = documentPath;
                    } else if (ext === '.js' || ext === '.py' || ext === '.jy') {
                        jsonPath = path.join(folderPath, baseName + '.json');
                    }

                    if (jsonPath) {
                        const merged = mergeConfiguration(fs.existsSync(jsonPath) ? fs.readFileSync(jsonPath, 'utf8') : '', selection, results);
                        if (merged === null) {
                            Logger.info(`${jsonPath} is not a configuration file, copied extracted ${selection.label} to the clipboard.`, LOG_SOURCE);
                            copyToClipboard(results, `Copied extracted ${selection.label} to the clipboard.`);
                            return;
                        }
                        fs.writeFileSync(jsonPath, merged, 'utf8');

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
