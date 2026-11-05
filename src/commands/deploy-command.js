// @ts-nocheck
import * as path from 'path';
import { window, workspace, ProgressLocation, Uri } from 'vscode';
import { deployScript } from '../core/deploy/deploy-script.js';
import { deployScreen } from '../core/deploy/deploy-screen.js';
import { deployForm } from '../core/deploy/deploy-form.js';
import { deployReport } from '../core/deploy/deploy-report.js';
import { deployConfig } from '../core/deploy/deploy-config.js';
import { deployManifest } from '../core/deploy/deploy-manifest.js';
import vscodeUi from '../vscode-ui.js';
import { buildTypeScript } from '../core/webpack/webpack-project.js';
import { isManifestDocument, isInspectionFormDocument } from '../core/deploy/manifest-planner.js';

import Logger from '../logger';

const LOG_SOURCE = 'DeployCommand';

const DEPRECATION_SILENCE_ACTION = "Don't Show Again";

// Manifests already reported this session, so that repeatedly deploying one does not repeatedly
// warn about the same entries.
const reportedDeprecatedManifests = new Set();
let deprecationNoticeSilenced = false;

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
                await deployScript(client, vscodeUi, filePath, sourceText, { companionPath });
                Logger.info(`Deploy command completed for ${filePath}.`, LOG_SOURCE);
            } else if (fileExt === '.xml') {
                Logger.info(`Deploying screen definition ${filePath}.`, LOG_SOURCE);
                await deployScreen(client, vscodeUi, filePath, sourceText);
                Logger.info(`Deploy command completed for ${filePath}.`, LOG_SOURCE);
            } else if (fileExt === '.json') {
                try {
                    let json = sourceText.trim() ? JSON.parse(sourceText) : {};
                    if (isManifestDocument(json)) {
                        await deployManifest(client, vscodeUi, filePath, { buildTypeScript: _buildTypeScript, onDeprecations: _reportDeprecatedEntries });
                    } else if (isInspectionFormDocument(json)) {
                        Logger.info(`Deploying inspection form JSON ${filePath}.`, LOG_SOURCE);
                        await deployForm(client, vscodeUi, filePath, document.getText());
                    } else {
                        Logger.info(`Deploying configuration JSON ${filePath}.`, LOG_SOURCE);
                        await deployConfig(client, vscodeUi, json);
                    }
                    Logger.info(`Deploy command completed for ${filePath}.`, LOG_SOURCE);
                } catch (error) {
                    Logger.error('Unexpected error while parsing/deploying JSON.', error, LOG_SOURCE);
                    window.showErrorMessage('Unexpected Error: ' + error);
                }
            } else if (fileExt === '.rptdesign') {
                Logger.info(`Deploying BIRT report ${filePath}.`, LOG_SOURCE);
                await deployReport(client, vscodeUi, filePath, document.getText());
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

    /** @type {{ outputFilePath: string, sourceText: string } | undefined} */
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
                return await buildTypeScript(filePath, workspaceFolder.uri.fsPath, {
                    onMessage: (message) => progress.report({ message }),
                    webpackMode
                });
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

    Logger.debug(`Webpack build complete. Deploying ${filePath} as ${path.basename(build.outputFilePath)}.`, LOG_SOURCE);
    return build;
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
