import { window } from 'vscode';

import { declaresRetainMarkers, describeSnapshotRecord, formatSnapshotAge } from '../deploy/retained-snapshots';
import Logger from '../logger';

const LOG_SOURCE = 'ConfirmRetainedSnapshots';

/**
 * Shared deployment gate, not a registered command: settles what happens to any retained values
 * snapshot an earlier, incomplete deployment left behind for the records this payload replaces.
 *
 * Used by every path that deploys configuration, so the choice is offered once wherever the
 * deployment started. See docs/modules/nashorn-library.md.
 *
 * @param {*} client the Maximo client
 * @param {string|Buffer|object} config the deployment payload that is about to be sent
 * @returns {Promise<boolean>} whether the deployment should proceed
 */
export default async function confirmRetainedSnapshots(client, config) {
    if (!client || !declaresRetainMarkers(config)) {
        return true;
    }

    let snapshots;
    try {
        snapshots = await client.listRetainedSnapshots(config);
    } catch (error) {
        Logger.error(`Could not read retained values snapshots: ${error.message}`, error, LOG_SOURCE);
        const proceed = await window.showWarningMessage(
            'Maximo could not be asked whether an earlier deployment left retained values snapshots behind.\n\n' +
                'Continuing may restore values captured by a deployment that did not complete, discarding any repair made since.',
            { modal: true, detail: error.message },
            'Continue'
        );
        return proceed === 'Continue';
    }

    if (!snapshots || snapshots.length === 0) {
        return true;
    }

    Logger.info(`Found ${snapshots.length} retained values snapshot(s) left by an incomplete deployment.`, LOG_SOURCE);

    const discard = [];
    for (const snapshot of snapshots) {
        const record = describeSnapshotRecord(snapshot);
        const age = formatSnapshotAge(snapshot.capturedOn);

        const choice = await window.showWarningMessage(
            `A deployment that did not complete left retained values for ${record}, captured ${age}.\n\nRestore those values, or discard them and use the record as it is in Maximo now?`,
            {
                modal: true,
                detail:
                    'Restore applies the captured values, which is what an immediate retry needs. ' +
                    'Discard throws them away, which is what a record repaired since needs. Cancel abandons the deployment without changing anything.'
            },
            'Restore',
            'Discard'
        );

        if (choice === 'Restore') {
            Logger.info(`Restoring the retained values snapshot for ${record}.`, LOG_SOURCE);
        } else if (choice === 'Discard') {
            Logger.info(`Discarding the retained values snapshot for ${record}.`, LOG_SOURCE);
            discard.push(snapshot.key);
        } else {
            Logger.info('Deployment abandoned at the retained values snapshot prompt.', LOG_SOURCE);
            return false;
        }
    }

    if (discard.length > 0) {
        try {
            await client.discardRetainedSnapshots(discard);
        } catch (error) {
            Logger.error(`Could not discard retained values snapshots: ${error.message}`, error, LOG_SOURCE);
            await window.showErrorMessage(`The retained values snapshots could not be discarded: ${error.message}`, { modal: true });
            return false;
        }
    }

    return true;
}
