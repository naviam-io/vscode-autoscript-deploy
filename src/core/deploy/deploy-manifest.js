import * as path from 'path';
import * as fs from 'fs';

import Logger from '../log.js';
import { planManifest } from './manifest-planner.js';
import { executePlan } from './manifest-executor.js';
import { deployConfig } from './deploy-config.js';
import { performDatabaseConfiguration } from './database-configuration.js';
import { deployScript } from './deploy-script.js';
import { deployScreen } from './deploy-screen.js';
import { deployForm } from './deploy-form.js';
import { deployReport } from './deploy-report.js';
import { OUTDATED_SERVER_MESSAGE } from './create-only.js';

const LOG_SOURCE = 'DeployCommand';

// How many manifest problems to show in the dialog before deferring to the log.
const MAX_REPORTED_ERRORS = 10;

/**
 * Plans the manifest, refuses to start if any entry is invalid, then runs the plan in order and
 * stops at the first step that fails.
 *
 * @param {*} client the Maximo client
 * @param {import('../ui.js').Ui} ui
 * @param {string} manifestPath
 * @param {{ buildTypeScript?: (filePath: string) => Promise<{ outputFilePath: string, sourceText: string } | undefined>,
 *           onDeprecations?: (manifestPath: string, deprecations: any[]) => void,
 *           onDeployed?: (result: any) => void }} [options] onDeployed is passed to every automation script deployment
 * @returns {Promise<{ deployed: boolean, completed: number, skipped: number, total: number }>}
 */
export async function deployManifest(client, ui, manifestPath, { buildTypeScript, onDeprecations, onDeployed } = {}) {
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

        ui.error(
            `The manifest cannot be deployed because ${plan.errors.length} problem(s) were found. Nothing has been deployed.\n\n` +
                summary +
                (remaining > 0 ? `\n\u2026 and ${remaining} more; see the log.` : '')
        );
        return { deployed: false, completed: 0, skipped: 0, total: 0 };
    }

    if (plan.deprecations.length > 0 && onDeprecations) {
        onDeprecations(manifestPath, plan.deprecations);
    }
    _reportDisabledEntries(plan.disabled);

    if (plan.steps.some((step) => step.createOnly) && (await client.upgradeRequired())) {
        Logger.error(OUTDATED_SERVER_MESSAGE, null, LOG_SOURCE);
        ui.error(`${OUTDATED_SERVER_MESSAGE} Nothing has been deployed.`);
        return { deployed: false, completed: 0, skipped: 0, total: 0 };
    }

    Logger.info(`Processing manifest deployment from ${manifestPath} with ${plan.steps.length} step(s).`, LOG_SOURCE);

    const total = plan.steps.length;
    const result = await executePlan(plan.steps, _manifestHandlers(client, ui, buildTypeScript, onDeployed));

    if (result.failure) {
        const { step, error } = result.failure;
        Logger.error(`Manifest deployment stopped at ${step.path || step.kind}: ${error.message}`, error, LOG_SOURCE);
        ui.error(
            `Deployment stopped after ${result.completed} of ${total} step(s).\n\n` +
                `${step.path ? path.basename(step.path) : step.kind} did not deploy: ${error.message}`
        );
        return { deployed: false, completed: result.completed, skipped: result.skipped, total };
    }

    Logger.info(`Manifest deployment completed: ${result.completed} step(s), ${result.skipped} create-only step(s) left unchanged.`, LOG_SOURCE);
    const unchanged = result.skipped > 0 ? `, ${result.skipped} create-only entry(s) left unchanged` : '';
    const skipped = plan.disabled.length > 0 ? `, ${plan.disabled.length} disabled entry(s) skipped` : '';
    ui.info(`The manifest deployed successfully: ${result.completed} step(s)${unchanged}${skipped}.`, { modal: false });
    return { deployed: true, completed: result.completed, skipped: result.skipped, total };
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
 * The handler for each manifest step kind. A handler returns false to stop the deployment.
 */
function _manifestHandlers(client, ui, buildTypeScript, onDeployed) {
    return {
        configuration: async (step) => await deployConfig(client, ui, JSON.parse(fs.readFileSync(step.path, 'utf8')), { databaseConfiguration: false }),
        databaseConfiguration: async () => await performDatabaseConfiguration(client, ui),
        automationScript: async (step) => await _deployManifestScript(client, ui, buildTypeScript, step, onDeployed),
        deployScript: async (step) => await _runDeployScript(client, ui, buildTypeScript, step),
        inspectionForm: async (step) => await deployForm(client, ui, step.path, fs.readFileSync(step.path, 'utf8'), { createOnly: step.createOnly }),
        screen: async (step) => await deployScreen(client, ui, step.path, fs.readFileSync(step.path, 'utf8'), { createOnly: step.createOnly }),
        report: async (step) => await deployReport(client, ui, step.path, fs.readFileSync(step.path, 'utf8'), { createOnly: step.createOnly })
    };
}

/*
 * Returns undefined when the TypeScript file cannot be built, the user having been told why.
 */
async function _build(ui, buildTypeScript, filePath) {
    if (!buildTypeScript) {
        Logger.error(`${filePath} is TypeScript and no TypeScript build is available.`, null, LOG_SOURCE);
        ui.error('TypeScript cannot be built here.');
        return undefined;
    }
    return await buildTypeScript(filePath);
}

async function _deployManifestScript(client, ui, buildTypeScript, step, onDeployed) {
    if (path.extname(step.path).toLowerCase() === '.ts') {
        const build = await _build(ui, buildTypeScript, step.path);
        if (!build) {
            return false;
        }

        return await deployScript(client, ui, build.outputFilePath, build.sourceText, { sidecars: step.sidecars, companionPath: step.path, createOnly: step.createOnly, onDeployed });
    }

    return await deployScript(client, ui, step.path, fs.readFileSync(step.path, 'utf8'), { sidecars: step.sidecars, createOnly: step.createOnly, onDeployed });
}

/*
 * Runs a one-off deploy script: Maximo installs it, runs it once and removes it again.
 */
async function _runDeployScript(client, ui, buildTypeScript, step) {
    let fileName = step.path;
    let source;

    if (path.extname(step.path).toLowerCase() === '.ts') {
        const build = await _build(ui, buildTypeScript, step.path);
        if (!build) {
            return false;
        }

        fileName = build.outputFilePath;
        source = build.sourceText;
    } else {
        source = fs.readFileSync(step.path, 'utf8');
    }

    if (!source || source.trim().length === 0) {
        ui.error(`The deploy script ${path.basename(step.path)} is empty.`);
        return false;
    }

    const result = await ui.withProgress(
        {
            cancellable: false,
            title: 'Deploy Script'
        },
        async (progress) => {
            progress.report({ message: `Running ${path.basename(step.path)}\u2026` });
            return await client.postDeployScript(source, fileName);
        }
    );

    if (!result || result.status === 'error') {
        const message = (result && (result.message || result.error)) || 'An unknown error occurred.';
        Logger.error(`Deploy script ${step.path} failed: ${message}`, null, LOG_SOURCE);
        ui.error(`The deploy script ${path.basename(step.path)} failed: ${message}`);
        return false;
    }

    Logger.info(`Deploy script ${step.path} ran successfully.`, LOG_SOURCE);
    return true;
}
