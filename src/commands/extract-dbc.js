// @ts-nocheck
/* eslint-disable indent */

import * as fs from 'fs';
import * as path from 'path';

import { ProgressLocation, window, Uri, workspace, commands } from 'vscode';
import { getMaximoConfig } from '../extension';
import Logger from '../logger';
import vscodeUi from '../vscode-ui.js';
import { DBC_TYPES, extractDbc, sanitizeFileName } from '../core/extract/extract-dbc.js';
import { prepareExtractFolder } from '../core/extract/extract-support.js';

const LOG_SOURCE = 'ExtractDBCCommand';

export default async function extractDBCCommand(client) {
    Logger.info('Extract DBC command requested.', LOG_SOURCE);
    const extractLoc = prepareExtractFolder(vscodeUi, (await getMaximoConfig()).extractLocationDBC, workspace.workspaceFolders?.[0]?.uri.fsPath, 'DBC files', LOG_SOURCE);
    if (!extractLoc) {
        return;
    }

    const quickPick = window.createQuickPick();
    quickPick.step = 1;
    quickPick.totalSteps = 3;
    quickPick.title = 'Step 1: Select the type to extract';
    quickPick.placeholder = 'Select the type to extract';

    const items = DBC_TYPES.map((type) => ({ ...type }));

    items.sort((a, b) => a.label.localeCompare(b.label));
    quickPick.items = items;

    quickPick.onDidAccept(async () => {
        const selection = quickPick.selectedItems[0];
        if (!selection) {
            Logger.info('Extract DBC command cancelled without selecting a type.', LOG_SOURCE);
            return;
        }
        Logger.info(`Selected ${selection.label} for DBC extraction.`, LOG_SOURCE);

        let selectedObjects;

        if (selection.group === 'attribute') {
            selectedObjects = await displayObjectList(client, 'object', 'Object', 'Objects', false, 4);
            if (typeof selectedObjects !== 'undefined' && Array.isArray(selectedObjects) && selectedObjects.length === 1) {
                selectedObjects = await displayAttributeList(client, selectedObjects[0].label);
            }
        } else if (selection.group === 'byos' || selection.group === 'table') {
            selectedObjects = await displayObjectList(client, selection.group, selection.label, selection.plural, false);
        } else {
            selectedObjects = await displayObjectList(client, selection.group, selection.plural, selection.plural);
        }

        if (typeof selectedObjects !== 'undefined' && Array.isArray(selectedObjects) && selectedObjects.length > 0) {
            let fileName = await getFileName(selection.group, selection.group === 'attribute' ? 4 : 3);

            let where = null;
            if (fileName) {
                Logger.info(`Extracting ${selectedObjects.length} ${selection.plural.toLowerCase()} to ${fileName}.`, LOG_SOURCE);
                if (selection.group === 'byos' || selection.group === 'table') {
                    where = await window.showInputBox({
                        prompt: 'Please a where clause for the records to extract:',
                        placeHolder: 'sql where clause',
                        validateInput: (text) => {
                            if (text.length === 0) {
                                return 'Where clause cannot be empty.';
                            }
                            return null;
                        },
                    });
                }

                await window.withProgress(
                    {
                        // Display the progress in a notification toast
                        location: ProgressLocation.Notification,
                        // Set a title for the progress notification
                        title: `Extracting ${selection.plural.toLowerCase()} to ${fileName}\u2026`,
                    },
                    async () => {
                        try {
                            const filePath = await extractDbc(
                                client,
                                { group: selection.group, objects: selectedObjects, fileName, where, label: selection.label, plural: selection.plural },
                                extractLoc
                            );

                            // Close any existing editor for this file
                            const openEditors = window.visibleTextEditors;
                            for (const editor of openEditors) {
                                if (editor.document.fileName === filePath) {
                                    await window.showTextDocument(editor.document);
                                    await commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
                                    break;
                                }
                            }

                            // Open the file fresh from disk
                            const uri = Uri.file(filePath);

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
                        } catch (error) {
                            Logger.error(`Error extracting DBC to ${fileName}.`, error, LOG_SOURCE);
                            window.showErrorMessage(error.message.startsWith('Error extracting DBC:') ? error.message : 'Error extracting DBC:\n' + error.message, { modal: true });
                        }
                    }
                );
            } else {
                Logger.info('Extract DBC command cancelled without selecting an output file.', LOG_SOURCE);
            }
        } else {
            Logger.info(`Extract ${selection.label} command cancelled without selecting objects.`, LOG_SOURCE);
        }
    });

    quickPick.show();
}

async function getFileName(fileType, totalSteps = 3) {
    const editor = window.activeTextEditor;
    let folderPath;

    if (editor) {
        folderPath = path.dirname(editor.document.fileName);
    } else if (workspace.workspaceFolders && workspace.workspaceFolders.length > 0) {
        // Fallback to workspace root
        folderPath = workspace.workspaceFolders[0].uri.fsPath;
    } else {
        Logger.error('No workspace folder or active editor found to determine DBC file location.', null, LOG_SOURCE);
        window.showErrorMessage('No workspace folder or active editor found to determine file location.', { modal: true });
        return undefined;
    }

    const dbcFiles =
        fileType == 'msg'
            ? fs
                  .readdirSync(folderPath)
                  .filter(
                      (file) =>
                          path.extname(file).toLowerCase() === '.msg' ||
                          path.extname(file).toLowerCase() === '.ora' ||
                          path.extname(file).toLowerCase() === '.db2' ||
                          path.extname(file).toLowerCase() === '.sqs'
                  )
                  .map((file) => path.basename(file))
            : fileType == 'object' || fileType == 'attribute'
            ? fs.readdirSync(folderPath).filter((file) => path.extname(file).toLowerCase() === '.dbc')
            : fs
                  .readdirSync(folderPath)
                  .filter(
                      (file) =>
                          path.extname(file).toLowerCase() === '.dbc' ||
                          path.extname(file).toLowerCase() === '.ora' ||
                          path.extname(file).toLowerCase() === '.db2' ||
                          path.extname(file).toLowerCase() === '.sqs'
                  )
                  .map((file) => path.basename(file));

    const items = dbcFiles.map((file) => {
        return {
            label: file,
        };
    });

    const quickPick = window.createQuickPick();
    quickPick.step = totalSteps;
    quickPick.totalSteps = totalSteps;
    quickPick.canSelectMany = false;
    quickPick.title = `Step ${totalSteps}: Select a ${
        fileType == 'msg' ? 'msg, db2, ora, or sqs' : fileType == 'object' || fileType == 'attribute' ? 'dbc' : 'dbc, db2, ora, or sqs'
    } file from the list`;
    quickPick.items = items;
    quickPick.show();

    let newFileItem;

    quickPick.onDidChangeValue((value) => {
        const fileExists = items.some((item) => item.label === value);
        if (value && !fileExists) {
            newFileItem = { label: `$(add) Create file: ${value}`, description: 'Create a new file\u2026' };
            quickPick.items = [newFileItem, ...items];
        } else {
            newFileItem = undefined;
            quickPick.items = items; // Reset to the original list
        }
    });

    return new Promise((resolve) => {
        quickPick.onDidAccept(() => {
            const selectedItem = quickPick.selectedItems[0];
            let fileName;

            if (selectedItem === newFileItem) {
                // User chose to create a new file
                fileName = quickPick.value;

                if (fileType != 'msg') {
                    if (
                        path.extname(fileName).toLowerCase() !== '.dbc' &&
                        path.extname(fileName).toLowerCase() !== '.ora' &&
                        path.extname(fileName).toLowerCase() !== '.db2' &&
                        path.extname(fileName).toLowerCase() !== '.sqs'
                    ) {
                        fileName += '.dbc';
                    }
                } else if (fileType == 'object') {
                    if (path.extname(fileName).toLowerCase() !== '.dbc') {
                        fileName += '.dbc';
                    }
                } else {
                    if (
                        path.extname(fileName).toLowerCase() !== '.msg' &&
                        path.extname(fileName).toLowerCase() !== '.ora' &&
                        path.extname(fileName).toLowerCase() !== '.db2' &&
                        path.extname(fileName).toLowerCase() !== '.sqs'
                    ) {
                        fileName += '.msg';
                    }
                }
                resolve(sanitizeFileName(fileName));
            } else {
                // User selected an existing file
                resolve(selectedItem.label);
            }
            quickPick.dispose();
        });

        quickPick.onDidHide(() => {
            resolve(undefined);
            quickPick.dispose();
        });
    });
}

async function displayAttributeList(client, objectName) {
    const quickPick = window.createQuickPick();
    quickPick.step = 3;
    quickPick.totalSteps = 4;
    quickPick.canSelectMany = true;
    quickPick.title = `Step 3: Select attributes from ${objectName}`;
    quickPick.matchOnDescription = true;

    // --- Show loading state ---
    quickPick.placeholder = `Getting attributes for ${objectName}\u2026`;
    quickPick.busy = true;
    quickPick.show();

    const attributes = await client.getDBCAttributeList(objectName);

    if (attributes != null && Array.isArray(attributes)) {
        var items = attributes.map((obj) => {
            return {
                label: obj.label,
                description: obj.description,
                id: obj.id,
            };
        });

        items.sort((a, b) => a.label.localeCompare(b.label));

        quickPick.items = items;
    }

    quickPick.placeholder = 'Select all attributes';
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

async function displayObjectList(client, objectType, label, plural, allowMany = true, stepCount = 3) {
    const quickPick = window.createQuickPick();
    quickPick.step = 2;
    quickPick.totalSteps = stepCount;
    quickPick.canSelectMany = allowMany;

    quickPick.title = allowMany
        ? `Step 2: Select ${plural.toLowerCase()} from the list`
        : `Step 2: Select ${
              label.toLowerCase().startsWith('a') ||
              label.toLowerCase().startsWith('e') ||
              label.toLowerCase().startsWith('i') ||
              label.toLowerCase().startsWith('o') ||
              label.toLowerCase().startsWith('u')
                  ? 'an'
                  : 'a'
          } ${label.toLowerCase()} from the list`;
    quickPick.matchOnDescription = true;

    // --- Show loading state ---
    quickPick.placeholder = `Getting ${plural.toLowerCase()}\u2026`;
    quickPick.busy = true;
    quickPick.show();

    const objects = await client.getDBCObjectList(objectType);

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

    quickPick.placeholder = allowMany
        ? `Select all ${label.toLowerCase()}`
        : `Select ${
              label.toLowerCase().startsWith('a') ||
              label.toLowerCase().startsWith('e') ||
              label.toLowerCase().startsWith('i') ||
              label.toLowerCase().startsWith('o') ||
              label.toLowerCase().startsWith('u')
                  ? 'an'
                  : 'a'
          } ${label.toLowerCase()}`;
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
