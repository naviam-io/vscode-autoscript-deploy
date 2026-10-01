// @ts-nocheck
import * as path from 'path';
import * as fs from 'fs';
import { window, workspace, ProgressLocation, Uri } from 'vscode';
import deployScript, { performDatabaseConfiguration } from './deploy-script-command';
import deployScreen from './deploy-screen-command';
import deployForm from './deploy-form-command';
import deployReport from './deploy-report-command';
import deployConfig from './deploy-config';
import webpackProject from '../webpack/webpack-project';
import { planManifest, isManifestDocument, isInspectionFormDocument } from '../deploy/manifest-planner';
import { executePlan } from '../deploy/manifest-executor';

import Logger from '../logger';

const LOG_SOURCE = 'DeployCommand';
const LICENSE_BANNER = '/*! For license information please see bundle.js.LICENSE.txt */';

// How many manifest problems to show in the dialog before deferring to the log.
const MAX_REPORTED_ERRORS = 10;

const DEPRECATION_SILENCE_ACTION = "Don't Show Again";

// Manifests already reported this session, so that repeatedly deploying one does not repeatedly
// warn about the same entries.
const reportedDeprecatedManifests = new Set();
let deprecationNoticeSilenced = false;

webpackProject.setLogger(Logger);

export default async function deployCommand(client) {
    // Get the active text editor
    const editor = window.activeTextEditor;

    if (editor) {
        let document = editor.document;

        if (document) {
            let sourceText = document.getText();
            let filePath = document.fileName;
            let fileExt = path.extname(filePath);
            let companionPath;
            Logger.debug(`Deploy requested for ${filePath} (ext=${fileExt}).`, LOG_SOURCE);
            if (fileExt === '.ts') {
                const build = await _buildTypeScript(filePath);

                if (!build) {
                    return;
                }

                sourceText = build.sourceText;
                fileExt = '.js';
                companionPath = filePath;
                filePath = build.outputFilePath;
            }

            if (fileExt === '.js' || fileExt === '.py' || fileExt === '.jy') {
                Logger.info(`Deploying script file ${filePath}.`, LOG_SOURCE);
                await deployScript(client, filePath, sourceText, { companionPath });
                Logger.info(`Deploy command completed for ${filePath}.`, LOG_SOURCE);
            } else if (fileExt === '.xml') {
                Logger.info(`Deploying screen definition ${filePath}.`, LOG_SOURCE);
                await deployScreen(client, filePath, sourceText);
                Logger.info(`Deploy command completed for ${filePath}.`, LOG_SOURCE);
            } else if (fileExt === '.json') {
                try {
                    let json = sourceText.trim() ? JSON.parse(sourceText) : {};
                    if (isManifestDocument(json)) {
                        await _deployManifest(client, filePath);
                    } else if (isInspectionFormDocument(json)) {
                        Logger.info(`Deploying inspection form JSON ${filePath}.`, LOG_SOURCE);
                        await deployForm(client, filePath, document.getText());
                    } else {
                        Logger.info(`Deploying configuration JSON ${filePath}.`, LOG_SOURCE);
                        await deployConfig(client, json);
                    }
                    Logger.info(`Deploy command completed for ${filePath}.`, LOG_SOURCE);
                } catch (error) {
                    Logger.error('Unexpected error while parsing/deploying JSON.', error, LOG_SOURCE);
                    window.showErrorMessage('Unexpected Error: ' + error);
                }
            } else if (fileExt === '.rptdesign') {
                Logger.info(`Deploying BIRT report ${filePath}.`, LOG_SOURCE);
                await deployReport(client, filePath, document.getText());
                Logger.info(`Deploy command completed for ${filePath}.`, LOG_SOURCE);
            } else {
                Logger.error(`Unsupported file extension selected for deployment: ${fileExt}.`, null, LOG_SOURCE);
                window.showErrorMessage(
                    // eslint-disable-next-line quotes
                    "The selected file must have a Javascript ('.js') or Python ('.py') file extension for an automation script, ('.xml') for a screen definition, ('.rptdesign') for a BIRT report or ('.json') for an inspection form.",
                    { modal: true }
                );
            }
        } else {
            Logger.error('Deploy requested, but no active document was found.', null, LOG_SOURCE);
            window.showErrorMessage('An automation script, screen definition, BIRT report or inspection form must be selected to deploy.', { modal: true });
        }
    } else {
        Logger.error('Deploy requested, but no active editor was found.', null, LOG_SOURCE);
        window.showErrorMessage('An automation script, screen definition, BIRT report or inspection form must be selected to deploy.', { modal: true });
    }
}

/*
 * Compiles a TypeScript file through its webpack project and returns the bundle to deploy.
 *
 * Returns undefined when the file cannot be built, having already told the user why.
 */
async function _buildTypeScript(filePath) {
    const workspaceFolder = workspace.getWorkspaceFolder(Uri.file(filePath));

    if (!workspaceFolder) {
        Logger.error(`No workspace folder was found for ${filePath}. Deployment aborted.`, null, LOG_SOURCE);
        window.showErrorMessage('The TypeScript file is not in a workspace folder and cannot be deployed.', { modal: true });
        return undefined;
    }

    /** @type {{ outputFilePath: string, projectRoot: string } | undefined} */
    let build;
    try {
        build = await window.withProgress(
            {
                cancellable: false,
                title: 'TypeScript',
                location: ProgressLocation.Notification
            },
            async (progress) => {
                progress.report({ message: 'Preparing webpack build\u2026' });
                const webpackMode = workspace.getConfiguration('naviam.maximo').get('webpackMode');
                return await webpackProject.prepareWebpackBuild(
                    filePath,
                    workspaceFolder.uri.fsPath,
                    (message) => progress.report({ message }),
                    webpackMode
                );
            }
        );
    } catch (error) {
        Logger.error(`Unable to compile ${filePath} with webpack.`, error, LOG_SOURCE);
        window.showErrorMessage(`The selected TypeScript file could not be compiled: ${error && error.message ? error.message : error}`, {
            modal: true
        });
        return undefined;
    }

    if (!build) {
        Logger.error(`No webpack project was found for ${filePath}. Deployment aborted.`, null, LOG_SOURCE);
        window.showErrorMessage('The selected TypeScript file is not in a webpack project and cannot be deployed.', { modal: true });
        return undefined;
    }

    let sourceText = fs.readFileSync(build.outputFilePath, 'utf8');
    if (sourceText.startsWith(LICENSE_BANNER)) {
        sourceText = sourceText.replace(LICENSE_BANNER, '').trim();
    }

    Logger.debug(`Webpack build complete. Deploying ${filePath} as ${path.basename(build.outputFilePath)}.`, LOG_SOURCE);
    return { outputFilePath: build.outputFilePath, sourceText };
}

/*
 * Plans the manifest, refuses to start if any entry is invalid, then runs the plan in order and
 * stops at the first step that fails.
 */
async function _deployManifest(client, manifestPath) {
    const plan = planManifest(manifestPath);

    if (plan.errors.length > 0) {
        for (const error of plan.errors) {
            Logger.error(`${error.manifestPath}${error.index === null ? '' : ` entry ${error.index}`}: ${error.message}`, null, LOG_SOURCE);
        }

        const summary = plan.errors
            .slice(0, MAX_REPORTED_ERRORS)
            .map((error) => `\u2022 ${path.basename(error.manifestPath)}${error.index === null ? '' : ` entry ${error.index + 1}`}: ${error.message}`)
            .join('\n');
        const remaining = plan.errors.length - MAX_REPORTED_ERRORS;

        window.showErrorMessage(
            `The manifest cannot be deployed because ${plan.errors.length} problem(s) were found. Nothing has been deployed.\n\n` +
                summary +
                (remaining > 0 ? `\n\u2026 and ${remaining} more; see the log.` : ''),
            { modal: true }
        );
        return;
    }

    _reportDeprecatedEntries(manifestPath, plan.deprecations);
    _reportDisabledEntries(plan.disabled);

    Logger.info(`Processing manifest deployment from ${manifestPath} with ${plan.steps.length} step(s).`, LOG_SOURCE);

    const result = await executePlan(plan.steps, _manifestHandlers(client));

    if (result.failure) {
        const { step, error } = result.failure;
        Logger.error(`Manifest deployment stopped at ${step.path || step.kind}: ${error.message}`, error, LOG_SOURCE);
        window.showErrorMessage(
            `Deployment stopped after ${result.completed} of ${plan.steps.length} step(s).\n\n` +
                `${step.path ? path.basename(step.path) : step.kind} did not deploy: ${error.message}`,
            { modal: true }
        );
        return;
    }

    Logger.info(`Manifest deployment completed: ${result.completed} step(s).`, LOG_SOURCE);
    const skipped = plan.disabled.length > 0 ? `, ${plan.disabled.length} disabled entry(s) skipped` : '';
    window.showInformationMessage(`The manifest deployed successfully: ${result.completed} step(s)${skipped}.`);
}

/*
 * Records the entries that are switched off. This only goes to the log and to the summary shown when
 * the deployment finishes: disabling an entry is a deliberate act, so it does not warrant a warning,
 * but it must be visible enough that a developer does not forget an entry is still off.
 */
function _reportDisabledEntries(disabled) {
    for (const entry of disabled) {
        Logger.info(`${entry.manifestPath} entry ${entry.index + 1} is disabled and was skipped.`, LOG_SOURCE);
    }
}

/*
 * Points out entries that declare no "kind", which is the superseded form of a manifest.
 *
 * The notice is deliberately a notification rather than a prompt: it must not interrupt a
 * deployment, because those entries still deploy exactly as they always have. It is shown once per
 * manifest per session, and can be silenced for the rest of the session.
 */
function _reportDeprecatedEntries(manifestPath, deprecations) {
    if (deprecations.length === 0 || deprecationNoticeSilenced || reportedDeprecatedManifests.has(manifestPath)) {
        return;
    }
    reportedDeprecatedManifests.add(manifestPath);

    for (const deprecation of deprecations) {
        Logger.warn(
            `${deprecation.manifestPath} entry ${deprecation.index + 1} declares no "kind". ` +
                'Entries without a kind are deprecated: they are routed by file extension and a script still ' +
                'takes its predeploy, deploy and configuration companion files.',
            LOG_SOURCE
        );
    }

    const notice =
        `${path.basename(manifestPath)}: ${deprecations.length} entry(s) declare no "kind". ` +
        'Entries without a kind are deprecated; add a kind to say what each entry is. See the log for which ones.';

    // Not awaited: the deployment must not wait on the user reading this.
    window.showWarningMessage(notice, DEPRECATION_SILENCE_ACTION).then((choice) => {
        if (choice === DEPRECATION_SILENCE_ACTION) {
            deprecationNoticeSilenced = true;
        }
    });
}

/*
 * The handler for each manifest step kind. A handler returns false to stop the deployment.
 */
function _manifestHandlers(client) {
    return {
        configuration: async (step) => await deployConfig(client, JSON.parse(fs.readFileSync(step.path, 'utf8'))),
        databaseConfiguration: async () => await performDatabaseConfiguration(client),
        automationScript: async (step) => await _deployManifestScript(client, step),
        deployScript: async (step) => await _runDeployScript(client, step),
        inspectionForm: async (step) => await deployForm(client, step.path, fs.readFileSync(step.path, 'utf8')),
        screen: async (step) => await deployScreen(client, step.path, fs.readFileSync(step.path, 'utf8')),
        report: async (step) => await deployReport(client, step.path, fs.readFileSync(step.path, 'utf8'))
    };
}

async function _deployManifestScript(client, step) {
    if (path.extname(step.path).toLowerCase() === '.ts') {
        const build = await _buildTypeScript(step.path);
        if (!build) {
            return false;
        }

        return await deployScript(client, build.outputFilePath, build.sourceText, { sidecars: step.sidecars, companionPath: step.path });
    }

    return await deployScript(client, step.path, fs.readFileSync(step.path, 'utf8'), { sidecars: step.sidecars });
}

/*
 * Runs a one-off deploy script: Maximo installs it, runs it once and removes it again.
 */
async function _runDeployScript(client, step) {
    let fileName = step.path;
    let source;

    if (path.extname(step.path).toLowerCase() === '.ts') {
        const build = await _buildTypeScript(step.path);
        if (!build) {
            return false;
        }

        fileName = build.outputFilePath;
        source = build.sourceText;
    } else {
        source = fs.readFileSync(step.path, 'utf8');
    }

    if (!source || source.trim().length === 0) {
        window.showErrorMessage(`The deploy script ${path.basename(step.path)} is empty.`, { modal: true });
        return false;
    }

    const result = await window.withProgress(
        {
            cancellable: false,
            title: 'Deploy Script',
            location: ProgressLocation.Notification
        },
        async (progress) => {
            progress.report({ message: `Running ${path.basename(step.path)}\u2026` });
            return await client.postDeployScript(source, fileName);
        }
    );

    if (!result || result.status === 'error') {
        const message = (result && (result.message || result.error)) || 'An unknown error occurred.';
        Logger.error(`Deploy script ${step.path} failed: ${message}`, null, LOG_SOURCE);
        window.showErrorMessage(`The deploy script ${path.basename(step.path)} failed: ${message}`, { modal: true });
        return false;
    }

    Logger.info(`Deploy script ${step.path} ran successfully.`, LOG_SOURCE);
    return true;
}

