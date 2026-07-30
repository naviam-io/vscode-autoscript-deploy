/* eslint-disable no-undef */
// @ts-nocheck
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export const onFileDelete = vscode.workspace.onDidDeleteFiles(async (event) => {
    for (const fileUri of event.files) {
        removeFileMatch(vscode.workspace.getWorkspaceFolder(fileUri), path.basename(fileUri.path));
    }
});

export const onFileRename = vscode.workspace.onDidRenameFiles((event) => {
    for (const fileUri of event.files) {
        handleFile(fileUri.newUri, fileUri.oldUri);
    }
});

export const onDidOpenTextDocument = vscode.workspace.onDidOpenTextDocument((document) => {
    if (document.fileName.endsWith('.predeploy.json') || document.fileName.endsWith('-predeploy.json') || document.fileName.endsWith('devtools-config.json')) {
        setupSchemaSupport(vscode.workspace.getWorkspaceFolder(document.uri));
    } else if (document.fileName.endsWith('.json')) {
        let nameWithoutExt = path.basename(document.uri.path, '.json');
        var directory = path.dirname(document.uri.path);
        const jsFile = path.join(directory, nameWithoutExt + '.js');
        const pyFile = path.join(directory, nameWithoutExt + '.py');
        const jyFile = path.join(directory, nameWithoutExt + '.jy');
        if (fs.existsSync(jsFile) || fs.existsSync(pyFile) || fs.existsSync(jyFile)) {
            setupSchemaSupport(vscode.workspace.getWorkspaceFolder(document.uri), path.basename(document.fileName));
        }
    } else if (document.fileName.endsWith('.dbc')) {
        const dtd = path.join(path.dirname(document.uri.fsPath), 'script.dtd');

        setupDBCSchemaSupport(vscode.workspace.getWorkspaceFolder(document.uri), dtd);
    }
});

// Register a listener for when files are created in the workspace
export const onDidCreateFiles = vscode.workspace.onDidCreateFiles(async (event) => {
    // Define the file naming pattern you want to watch for.
    // This regex looks for files ending in ".deploy.json" or "-deploy.json"

    for (const fileUri of event.files) {
        handleFile(fileUri);
    }
});

async function handleFile(fileUri, oldFileUri) {
    // Check if the newly created file's path ends ".deploy.json" or "-deploy.json"
    if (fileUri.path.endsWith('.predeploy.json') || fileUri.path.endsWith('-predeploy.json') || fileUri.path.endsWith('devtools-config.json')) {
        // Let the user know we've detected the file
        vscode.window.showInformationMessage(`Detected new component: ${path.basename(fileUri.fsPath)}`);

        setupSchemaSupport(vscode.workspace.getWorkspaceFolder(fileUri));
    } else if (fileUri.path.endsWith('.json')) {
        let nameWithoutExt = path.basename(fileUri.path, '.json');
        var directory = path.dirname(fileUri.path);
        const jsFile = path.join(directory, nameWithoutExt + '.js');
        const pyFile = path.join(directory, nameWithoutExt + '.py');
        const jyFile = path.join(directory, nameWithoutExt + '.jy');
        if (fs.existsSync(jsFile) || fs.existsSync(pyFile) || fs.existsSync(jyFile)) {
            setupSchemaSupport(vscode.workspace.getWorkspaceFolder(fileUri), path.basename(fileUri.path));
        } else if (oldFileUri) {
            removeFileMatch(vscode.workspace.getWorkspaceFolder(oldFileUri), path.basename(oldFileUri.path));
        }
    }
}

async function removeFileMatch(workspaceFolder, fileName) {
    const config = vscode.workspace.getConfiguration(null, workspaceFolder);

    const schemas = config.get('json.schemas') || [];

    if (fileName) {
        const fileSchema = schemas.find((s) => s.url === './.vscode/deploy-schema.json');

        if (fileSchema) {
            fileSchema.fileMatch = fileSchema.fileMatch.filter((f) => f != fileName);

            await config.update('json.schemas', schemas, vscode.ConfigurationTarget.Workspace);
        }
    }
}

async function setupDBCSchemaSupport(workspaceFolder, dtd) {
    const config = vscode.workspace.getConfiguration(null, workspaceFolder);

    const fileAssociations = config.get('files.associations') || [];

    if (!Object.prototype.hasOwnProperty.call(fileAssociations, '*.dbc')) {
        fileAssociations['*.dbc'] = 'xml';
        await config.update('files.associations', fileAssociations, vscode.ConfigurationTarget.Workspace);
    }

    if (!fs.existsSync(dtd)) {
        fs.copyFile(path.resolve(__dirname, '../schemas/script.dtd'), path.resolve(dtd), (err) => {
            if (err) {
                vscode.window.showErrorMessage(`Failed to copy script.dtd file: ${err.message}`);
            }
        });
    }
}

function copySchema(schemaName, workspaceFolder) {
    const source = path.resolve(__dirname, '../schemas/' + schemaName);
    const destination = path.resolve(workspaceFolder.uri.fsPath, './.vscode/' + schemaName);

    try {
        if (!fs.existsSync(source)) {
            return;
        }

        const sourceContent = fs.readFileSync(source);

        // Always refresh the workspace copy when the bundled schema changes so that
        // schema updates from an extension upgrade are picked up. The copy is otherwise
        // registered only once and would remain stale after the extension is upgraded.
        if (fs.existsSync(destination) && sourceContent.equals(fs.readFileSync(destination))) {
            return;
        }

        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, sourceContent);
    } catch (err) {
        vscode.window.showErrorMessage(`Failed to copy schema file ${schemaName}: ${err.message}`);
    }
}

async function setupSchemaSupport(workspaceFolder, fileName) {
    const config = vscode.workspace.getConfiguration(null, workspaceFolder);

    const schemas = config.get('json.schemas') || [];

    copySchema('predeploy-schema.json', workspaceFolder);
    if (!schemas.find((s) => s.url === './.vscode/predeploy-schema.json')) {
        schemas.push({
            fileMatch: ['*.predeploy.json', '*-predeploy.json'],
            url: './.vscode/predeploy-schema.json'
        });
        await config.update('json.schemas', schemas, vscode.ConfigurationTarget.Workspace);
    }

    copySchema('deploy-schema.json', workspaceFolder);
    if (!schemas.find((s) => s.url === './.vscode/deploy-schema.json')) {
        schemas.push({
            fileMatch: [],
            url: './.vscode/deploy-schema.json'
        });
        await config.update('json.schemas', schemas, vscode.ConfigurationTarget.Workspace);
    }

    copySchema('devtools-config-schema.json', workspaceFolder);
    if (!schemas.find((s) => s.url === './.vscode/devtools-config-schema.json')) {
        schemas.push({
            fileMatch: ['.devtools-config.json'],
            url: './.vscode/devtools-config-schema.json'
        });
        await config.update('json.schemas', schemas, vscode.ConfigurationTarget.Workspace);
    }

    if (fileName) {
        const fileSchema = schemas.find((s) => s.url === './.vscode/deploy-schema.json');

        if (fileSchema) {
            if (!fileSchema.fileMatch.includes(fileName)) {
                fileSchema.fileMatch.push(fileName);
                await config.update('json.schemas', schemas, vscode.ConfigurationTarget.Workspace);
            }
        }
    }
}
