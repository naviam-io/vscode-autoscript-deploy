// @ts-nocheck
/* eslint-disable indent */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { ProgressLocation, window, env, Uri, workspace, commands } from 'vscode';
import { getMaximoConfig } from '../extension';

export default async function extractDBCCommand(client) {
    let extractLoc = (await getMaximoConfig()).extractLocationDBC;
    // if the extract location has not been specified use the workspace folder.
    if (typeof extractLoc === 'undefined' || !extractLoc) {
        if (workspace.workspaceFolders !== undefined) {
            extractLoc = workspace.workspaceFolders[0].uri.fsPath;
        } else {
            window.showErrorMessage('A working folder must be selected or an export folder configured before exporting reports.', {
                modal: true,
            });
            return;
        }
    }

    if (extractLoc.startsWith('~')) {
        extractLoc = path.join(os.homedir(), extractLoc.slice(1));
    } else if ((extractLoc.startsWith('./') || extractLoc.startsWith('.\\')) && workspace.workspaceFolders !== undefined) {
        extractLoc = path.join(workspace.workspaceFolders[0].uri.fsPath, extractLoc.slice(2));
    } else if (!path.isAbsolute(extractLoc) && workspace.workspaceFolders !== undefined) {
        extractLoc = path.join(workspace.workspaceFolders[0].uri.fsPath, extractLoc);
    }

    if (!fs.existsSync(extractLoc)) {
        fs.mkdirSync(extractLoc, { recursive: true });
    }

    const quickPick = window.createQuickPick();
    quickPick.step = 1;
    quickPick.totalSteps = 3;
    quickPick.title = 'Step 1: Select the type to extract';
    quickPick.placeholder = 'Select the type to extract';

    const items = [
        {
            label: 'Object Structure',
            group: 'os',
            plural: 'Object Structures',
        },
        {
            label: 'Table Data',
            group: 'table',
            plural: 'Tables',
        },
        {
            label: 'Publish Channel',
            group: 'pc',
            plural: 'Publish Channels',
        },
        {
            label: 'Enterprise Service',
            group: 'es',
            plural: 'Enterprise Services',
        },
        {
            label: 'Invocation Channel',
            group: 'ic',
            plural: 'Invocation Channels',
        },
        {
            label: 'Web Service',
            group: 'ws',
            plural: 'Web Services',
        },
        {
            label: 'End Point',
            group: 'ep',
            plural: 'End Points',
        },
        {
            label: 'External System',
            group: 'ex',
            plural: 'External Systems',
        },
        {
            label: 'Interaction',
            group: 'int',
            plural: 'Interactions',
        },
        {
            label: 'Automation Script',
            group: 'script',
            plural: 'Automation Scripts',
        },
        {
            label: 'Records by Object Structure',
            group: 'byos',
            plural: 'Records by Object Structures',
        },
        {
            label: 'Property',
            group: 'prop',
            plural: 'Properties',
        },
        {
            label: 'Message',
            group: 'msg',
            plural: 'Messages',
        },
        {
            label: 'Object',
            group: 'object',
            plural: 'Objects',
        },
        {
            label: 'Attribute',
            group: 'attribute',
            plural: 'Attributes',
        },
    ];

    items.sort((a, b) => a.label.localeCompare(b.label));
    quickPick.items = items;

    quickPick.onDidAccept(async () => {
        const selection = quickPick.selectedItems[0];
        if (!selection) {
            return;
        }

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
                        let objectList = selectedObjects.map((obj) => obj.label).join(',');
                        let objectListDisplay = selectedObjects.map((obj) => obj.label).join(', ');

                        if (selection.group === 'msg' || selection.group === 'attribute') {
                            where = selectedObjects.map((obj) => obj.id).join(',');
                        }
                        try {
                            var result = await client.getDBCObject(
                                selection.group,
                                objectList,
                                fileName,
                                where,
                                `Create ${selectedObjects.length > 1 ? selection.plural : selection.label} ${objectListDisplay}`
                            );
                            if (result && result.status === 'error') {
                                window.showErrorMessage('Error extracting DBC:\n' + result.message, { modal: true });
                            } else {
                                const filePath = path.join(extractLoc, fileName);

                                // Write content to file
                                fs.writeFileSync(filePath, result, 'utf8');

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
                            }
                        } catch (error) {
                            window.showErrorMessage('Error extracting DBC:\n' + error.message, { modal: true });
                        }
                    }
                );
            }
        }
    });

    quickPick.show();
}

function copyToClipboard(text, message) {
    if (isJsonObjectOrArray(text)) {
        if (Array.isArray(text)) {
            env.clipboard.writeText(JSON.stringify(text, null, 4).slice(1, -1));
        } else {
            env.clipboard.writeText(JSON.stringify(text, null, 4));
        }
    } else {
        env.clipboard.writeText(text);
    }

    if (message) {
        window.showInformationMessage(message, { modal: true });
    }
}

function isJsonObjectOrArray(text) {
    try {
        const parsed = JSON.parse(text);
        return typeof parsed === 'object' && parsed !== null;
    } catch (e) {
        return false;
    }
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

function sanitizeFileName(fileName) {
    // Remove invalid characters
    return (
        fileName
            // eslint-disable-next-line no-useless-escape
            .replace(/[<>:"|?*\\\/]/g, '_')
            // eslint-disable-next-line no-control-regex
            .replace(/[\x00-\x1f\x80-\x9f]/g, '_') // Control characters
            .replace(/^\.+$/, '_') // Don't allow only dots
            .replace(/\.$/, '_') // Don't end with period
            .trim()
    ); // Remove leading/trailing spaces
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
