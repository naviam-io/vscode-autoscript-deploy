import * as path from 'path';
import * as fs from 'fs';
import { window, workspace } from 'vscode';
import * as cp from 'child_process';
import deployScript from './deploy-script-command';
import deployScreen from './deploy-screen-command';
import deployForm from './deploy-form-command';
import deployReport from './deploy-report-command';
import deployConfig from './deploy-config';

export default async function deployCommand(client) {
    // Get the active text editor
    const editor = window.activeTextEditor;

    if (editor) {
        let document = editor.document;

        if (document) {
            let sourceText = document.getText();
            let filePath = document.fileName;
            let fileExt = path.extname(filePath);
            if (fileExt === '.ts') {
                const workspaceFolders = workspace.workspaceFolders;

                if (workspaceFolders && workspaceFolders.length > 0) {
                    const rootPath = workspaceFolders[0].uri.fsPath;
                    const webpackConfigPath = path.join(rootPath, 'webpack.config.js');
                    if (
                        fs.existsSync(webpackConfigPath) &&
                        fs.existsSync(path.join(rootPath, 'tsconfig.json')) &&
                        fs.existsSync(path.join(rootPath, 'package.json')) &&
                        fs.existsSync(path.join(rootPath, '.babelrc'))
                    ) {
                        // @ts-ignore
                        // eslint-disable-next-line no-undef
                        const config = _resolveWebpackConfig(__non_webpack_require__(webpackConfigPath));

                        const outputPath = config?.output?.path;
                        const outputFileName = config?.output?.filename;

                        if (_webpackEntryContainsFile(config?.entry, filePath, rootPath) && outputPath && outputFileName) {
                            await runWebpack(rootPath);

                            sourceText = fs.readFileSync(path.join(outputPath, outputFileName), 'utf8');
                            if (sourceText.startsWith('/*! For license information please see bundle.js.LICENSE.txt */')) {
                                sourceText = sourceText.replace('/*! For license information please see bundle.js.LICENSE.txt */', '').trim();
                            }
                            fileExt = '.js';
                        } else if (config?.entry && outputPath && outputFileName) {
                            window.showErrorMessage(
                                'The selected TypeScript file is not configured as the entry point in webpack.config.js and cannot be deployed.',
                                { modal: true }
                            );
                            return;
                        }
                    }
                    if (fileExt !== '.js') {
                        window.showErrorMessage('The selected file TypeScript file was not successfully compiled to JavaScript and cannot be deployed.', {
                            modal: true
                        });
                        return;
                    }
                } else {
                    return;
                }
            }

            if (fileExt === '.js' || fileExt === '.py' || fileExt === '.jy') {
                await deployScript(client, filePath, sourceText);
            } else if (fileExt === '.xml') {
                await deployScreen(client, filePath, sourceText);
            } else if (fileExt === '.json') {
                try {
                    let json = JSON.parse(sourceText);
                    if (_isConfigFile(json)) {
                        await deployConfig(client, json);
                    } else if (json && Object.prototype.hasOwnProperty.call(json, 'manifest') && Array.isArray(json.manifest)) {
                        const directory = path.dirname(filePath);
                        for (const item of json.manifest) {
                            let itemValue = item;
                            if (typeof item === 'object' && Object.prototype.hasOwnProperty.call(item, 'path')) {
                                itemValue = item.path;
                            }

                            if (typeof itemValue === 'string') {
                                let itemPath = fs.existsSync(itemValue) ? itemValue : path.join(directory, itemValue);
                                if (fs.existsSync(itemPath)) {
                                    let content = fs.readFileSync(itemPath, 'utf8');
                                    let itemExt = path.extname(itemPath);
                                    if (itemExt === '.js' || itemExt === '.py' || itemExt === '.jy') {
                                        await deployScript(client, itemPath, content);
                                    } else if (itemExt === '.xml') {
                                        await deployScreen(client, itemPath, content);
                                    } else if (itemExt === '.json') {
                                        await deployForm(client, itemPath, content);
                                    } else if (itemExt === '.rptdesign') {
                                        await deployReport(client, itemPath, content);
                                    }
                                }
                            }
                        }
                    } else {
                        await deployForm(client, filePath, document.getText());
                    }
                } catch (error) {
                    window.showErrorMessage('Unexpected Error: ' + error);
                    return;
                }
            } else if (fileExt === '.rptdesign') {
                await deployReport(client, filePath, document.getText());
            } else {
                window.showErrorMessage(
                    // eslint-disable-next-line quotes
                    "The selected file must have a Javascript ('.js') or Python ('.py') file extension for an automation script, ('.xml') for a screen definition, ('.rptdesign') for a BIRT report or ('.json') for an inspection form.",
                    { modal: true }
                );
            }
        } else {
            window.showErrorMessage('An automation script, screen definition, BIRT report or inspection form must be selected to deploy.', { modal: true });
        }
    } else {
        window.showErrorMessage('An automation script, screen definition, BIRT report or inspection form must be selected to deploy.', { modal: true });
    }
}

function _isConfigFile(json) {
    // List of configuration properties to check for.
    var properties = ['intObjects', 'properties', 'messages', 'loggers', 'cronTasks', 'domains', 'scripts'];

    if (json && typeof json.inspformnum !== 'undefined') {
        return false;
    }

    return properties.some(function (prop) {
        return Object.prototype.hasOwnProperty.call(json, prop);
    });
}

/**
 * @param {string} rootPath
 * @returns {Promise<void>}
 */
function runWebpack(rootPath) {
    return new Promise((resolve, reject) => {
        let errorData = '';

        const process = cp.exec('webpack --mode development', { cwd: rootPath }, (err) => {
            if (err) {
                console.log(errorData);
                return;
            }
        });
        // Optional: Stream output to console

        if (process.stdout) {
            process.stdout.on('data', (data) => (errorData += data));
        }

        // Wait for the process to close
        process.on('close', (code) => {
            if (code === 0) {
                resolve(); // Success
            } else {
                reject(
                    new Error(`Webpack failed: ${errorData.indexOf('[tsl] ERROR') > 0 ? errorData.substring(errorData.indexOf('[tsl] ERROR') + 6) : errorData}`)
                ); // Failure
            }
        });

        process.on('error', (err) => reject(err));
    });
}

/**
 * @param {unknown} loadedConfig
 * @returns {Record<string, any> | undefined}
 */
function _resolveWebpackConfig(loadedConfig) {
    const loadedConfigAny = /** @type {any} */ (loadedConfig);
    let config = loadedConfigAny && loadedConfigAny.default ? loadedConfigAny.default : loadedConfigAny;

    if (typeof config === 'function') {
        // Support common webpack config factories: (env, argv) => ({ ... })
        try {
            config = config({}, { mode: 'production' });
        } catch {
            try {
                config = config();
            } catch {
                return undefined;
            }
        }
    }

    if (Array.isArray(config)) {
        return config[0];
    }

    return config;
}

/**
 * @param {unknown} entry
 * @param {string} filePath
 * @param {string} rootPath
 * @returns {boolean}
 */
function _webpackEntryContainsFile(entry, filePath, rootPath) {
    if (!entry) {
        return false;
    }

    const activeFile = path.resolve(filePath);
    /** @type {string[]} */
    const entries = [];

    /** @param {unknown} value */
    const collectEntries = (value) => {
        if (typeof value === 'string') {
            entries.push(value);
        } else if (Array.isArray(value)) {
            value.forEach(collectEntries);
        } else if (value && typeof value === 'object') {
            Object.values(value).forEach(collectEntries);
        }
    };

    collectEntries(entry);

    return entries.some((candidate) => {
        const candidatePath = path.isAbsolute(candidate) ? candidate : path.resolve(rootPath, candidate);
        return path.resolve(candidatePath) === activeFile;
    });
}
