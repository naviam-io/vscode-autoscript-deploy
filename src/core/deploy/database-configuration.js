/*
 * Applies pending database configuration, taking Admin Mode and temporarily disabling e-signature
 * when Maximo requires it and the user agrees. Part of the core: see docs/modules/core.md.
 */
import Logger from '../log.js';
import { Decision } from '../ui.js';

const LOG_SOURCE = 'DatabaseConfiguration';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const MANUAL_CONFIG_MESSAGE = 'The configurations have been added to Maximo and can be manually applied by an administrator.';
const NOT_APPLIED_MESSAGE = 'The script cannot be deployed until the database configurations have been applied.\n\n' + MANUAL_CONFIG_MESSAGE;

// E-signature on these signature options blocks toggling Admin Mode or applying the configuration over REST, causing the deploy to hang.
const ESIG = {
    adminMode: {
        options: ['ADMINMODE', 'CONFIGURE'],
        prompt:
            'E-signature is enabled for the "Manage Admin Mode" and/or "Apply Configuration Changes" options.\n\n' +
            'To apply the configuration, e-signature must be temporarily disabled for these options and then restored to its original state. Do you want to continue?'
    },
    live: {
        options: ['CONFIGURE'],
        prompt:
            'E-signature is enabled for the "Apply Configuration Changes" option.\n\n' +
            'To apply the configuration, e-signature must be temporarily disabled for this option and then restored to its original state. Do you want to continue?'
    }
};

const DB_CONFIG_ERROR = /BMX.*?E(?= -)/;

/**
 * Whether a deployment configuration declares objects, and so may need a database configuration.
 * "maxObjects" is the historical predeploy name and "objects" the current one.
 *
 * @param {object} config the deployment configuration
 * @returns {boolean}
 */
export function declaresObjects(config) {
    return (Array.isArray(config.maxObjects) && config.maxObjects.length > 0) || (Array.isArray(config.objects) && config.objects.length > 0);
}

/**
 * Applies any pending database configuration, taking Admin Mode when Maximo says it is required and
 * the user agrees to it.
 *
 * @param {*} client the Maximo client
 * @param {import('../ui.js').Ui} ui
 * @param {object} [config] the deployment configuration that caused the change, if any
 * @param {{ pollIntervalMs?: number }} [options] how long to wait between polls of Maximo
 * @returns {Promise<boolean>} whether the database is now configured
 */
export async function performDatabaseConfiguration(client, ui, config, { pollIntervalMs = 2000 } = {}) {
    if (!(await client.dbConfigRequired())) {
        Logger.info('No database configuration is pending.', LOG_SOURCE);
        return true;
    }

    Logger.info('Database configuration is required.', LOG_SOURCE);

    const adminMode = await client.dbConfigRequiresAdminMode();
    if (adminMode && !(await _confirmAdminMode(ui, config))) {
        return false;
    }

    const esig = adminMode ? ESIG.adminMode : ESIG.live;
    const originalEsig = await _confirmEsigDisable(client, ui, esig);
    if (originalEsig === false) {
        return false;
    }

    const wait = () => sleep(pollIntervalMs);
    try {
        if (originalEsig) {
            await _setEsig(
                client,
                ui,
                Object.fromEntries(esig.options.map((option) => [option, 0])),
                `Temporarily disabling e-signature on ${esig.options.join('/')}.`
            );
        }
        if (adminMode) {
            await _setAdminMode(client, ui, true, wait);
        }
        await _applyDbConfig(client, ui, adminMode, wait);
        if (adminMode) {
            await _setAdminMode(client, ui, false, wait);
        }
    } finally {
        if (originalEsig) {
            await _setEsig(client, ui, originalEsig, `Restoring the original e-signature settings on ${esig.options.join('/')}.`);
        }
    }

    return true;
}

async function _confirmAdminMode(ui, config) {
    const noAdminMode = config?.noAdminMode;
    if (noAdminMode !== undefined && noAdminMode !== false) {
        Logger.info('Skipping automatic Admin Mode because deployment configuration disallows it.', LOG_SOURCE);
        await ui.info(
            'The script deployment specifies that Admin Mode should not be applied, but the script cannot be deployed until the database configurations have been applied.\n\n' +
                MANUAL_CONFIG_MESSAGE
        );
        return false;
    }

    const answer = await ui.choose(
        Decision.ADMIN_MODE,
        'The script has deployment configurations that require Admin Mode to be applied.\n\n' +
            'This will logout all users and make the server unavailable while the configuration is performed. Do you want to continue?',
        { actions: ['Yes'] }
    );
    if (answer !== 'Yes') {
        Logger.info('User declined Admin Mode for database configuration.', LOG_SOURCE);
        await ui.info(NOT_APPLIED_MESSAGE);
        return false;
    }
    return true;
}

/**
 * @returns {Promise<object | null | false>} the e-signature settings to restore, null when none need disabling, false when the user declined
 */
async function _confirmEsigDisable(client, ui, { options, prompt }) {
    const current = await client.getAdminModeEsigEnabled();
    if (!current || !options.some((option) => current[option] === true)) {
        return null;
    }

    if ((await ui.choose(Decision.DISABLE_ESIG, prompt, { actions: ['Yes'] })) !== 'Yes') {
        Logger.info('User declined temporarily disabling e-signature for database configuration.', LOG_SOURCE);
        await ui.info(NOT_APPLIED_MESSAGE);
        return false;
    }
    return current;
}

async function _setEsig(client, ui, values, message) {
    Logger.info(message, LOG_SOURCE);
    await ui.withProgress({ cancellable: false, title: 'E-signature' }, async (progress) => {
        progress.report({ message });
        await client.setAdminModeEsigEnabled(values);
        progress.report({ increment: 100 });
    });
}

async function _setAdminMode(client, ui, on, wait) {
    const label = on ? 'On' : 'Off';
    await ui.withProgress({ cancellable: false, title: 'Admin Mode' }, async (progress) => {
        progress.report({ message: `Requesting Admin Mode ${label}` });
        await client.setAdminMode(on);
        await wait();
        progress.report({ message: `Requested Admin Mode ${label}` });

        while ((await client.isAdminModeOn()) !== on) {
            await wait();
            progress.report({ message: `Waiting for Admin Mode ${label}` });
        }
        if (!on) {
            await wait();
        }
        progress.report({ increment: 100, message: `Admin Mode is ${label}` });
    });
}

async function _applyDbConfig(client, ui, adminMode, wait) {
    await ui.withProgress({ cancellable: false, title: 'Database Configuration' }, async (progress) => {
        await client.applyDBConfig();
        progress.report({ message: 'Requested database configuration start' });

        if (adminMode) {
            // Wait for the configuration to start, so Admin Mode is not turned off before it runs.
            while ((await client.dbConfigInProgress()) === false) {
                await wait();
            }
        } else {
            await wait();
        }

        while ((await client.dbConfigInProgress()) === true) {
            await wait();
            progress.report({ message: adminMode ? await _latestDbConfigMessage(client) : 'Waiting for database configuration to complete' });
        }
        progress.report({ increment: 100, message: 'Database configuration is complete' });
    });
}

async function _latestDbConfigMessage(client) {
    const messages = await client.dbConfigMessages();
    if (messages.length === 0) {
        return 'Waiting for database configuration to complete';
    }

    const lines = messages.split('\n');
    const failure = lines.find((line) => DB_CONFIG_ERROR.test(line) || line.startsWith('BMXAA6819I'));
    if (failure) {
        Logger.error(`Database configuration failed: ${failure}`, null, LOG_SOURCE);
        throw new Error('An error occurred during database configuration: ' + failure);
    }
    return lines[lines.length - 1];
}
