import { confirmRetainedSnapshots } from './retained-snapshot-gate.js';
import { declaresObjects, performDatabaseConfiguration } from './database-configuration.js';

/**
 * Deploys declarative Maximo configuration, then applies the database configuration when it declares
 * objects, unless it sets noDBConfig or the caller applies it separately.
 *
 * @param {*} client the Maximo client
 * @param {import('../ui.js').Ui} ui
 * @param {object|string} config the configuration to apply
 * @param {{ databaseConfiguration?: boolean }} [options] false when the caller applies the database configuration itself
 * @returns {Promise<boolean>} whether the configuration was applied
 */
export async function deployConfig(client, ui, config, { databaseConfiguration = true } = {}) {
    if (!(await confirmRetainedSnapshots(client, ui, config))) {
        return false;
    }

    const applied = await ui.withProgress(
        {
            title: 'Deploying Configurations',
            cancellable: true
        },
        async (progress, cancelToken) => {
            progress.report({ message: '$(gear) Configuring settings...' });
            try {
                await client.postConfig(config, cancelToken, progress);
                return true;
            } catch (error) {
                ui.error(`${error.message}`);
                return false;
            }
        }
    );

    if (!applied || !databaseConfiguration) {
        return applied;
    }

    const parsed = typeof config === 'string' ? JSON.parse(config) : config;
    if (!parsed || !declaresObjects(parsed) || (typeof parsed.noDBConfig !== 'undefined' && parsed.noDBConfig !== false)) {
        return true;
    }

    return await performDatabaseConfiguration(client, ui, parsed);
}
