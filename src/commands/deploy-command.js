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
                const workspaceFolder = workspace.getWorkspaceFolder(document.uri);

                if (workspaceFolder) {
                    const rootPath = workspaceFolder.uri.fsPath;
                    const webpackProject = _findNearestWebpackProject(path.dirname(filePath), rootPath);

                    if (webpackProject) {
                        Logger.debug(
                            `TypeScript file detected. Preparing webpack compile in ${webpackProject.projectRoot} using ${webpackProject.webpackConfigPath}.`,
                            LOG_SOURCE
                        );

                        const config = _loadWebpackConfig(webpackProject.webpackConfigPath);
                        const outputFilePath = _resolveWebpackOutputForSourceFile(config, webpackProject.projectRoot, filePath);
                        const sourceTopLevelFolder = _getTopLevelFolder(filePath, webpackProject.projectRoot);

                        if (config && outputFilePath) {
                            const outputFileName = path.basename(outputFilePath);
                            const folderDisplay = sourceTopLevelFolder || 'unknown folder';
                            Logger.debug(
                                `Webpack config found. Active folder: ${folderDisplay}. Output: ${outputFileName}. Running webpack build.`,
                                LOG_SOURCE
                            );
                            await runWebpack(webpackProject.projectRoot);

                            sourceText = fs.readFileSync(outputFilePath, 'utf8');
                            if (sourceText.startsWith('/*! For license information please see bundle.js.LICENSE.txt */')) {
                                sourceText = sourceText.replace('/*! For license information please see bundle.js.LICENSE.txt */', '').trim();
                            }
                            Logger.debug(`Webpack build complete. Deploying ${folderDisplay} as ${outputFileName}.`, LOG_SOURCE);
                            fileExt = '.js';
                            filePath = outputFilePath;
                        }
                    }

                    if (fileExt !== '.js') {
                        Logger.debug('TypeScript file did not compile to JavaScript output. Deployment aborted.', LOG_SOURCE);
                        window.showErrorMessage(
                            'The selected TypeScript file is not in a webpack project with a resolvable JavaScript output and cannot be deployed.',
                            {
                                modal: true
                            }
                        );
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
    return ensureWebpackInitialized(rootPath)
        .catch((error) => {
            Logger.debug(`Local webpack initialization did not complete: ${error && error.message ? error.message : error}`, LOG_SOURCE);
        })
        .then(
            () =>
                new Promise((resolve, reject) => {
                    let errorData = '';

                    const localWebpackBinPath = path.join(rootPath, 'node_modules', '.bin');
                    const webpackCmdPath = path.join(localWebpackBinPath, 'webpack.cmd');
                    const webpackUnixPath = path.join(localWebpackBinPath, 'webpack');
                    const hasLocalWebpack = fs.existsSync(webpackCmdPath) || fs.existsSync(webpackUnixPath);
                    const webpackBin = fs.existsSync(webpackCmdPath) ? webpackCmdPath : webpackUnixPath;
                    const webpackCommand = hasLocalWebpack ? `"${webpackBin}" --mode development` : 'webpack --mode development';

                    if (hasLocalWebpack) {
                        Logger.debug(`Invoking webpack binary at ${webpackBin}.`, LOG_SOURCE);
                    } else {
                        Logger.debug(`Local webpack executable was not found in ${localWebpackBinPath}. Falling back to global webpack command.`, LOG_SOURCE);
                    }

                    const process = cp.exec(webpackCommand, { cwd: rootPath }, (err) => {
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
                            if (!hasLocalWebpack) {
                                reject(
                                    new Error(
                                        `Local webpack executable was not found in ${localWebpackBinPath}, and global webpack could not be executed. ${errorData}`
                                    )
                                );
                            } else {
                                reject(
                                    new Error(
                                        `Webpack failed: ${errorData.indexOf('[tsl] ERROR') > 0 ? errorData.substring(errorData.indexOf('[tsl] ERROR') + 6) : errorData}`
                                    )
                                );
                            }
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
 * @param {string} startDir
 * @param {string} workspaceRoot
 * @returns {{ projectRoot: string, webpackConfigPath: string } | undefined}
 */
function _findNearestWebpackProject(startDir, workspaceRoot) {
    let currentDir = path.resolve(startDir);
    const boundaryDir = path.resolve(workspaceRoot);

    while (currentDir.startsWith(boundaryDir)) {
        const webpackConfigPath = path.join(currentDir, 'webpack.config.js');
        if (fs.existsSync(webpackConfigPath)) {
            return {
                projectRoot: currentDir,
                webpackConfigPath
            };
        }

        if (currentDir === boundaryDir) {
            break;
        }

        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir) {
            break;
        }
        currentDir = parentDir;
    }
}

/**
 * @param {string} webpackConfigPath
 * @returns {Record<string, any> | undefined}
 */
function _loadWebpackConfig(webpackConfigPath) {
    try {
        // @ts-ignore
        // eslint-disable-next-line no-undef
        return _resolveWebpackConfig(__non_webpack_require__(webpackConfigPath));
    } catch (error) {
        Logger.debug(`Failed to load webpack config at ${webpackConfigPath}: ${error && error.message ? error.message : error}`, LOG_SOURCE);
        return undefined;
    }
}

/**
 * @param {Record<string, any> | undefined} config
 * @param {string} projectRoot
 * @returns {string | undefined}
 */
function _resolveWebpackOutputFile(config, projectRoot) {
    const outputPath = config?.output?.path;
    const outputFileName = config?.output?.filename;

    if (!outputPath || !outputFileName || typeof outputFileName !== 'string') {
        return undefined;
    }

    if (/\[[^\]]+\]/.test(outputFileName)) {
        return undefined;
    }

    const absoluteOutputPath = path.isAbsolute(outputPath) ? outputPath : path.resolve(projectRoot, outputPath);
    return path.join(absoluteOutputPath, outputFileName);
}

/**
 * @param {Record<string, any> | Array<Record<string, any>> | undefined} config
 * @param {string} projectRoot
 * @param {string} sourceFilePath
 * @returns {string | undefined}
 */
function _resolveWebpackOutputForSourceFile(config, projectRoot, sourceFilePath) {
    if (!config) {
        return undefined;
    }

    const configs = Array.isArray(config) ? config : [config];
    if (configs.length === 1) {
        return _resolveWebpackOutputFile(configs[0], projectRoot);
    }

    const sourceTopLevelFolder = _getTopLevelFolder(sourceFilePath, projectRoot);
    if (!sourceTopLevelFolder) {
        return undefined;
    }

    for (const cfg of configs) {
        const entryFolders = _extractTopLevelFoldersFromEntry(cfg?.entry, projectRoot);
        if (entryFolders.has(sourceTopLevelFolder)) {
            return _resolveWebpackOutputFile(cfg, projectRoot);
        }
    }

    return undefined;
}

/**
 * @param {string} filePath
 * @param {string} projectRoot
 * @returns {string | undefined}
 */
function _getTopLevelFolder(filePath, projectRoot) {
    const relativePath = path.relative(projectRoot, filePath);
    if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
        return undefined;
    }

    const [topLevelFolder] = relativePath.split(path.sep);
    if (!topLevelFolder || topLevelFolder === '.') {
        return undefined;
    }

    return topLevelFolder;
}

/**
 * @param {unknown} entry
 * @param {string} projectRoot
 * @returns {Set<string>}
 */
function _extractTopLevelFoldersFromEntry(entry, projectRoot) {
    const folders = new Set();

    /** @type {string[]} */
    const entryFiles = [];

    if (typeof entry === 'string') {
        entryFiles.push(entry);
    } else if (Array.isArray(entry)) {
        for (const item of entry) {
            if (typeof item === 'string') {
                entryFiles.push(item);
            }
        }
    } else if (entry && typeof entry === 'object') {
        for (const value of Object.values(entry)) {
            if (typeof value === 'string') {
                entryFiles.push(value);
            } else if (Array.isArray(value)) {
                for (const item of value) {
                    if (typeof item === 'string') {
                        entryFiles.push(item);
                    }
                }
            }
        }
    }

    for (const entryFile of entryFiles) {
        const absoluteEntryPath = path.isAbsolute(entryFile) ? entryFile : path.resolve(projectRoot, entryFile);
        const topLevelFolder = _getTopLevelFolder(absoluteEntryPath, projectRoot);
        if (topLevelFolder) {
            folders.add(topLevelFolder);
        }
    }

    return folders;
}

/**
 * @param {unknown} entry
 * @param {string} projectRoot
 * @returns {string | undefined}
 */
function _resolveWebpackEntryPoint(entry, projectRoot) {
    if (!entry) {
        return undefined;
    }

    // Handle string entry
    if (typeof entry === 'string') {
        return path.isAbsolute(entry) ? entry : path.resolve(projectRoot, entry);
    }

    // Handle array entry (take first)
    if (Array.isArray(entry) && entry.length > 0) {
        const firstEntry = entry[0];
        if (typeof firstEntry === 'string') {
            return path.isAbsolute(firstEntry) ? firstEntry : path.resolve(projectRoot, firstEntry);
        }
    }

    // Handle object entry (take first value)
    if (typeof entry === 'object' && !Array.isArray(entry)) {
        const values = Object.values(entry);
        if (values.length > 0) {
            const firstValue = values[0];
            if (typeof firstValue === 'string') {
                return path.isAbsolute(firstValue) ? firstValue : path.resolve(projectRoot, firstValue);
            } else if (Array.isArray(firstValue) && firstValue.length > 0 && typeof firstValue[0] === 'string') {
                return path.isAbsolute(firstValue[0]) ? firstValue[0] : path.resolve(projectRoot, firstValue[0]);
            }
        }
    }

    return undefined;
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

    return config;
}
