/*
 * The deploy command: routes each file to the core deployer the extension uses for it.
 * See docs/flows/cli.md.
 */
import fs from 'fs';
import path from 'path';

import Logger from '../../src/core/log.js';
import { deployConfig } from '../../src/core/deploy/deploy-config.js';
import { deployForm } from '../../src/core/deploy/deploy-form.js';
import { deployManifest } from '../../src/core/deploy/deploy-manifest.js';
import { deployReport } from '../../src/core/deploy/deploy-report.js';
import { deployScreen } from '../../src/core/deploy/deploy-screen.js';
import { deployScript } from '../../src/core/deploy/deploy-script.js';
import { isInspectionFormDocument, isManifestDocument } from '../../src/core/deploy/manifest-planner.js';
import { buildTypeScript } from '../../src/core/webpack/webpack-project.js';
import { resolveDeployFile } from './configuration.js';

const LOG_SOURCE = 'CliDeploy';

const SCRIPT_EXTENSIONS = ['.js', '.py', '.jy'];
const COMPANION_SOURCE_EXTENSIONS = [...SCRIPT_EXTENSIONS, '.ts'];
// Tooling files a project directory commonly holds, which are not Maximo configuration.
const TOOLING_JSON = /^(package|package-lock|tsconfig.*|jsconfig.*)\.json$/i;

/**
 * What a file deploys as, or null when it is not deployed on its own.
 *
 * @param {string} file
 * @returns {'script' | 'typescript' | 'screen' | 'report' | 'json' | null}
 */
export function classifyFile(file) {
    const extension = path.extname(file).toLowerCase();
    const base = file.slice(0, file.length - extension.length);
    const name = path.basename(file).toLowerCase();

    if (SCRIPT_EXTENSIONS.includes(extension)) {
        return /[.-]deploy$/i.test(base) ? null : 'script';
    }
    if (extension === '.ts') {
        return name.endsWith('.d.ts') ? null : 'typescript';
    }
    if (extension === '.xml') {
        return name === 'reports.xml' ? null : 'screen';
    }
    if (extension === '.rptdesign') {
        return 'report';
    }
    if (extension === '.json') {
        if (/[.-]predeploy$/i.test(base) || COMPANION_SOURCE_EXTENSIONS.some((sourceExtension) => fs.existsSync(base + sourceExtension))) {
            return null;
        }
        return 'json';
    }
    return null;
}

/**
 * The files a directory deploys, in directory order. TypeScript deploys only by name or from a manifest,
 * because a project's files that are not webpack entries cannot be built on their own.
 */
export function collectFiles(directory, recursive) {
    const files = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const fullPath = path.resolve(directory, entry.name);
        if (entry.isDirectory()) {
            if (recursive && entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
                files.push(...collectFiles(fullPath, recursive));
            }
        } else if (entry.isFile()) {
            const kind = classifyFile(fullPath);
            if (kind && kind !== 'typescript' && !(kind === 'json' && TOOLING_JSON.test(entry.name))) {
                files.push(fullPath);
            }
        }
    }
    return files;
}

/**
 * Builds TypeScript with the webpack project that holds the file.
 */
export function createTypeScriptBuild(ui) {
    return async (filePath) => {
        try {
            const build = await ui.withProgress({ title: 'TypeScript', cancellable: false }, async (progress) => {
                progress.report({ message: `Building ${path.basename(filePath)} with webpack` });
                return await buildTypeScript(filePath, path.parse(path.resolve(filePath)).root, {
                    onMessage: (message) => progress.report({ message })
                });
            });
            if (!build) {
                await ui.error(`${filePath} is not in a webpack project and cannot be deployed.`);
                return undefined;
            }
            return build;
        } catch (error) {
            Logger.error(`Unable to compile ${filePath} with webpack.`, error, LOG_SOURCE);
            await ui.error(`${filePath} could not be compiled: ${describeError(error)}`);
            return undefined;
        }
    };
}

function reportDeprecations(manifestPath, deprecations) {
    for (const deprecation of deprecations) {
        Logger.warn(
            `${deprecation.manifestPath} entry ${deprecation.index + 1} declares no "kind". Entries without a kind are deprecated; add a kind to say what each entry is.`,
            LOG_SOURCE
        );
    }
}

/**
 * Deploys one file. Errors are shown through the Ui; the result says whether the file deployed.
 *
 * @param {*} client the Maximo client
 * @param {import('../../src/core/ui.js').Ui} ui
 * @param {string} file
 * @param {{ buildTypeScript: Function, onDeployed?: (result: any) => void }} options
 * @returns {Promise<boolean|string>} whether the file deployed, or SKIPPED
 */
export async function deployFile(client, ui, file, { buildTypeScript: build, onDeployed }) {
    try {
        switch (classifyFile(file)) {
        case 'script':
            return await deployScript(client, ui, file, fs.readFileSync(file, 'utf8'), { onDeployed });
        case 'typescript': {
            const output = await build(file);
            return output ? await deployScript(client, ui, output.outputFilePath, output.sourceText, { companionPath: file, onDeployed }) : false;
        }
        case 'screen':
            return await deployScreen(client, ui, file, fs.readFileSync(file, 'utf8'));
        case 'report':
            return await deployReport(client, ui, file, fs.readFileSync(file, 'utf8'));
        case 'json':
            return await deployJson(client, ui, file, { buildTypeScript: build, onDeployed });
        default:
            await ui.error(`${file} is not a file that deploys on its own.`);
            return false;
        }
    } catch (error) {
        Logger.error(`Deploying ${file} failed.`, error, LOG_SOURCE);
        await ui.error(`${path.basename(file)}: ${describeError(error)}`);
        return false;
    }
}

async function deployJson(client, ui, file, { buildTypeScript: build, onDeployed }) {
    const text = fs.readFileSync(file, 'utf8');
    let json;
    try {
        json = text.trim() ? JSON.parse(text) : {};
    } catch (error) {
        await ui.error(`${file} is not valid JSON: ${error.message}`);
        return false;
    }

    if (isManifestDocument(json)) {
        const result = await deployManifest(client, ui, file, { buildTypeScript: build, onDeprecations: reportDeprecations, onDeployed });
        return Boolean(result && result.deployed);
    }
    if (isInspectionFormDocument(json)) {
        return await deployForm(client, ui, file, text);
    }
    return await deployConfig(client, ui, json);
}

/**
 * Deploys the configured file, or every file in the configured directory followed by the requested deletions.
 *
 * @param {*} client
 * @param {import('../../src/core/ui.js').Ui} ui
 * @param {object} config
 * @param {{ buildTypeScript?: Function, out?: (text: string) => void }} options
 * @returns {Promise<{ failed: number }>}
 */
export async function runDeploy(client, ui, config, { buildTypeScript: build, out = (text) => process.stdout.write(text + '\n') }) {
    const deployedScripts = [];
    let unnamedScript = false;
    const onDeployed = (result) => {
        if (result && result.scriptName) {
            deployedScripts.push(String(result.scriptName).toLowerCase());
        } else {
            unnamedScript = true;
        }
    };

    if (config.file) {
        const file = resolveDeployFile(config);
        out(`Deploying ${file}`);
        return { failed: (await deployFile(client, ui, file, { buildTypeScript: build, onDeployed })) ? 0 : 1 };
    }

    let failed = 0;
    const deleteList = config.deleteList ? path.resolve(config.deleteList) : undefined;
    for (const file of collectFiles(config.directory, config.recursive).filter((candidate) => candidate !== deleteList)) {
        out(`Deploying ${path.relative(config.directory, file) || file}`);
        if (!(await deployFile(client, ui, file, { buildTypeScript: build, onDeployed }))) {
            failed++;
        }
    }

    if (config.deleteAll) {
        if (failed > 0) {
            await ui.error(`No scripts were deleted because ${failed} file(s) failed to deploy.`);
            return { failed: failed + 1 };
        }
        if (unnamedScript) {
            await ui.error('No scripts were deleted because Maximo did not return the name of a deployed script, so deleting all others is unsafe.');
            return { failed: 1 };
        }
        const names = (await client.getAllScriptNames()).map((script) => script.label).filter((name) => !deployedScripts.includes(name));
        failed += await deleteScripts(client, ui, names, out);
    } else if (config.deleteList && fs.existsSync(config.deleteList)) {
        let names;
        try {
            names = JSON.parse(fs.readFileSync(config.deleteList, 'utf8'));
        } catch (error) {
            await ui.error(`The delete list ${config.deleteList} is not valid JSON: ${error.message}`);
            return { failed: failed + 1 };
        }
        if (!Array.isArray(names)) {
            await ui.error(`The delete list ${config.deleteList} must be a JSON array of script names.`);
            return { failed: failed + 1 };
        }
        failed += await deleteScripts(client, ui, names.map(String), out);
    }

    return { failed };
}

async function deleteScripts(client, ui, names, out) {
    let failed = 0;
    for (const name of names) {
        try {
            out((await client.deleteScriptIfExists(name)) ? `Deleted script ${name}` : `Script ${name} does not exist`);
        } catch (error) {
            failed++;
            await ui.error(`The script ${name} could not be deleted: ${describeError(error)}`);
        }
    }
    return failed;
}

export function describeError(error) {
    if (error && error.message) {
        return error.message;
    }
    return typeof error === 'string' ? error : JSON.stringify(error);
}
