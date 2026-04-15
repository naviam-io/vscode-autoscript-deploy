/* eslint-disable no-undef */
import * as fs from 'fs';
import * as path from 'path';
import { window, workspace, ProgressLocation, Uri } from 'vscode';
import { execSync, exec } from 'child_process';

function toPascalCase(scriptName) {
    return scriptName
        .split('.')
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
        .join('');
}

export default async function initTsTemplateCommand() {
    if (!workspace.workspaceFolders || workspace.workspaceFolders.length === 0) {
        window.showErrorMessage('A workspace folder must be open to initialize a TypeScript project.', { modal: true });
        return;
    }

    const destRoot = workspace.workspaceFolders[0].uri.fsPath;
    const templateDir = path.resolve(__dirname, '../templates');

    // Verify the template directory exists within the extension.
    if (!fs.existsSync(templateDir)) {
        window.showErrorMessage('The template directory is missing from the extension installation. Please reinstall the extension.', { modal: true });
        return;
    }

    const copyFiles = [
        '.babelrc',
        'jsconfig.json',
        'package.json',
        'tsconfig.json',
        'nashorn.d.ts',
        'globals.d.ts',
        'runtime-globals.ts',
        'manage-declarations.d.ts',
        'maximo-facade.d.ts'
    ];
    const allTemplateFiles = [...copyFiles, 'webpack.config.js', path.join('src', 'index.ts')];

    const existing = allTemplateFiles.filter((file) => fs.existsSync(path.join(destRoot, file)));
    if (existing.length > 0) {
        window.showErrorMessage('Initialization cannot be completed: A project already exists in this directory.', { modal: true });
        return;
    }

    const scriptName = await window.showInputBox({
        prompt: 'Enter the Script Name (e.g. naviam.script.name)',
        placeHolder: 'naviam.script.name',
        validateInput: (value) => {
            if (!value || value.trim().length === 0) {
                return 'Script Name is required';
            }
            if (/\s/.test(value)) {
                return 'Script Name must not contain spaces';
            }
            return null;
        }
    });

    if (!scriptName) {
        return;
    }

    const description = await window.showInputBox({
        prompt: 'Enter the Script Description',
        placeHolder: 'A description of the script'
    });

    if (typeof description === 'undefined') {
        return;
    }

    const libraryName = toPascalCase(scriptName);

    let indexDest;
    try {
        for (const file of copyFiles) {
            const src = path.join(templateDir, file);
            const dest = path.join(destRoot, file);
            fs.copyFileSync(src, dest);
        }

        const manageZip = path.join(destRoot, 'manage.d.ts.zip');
        fs.copyFileSync(path.join(templateDir, 'manage.d.ts.zip'), manageZip);
        execSync(`unzip -o "${manageZip}" -d "${destRoot}"`);
        fs.unlinkSync(manageZip);

        // webpack.config.js — replace placeholders
        let webpackContent = fs.readFileSync(path.join(templateDir, 'webpack.config.js'), 'utf8');
        webpackContent = webpackContent.replace(/\{script_name\}/g, scriptName);
        webpackContent = webpackContent.replace(/\$\{library_name\}/g, libraryName);
        const webpackDest = path.join(destRoot, 'webpack.config.js');
        fs.writeFileSync(webpackDest, webpackContent, 'utf8');

        // index.ts → src/index.ts — replace placeholders
        const srcDir = path.join(destRoot, 'src');
        if (!fs.existsSync(srcDir)) {
            fs.mkdirSync(srcDir, { recursive: true });
        }
        let indexContent = fs.readFileSync(path.join(templateDir, 'index.ts'), 'utf8');
        indexContent = indexContent.replace(/\$\{script_name\}/g, scriptName);
        indexContent = indexContent.replace(/\$\{script_description\}/g, description);
        indexDest = path.join(srcDir, 'index.ts');
        fs.writeFileSync(indexDest, indexContent, 'utf8');
    } catch (error) {
        window.showErrorMessage(`Failed to write project files: ${error.message}`, { modal: true });
        return;
    }

    // Open the generated src/index.ts in the editor.
    const indexDoc = await workspace.openTextDocument(Uri.file(indexDest));
    await window.showTextDocument(indexDoc);

    window.showInformationMessage(`Maximo TypeScript project initialized for ${scriptName}.`, 5000);

    // Check if npm is available.
    let npmAvailable = false;
    const isWindows = process.platform === 'win32';
    const npmCmd = isWindows ? 'npm.cmd' : 'npm';
    try {
        execSync(`${npmCmd} --version`, { encoding: 'utf8', stdio: 'pipe' });
        npmAvailable = true;
    } catch {
        const install = await window.showWarningMessage(
            'npm is not installed. It is required to fetch project dependencies. Would you like to install it now?',
            'Install npm',
            'Cancel'
        );
        if (install === 'Install npm') {
            let canAutoInstall = true;
            if (!isWindows) {
                try {
                    execSync('brew --version', { encoding: 'utf8', stdio: 'pipe' });
                } catch {
                    canAutoInstall = false;
                }
            }

            if (!canAutoInstall) {
                window.showErrorMessage(
                    'npm could not be installed automatically because Homebrew is not available. Please install Node.js from https://nodejs.org before running the project.',
                    { modal: true }
                );
            } else {
                try {
                    const installCmd = isWindows ? 'winget install OpenJS.NodeJS.LTS' : 'brew install node';
                    await window.withProgress(
                        { title: 'Installing npm...', location: ProgressLocation.Notification },
                        () =>
                            new Promise((resolve, reject) => {
                                exec(installCmd, { encoding: 'utf8' }, (error) => {
                                    if (error) {
                                        reject(error);
                                    } else {
                                        resolve();
                                    }
                                });
                            })
                    );
                    npmAvailable = true;
                    window.showInformationMessage('npm installed successfully.');
                } catch (error) {
                    window.showErrorMessage('Failed to install npm automatically. Please install Node.js from https://nodejs.org and try again.', {
                        modal: true
                    });
                }
            }
        }
    }

    if (npmAvailable) {
        const runInstall = await window.showInformationMessage('Would you like to run npm install to fetch the required dependencies?', 'Yes', 'No');
        if (runInstall === 'Yes') {
            try {
                await window.withProgress(
                    { title: 'Running npm install...', location: ProgressLocation.Notification },
                    () =>
                        new Promise((resolve, reject) => {
                            exec(`${npmCmd} install`, { cwd: destRoot, encoding: 'utf8' }, (error) => {
                                if (error) {
                                    reject(error);
                                } else {
                                    resolve();
                                }
                            });
                        })
                );
                window.showInformationMessage('Dependencies installed successfully.', 5000);
            } catch (error) {
                window.showErrorMessage(`npm install failed: ${error.message}`, { modal: true });
            }
        }
    }
}
