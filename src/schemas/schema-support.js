/* eslint-disable no-undef */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export const onFileDelete = vscode.workspace.onDidDeleteFiles(async (event) => {
    for (const fileUri of event.files) {
        removeFileMatch(
            vscode.workspace.getWorkspaceFolder(fileUri),
            path.basename(fileUri.path)
        );
    }
});

export const onFileRename = vscode.workspace.onDidRenameFiles((event) => {
    for (const fileUri of event.files) {
        handleFile(fileUri.newUri, fileUri.oldUri);
    }
});

export const onDidOpenTextDocument = vscode.workspace.onDidOpenTextDocument(
    (document) => {
        if (
            document.fileName.endsWith('.predeploy.json') ||
            document.fileName.endsWith('-predeploy.json') ||
            document.fileName.endsWith('devtools-config.json')
        ) {
            setupSchemaSupport(
                vscode.workspace.getWorkspaceFolder(document.uri)
            );
        } else if (document.fileName.endsWith('.json')) {
            let nameWithoutExt = path.basename(document.uri.path, '.json');
            var directory = path.dirname(document.uri.path);
            const jsFile = path.join(directory, nameWithoutExt + '.js');
            const pyFile = path.join(directory, nameWithoutExt + '.py');
            const jyFile = path.join(directory, nameWithoutExt + '.jy');
            if (
                fs.existsSync(jsFile) ||
                fs.existsSync(pyFile) ||
                fs.existsSync(jyFile)
            ) {
                setupSchemaSupport(
                    vscode.workspace.getWorkspaceFolder(document.uri),
                    path.basename(document.fileName)
                );
            }
        }
    }
);

// Register a listener for when files are created in the workspace
export const onDidCreateFiles = vscode.workspace.onDidCreateFiles(
    async (event) => {
        // Define the file naming pattern you want to watch for.
        // This regex looks for files ending in ".deploy.json" or "-deploy.json"

        for (const fileUri of event.files) {
            handleFile(fileUri);
        }
    }
);

async function handleFile(fileUri, oldFileUri) {
    // Check if the newly created file's path ends ".deploy.json" or "-deploy.json"
    if (
        fileUri.path.endsWith('.predeploy.json') ||
        fileUri.path.endsWith('-predeploy.json') ||
        fileUri.path.endsWith('devtools-config.json')
    ) {
        // Let the user know we've detected the file
        vscode.window.showInformationMessage(
            `Detected new component: ${path.basename(fileUri.fsPath)}`
        );

        setupSchemaSupport(vscode.workspace.getWorkspaceFolder(fileUri));
    } else if (fileUri.path.endsWith('.json')) {
        let nameWithoutExt = path.basename(fileUri.path, '.json');
        var directory = path.dirname(fileUri.path);
        const jsFile = path.join(directory, nameWithoutExt + '.js');
        const pyFile = path.join(directory, nameWithoutExt + '.py');
        const jyFile = path.join(directory, nameWithoutExt + '.jy');
        if (
            fs.existsSync(jsFile) ||
            fs.existsSync(pyFile) ||
            fs.existsSync(jyFile)
        ) {
            setupSchemaSupport(
                vscode.workspace.getWorkspaceFolder(fileUri),
                path.basename(fileUri.path)
            );
        } else if (oldFileUri) {
            removeFileMatch(
                vscode.workspace.getWorkspaceFolder(oldFileUri),
                path.basename(oldFileUri.path)
            );
        }
    }
}

async function removeFileMatch(workspaceFolder, fileName) {
    const config = vscode.workspace.getConfiguration(null, workspaceFolder);

    const schemas = config.get('json.schemas') || [];

    if (fileName) {
        const fileSchema = schemas.find(
            (s) => s.url === './.vscode/deploy-schema.json'
        );

        if (fileSchema) {
            fileSchema.fileMatch = fileSchema.fileMatch.filter(
                (f) => f != fileName
            );

            await config.update(
                'json.schemas',
                schemas,
                vscode.ConfigurationTarget.Workspace
            );
        }
    }
}

async function setupSchemaSupport(workspaceFolder, fileName) {
    const config = vscode.workspace.getConfiguration(null, workspaceFolder);

    const schemas = config.get('json.schemas') || [];

    if (!schemas.find((s) => s.url === './.vscode/predeploy-schema.json')) {
        schemas.push({
            fileMatch: ['*.predeploy.json', '*-predeploy.json'],
            url: './.vscode/predeploy-schema.json',
        });
        await config.update(
            'json.schemas',
            schemas,
            vscode.ConfigurationTarget.Workspace
        );
        fs.copyFile(
            path.resolve(__dirname, '../schemas/predeploy-schema.json'),
            path.resolve(
                workspaceFolder.uri.fsPath,
                './.vscode/predeploy-schema.json'
            ),
            (err) => {
                if (err) {
                    vscode.window.showErrorMessage(
                        `Failed to copy config file: ${err.message}`
                    );
                }
            }
        );
    }
    if (!schemas.find((s) => s.url === './.vscode/deploy-schema.json')) {
        schemas.push({
            fileMatch: [],
            url: './.vscode/deploy-schema.json',
        });
        await config.update(
            'json.schemas',
            schemas,
            vscode.ConfigurationTarget.Workspace
        );
        fs.copyFile(
            path.resolve(__dirname, '../schemas/deploy-schema.json'),
            path.resolve(
                workspaceFolder.uri.fsPath,
                './.vscode/deploy-schema.json'
            ),
            (err) => {
                if (err) {
                    vscode.window.showErrorMessage(
                        `Failed to copy config file: ${err.message}`
                    );
                }
            }
        );
    }
    if (
        !schemas.find((s) => s.url === './.vscode/devtools-config-schema.json')
    ) {
        schemas.push({
            fileMatch: ['.devtools-config.json'],
            url: './.vscode/devtools-config-schema.json',
        });
        await config.update(
            'json.schemas',
            schemas,
            vscode.ConfigurationTarget.Workspace
        );
        fs.copyFile(
            path.resolve(__dirname, '../schemas/devtools-config-schema.json'),
            path.resolve(
                workspaceFolder.uri.fsPath,
                './.vscode/devtools-config-schema.json'
            ),
            (err) => {
                if (err) {
                    vscode.window.showErrorMessage(
                        `Failed to copy config file: ${err.message}`
                    );
                }
            }
        );
    }

    if (fileName) {
        const fileSchema = schemas.find(
            (s) => s.url === './.vscode/deploy-schema.json'
        );

        if (fileSchema) {
            if (!fileSchema.fileMatch.includes(fileName)) {
                fileSchema.fileMatch.push(fileName);
                await config.update(
                    'json.schemas',
                    schemas,
                    vscode.ConfigurationTarget.Workspace
                );
            }
        }
    }
}
