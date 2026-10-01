import { ProgressLocation, window } from 'vscode';

import confirmRetainedSnapshots from './confirm-retained-snapshots';

/**
 * Deploys declarative Maximo configuration.
 *
 * @param {*} client the Maximo client
 * @param {object|string} config the configuration to apply
 * @returns {Promise<boolean>} whether the configuration was applied
 */
export default async function deployConfig(client, config) {
    if (!(await confirmRetainedSnapshots(client, config))) {
        return false;
    }

    return await window.withProgress(
        {
            title: 'Deploying Configurations',
            location: ProgressLocation.Notification,
            cancellable: true
        },
        async (progress, cancelToken) => {
            progress.report({ message: '$(gear) Configuring settings...' });
            try {
                await client.postConfig(config, cancelToken, progress);
                return true;
            } catch (error) {
                window.showErrorMessage(`${error.message}`, { modal: true });
                return false;
            }
        }
    );
}
