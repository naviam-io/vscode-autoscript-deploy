// @ts-nocheck
import * as path from 'path';
import * as fs from 'fs';
import { window, workspace } from 'vscode';
import * as cp from 'child_process';
import deployScript from './deploy-script-command';
import deployScreen from './deploy-screen-command';
import deployForm from './deploy-form-command';
import deployReport from './deploy-report-command';
import deployConfig from './deploy-config';

import Logger from '../logger';

const LOG_SOURCE = 'DeployCommand';

export default async function deployCommand(client) {
    // Get the active text editor
    const editor = window.activeTextEditor;

    if (editor) {
        let document = editor.document;

        if (document) {
            let sourceText = document.getText();
            let filePath = document.fileName;
            let fileExt = path.extname(filePath);
            Logger.debug(`Deploy requested for ${filePath} (ext=${fileExt}).`, LOG_SOURCE);
            if (fileExt === '.ts') {
                const workspaceFolders = workspace.workspaceFolders;

                if (workspaceFolders && workspaceFolders.length > 0) {
                    const rootPath = workspaceFolders[0].uri.fsPath;
                    Logger.debug(`TypeScript file detected. Preparing webpack compile in ${rootPath}.`, LOG_SOURCE);
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
                            Logger.debug('Active TypeScript file is configured as a webpack entry. Running webpack build.', LOG_SOURCE);
                            await runWebpack(rootPath);

                            sourceText = fs.readFileSync(path.join(outputPath, outputFileName), 'utf8');
                            if (sourceText.startsWith('/*! For license information please see bundle.js.LICENSE.txt */')) {
                                sourceText = sourceText.replace('/*! For license information please see bundle.js.LICENSE.txt */', '').trim();
                            }
                            Logger.debug(`Webpack build complete. Using bundle output ${path.join(outputPath, outputFileName)}.`, LOG_SOURCE);
                            fileExt = '.js';
                        } else if (config?.entry && outputPath && outputFileName) {
                            Logger.debug('Webpack config found, but selected TypeScript file is not an entry point.', LOG_SOURCE);
                            window.showErrorMessage(
                                'The selected TypeScript file is not configured as the entry point in webpack.config.js and cannot be deployed.',
                                { modal: true }
                            );
                            return;
                        }
                    }
                    if (fileExt !== '.js') {
                        Logger.debug('TypeScript file did not compile to JavaScript output. Deployment aborted.', LOG_SOURCE);
                        window.showErrorMessage('The selected file TypeScript file was not successfully compiled to JavaScript and cannot be deployed.', {
                            modal: true
                        });
                        return;
                    }
                } else {
                    Logger.debug('No workspace folder was found while deploying a TypeScript file.', LOG_SOURCE);
                    return;
                }
            }

            if (fileExt === '.js' || fileExt === '.py' || fileExt === '.jy') {
                Logger.debug(`Deploying script file ${filePath}.`, LOG_SOURCE);
                await deployScript(client, filePath, sourceText);
            } else if (fileExt === '.xml') {
                Logger.debug(`Deploying screen definition ${filePath}.`, LOG_SOURCE);
                await deployScreen(client, filePath, sourceText);
            } else if (fileExt === '.json') {
                try {
                    let json = JSON.parse(sourceText);
                    if (_isConfigFile(json)) {
                        Logger.debug(`Deploying configuration JSON ${filePath}.`, LOG_SOURCE);
                        await deployConfig(client, json);
                    } else if (json && Object.prototype.hasOwnProperty.call(json, 'manifest') && Array.isArray(json.manifest)) {
                        Logger.debug(`Processing manifest deployment from ${filePath} with ${json.manifest.length} item(s).`, LOG_SOURCE);
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
                        Logger.debug(`Deploying inspection form JSON ${filePath}.`, LOG_SOURCE);
                        await deployForm(client, filePath, document.getText());
                    }
                } catch (error) {
                    Logger.error('Unexpected error while parsing/deploying JSON.', error, LOG_SOURCE);
                    window.showErrorMessage('Unexpected Error: ' + error);
                    return;
                }
            } else if (fileExt === '.rptdesign') {
                Logger.debug(`Deploying BIRT report ${filePath}.`, LOG_SOURCE);
                await deployReport(client, filePath, document.getText());
            } else {
                Logger.debug(`Unsupported file extension selected for deployment: ${fileExt}.`, LOG_SOURCE);
                window.showErrorMessage(
                    // eslint-disable-next-line quotes
                    "The selected file must have a Javascript ('.js') or Python ('.py') file extension for an automation script, ('.xml') for a screen definition, ('.rptdesign') for a BIRT report or ('.json') for an inspection form.",
                    { modal: true }
                );
            }
        } else {
            Logger.debug('Deploy requested, but no active document was found.', LOG_SOURCE);
            window.showErrorMessage('An automation script, screen definition, BIRT report or inspection form must be selected to deploy.', { modal: true });
        }
    } else {
        Logger.debug('Deploy requested, but no active editor was found.', LOG_SOURCE);
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
    Logger.debug(`Running local webpack build in ${rootPath}.`, LOG_SOURCE);
    return ensureWebpackInitialized(rootPath).then(
        () =>
            new Promise((resolve, reject) => {
                let errorData = '';

                const process = cp.exec('npx --no-install webpack --mode development', { cwd: rootPath }, (err) => {
                    if (err) {
                        console.log(errorData);
                        return;
                    }
                });

                if (process.stdout) {
                    process.stdout.on('data', (data) => (errorData += data));
                }
                if (process.stderr) {
                    process.stderr.on('data', (data) => (errorData += data));
                }

                process.on('close', (code) => {
                    if (code === 0) {
                        Logger.debug('Webpack process completed successfully.', LOG_SOURCE);
                        resolve();
                    } else {
                        Logger.debug(`Webpack process failed with exit code ${code}.`, LOG_SOURCE);
                        reject(
                            new Error(
                                `Webpack failed: ${errorData.indexOf('[tsl] ERROR') > 0 ? errorData.substring(errorData.indexOf('[tsl] ERROR') + 6) : errorData}`
                            )
                        );
                    }
                });

                process.on('error', (err) => reject(err));
            })
    );
}

/**
 * Ensures local webpack is available before compile.
 * @param {string} rootPath
 * @returns {Promise<void>}
 */
function ensureWebpackInitialized(rootPath) {
    const localWebpackBinPath = path.join(rootPath, 'node_modules', '.bin');
    const hasLocalWebpack = fs.existsSync(path.join(localWebpackBinPath, 'webpack')) || fs.existsSync(path.join(localWebpackBinPath, 'webpack.cmd'));
    if (hasLocalWebpack) {
        Logger.debug('Local webpack binary is already available.', LOG_SOURCE);
        return Promise.resolve();
    }

    Logger.debug('Local webpack binary not found. Checking package.json and installing dependencies.', LOG_SOURCE);

    const packageJsonPath = path.join(rootPath, 'package.json');
    if (!fs.existsSync(packageJsonPath)) {
        return Promise.reject(new Error('package.json not found. Unable to initialize local webpack dependencies.'));
    }

    /** @type {any} */
    let packageJson;
    try {
        packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    } catch {
        return Promise.reject(new Error('Unable to parse package.json.'));
    }

    const hasWebpackDependency = Boolean(packageJson?.dependencies?.webpack || packageJson?.devDependencies?.webpack || packageJson?.scripts?.webpack);

    if (!hasWebpackDependency) {
        return Promise.reject(new Error('Webpack is not defined in package.json dependencies, devDependencies, or scripts.'));
    }

    const installCommand = fs.existsSync(path.join(rootPath, 'package-lock.json')) ? 'npm ci' : 'npm install';
    Logger.debug(`Installing npm dependencies using "${installCommand}" to initialize webpack.`, LOG_SOURCE);

    return new Promise((resolve, reject) => {
        let installOutput = '';
        const installProcess = cp.exec(installCommand, { cwd: rootPath });

        if (installProcess.stdout) {
            installProcess.stdout.on('data', (data) => (installOutput += data));
        }
        if (installProcess.stderr) {
            installProcess.stderr.on('data', (data) => (installOutput += data));
        }

        installProcess.on('close', (code) => {
            const webpackInstalled = fs.existsSync(path.join(localWebpackBinPath, 'webpack')) || fs.existsSync(path.join(localWebpackBinPath, 'webpack.cmd'));

            if (code === 0 && webpackInstalled) {
                Logger.debug('Dependency installation completed and local webpack was found.', LOG_SOURCE);
                resolve();
            } else if (code === 0) {
                reject(new Error('Dependencies installed but local webpack binary was not found.'));
            } else {
                Logger.debug(`Dependency installation failed with exit code ${code}.`, LOG_SOURCE);
                reject(new Error(`Failed to install npm dependencies: ${installOutput}`));
            }
        });

        installProcess.on('error', (err) => reject(err));
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
