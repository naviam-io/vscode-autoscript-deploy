import { declaresRetainMarkers, describeSnapshotRecord, formatSnapshotAge } from './retained-snapshots.js';
import Logger from '../log.js';
import { Decision } from '../ui.js';

const LOG_SOURCE = 'ConfirmRetainedSnapshots';

/**
 * Shared deployment gate, not a registered command: settles what happens to any retained values
 * snapshot an earlier, incomplete deployment left behind for the records this payload replaces.
 *
 * Used by every path that deploys configuration, so the choice is offered once wherever the
 * deployment started. See docs/modules/nashorn-library.md.
 *
 * @param {*} client the Maximo client
 * @param {import('../ui.js').Ui} ui
 * @param {string|Buffer|object} config the deployment payload that is about to be sent
 * @returns {Promise<boolean>} whether the deployment should proceed
 */
export async function confirmRetainedSnapshots(client, ui, config) {
    if (!client || !declaresRetainMarkers(config)) {
        return true;
    }

    let snapshots;
    try {
        snapshots = await client.listRetainedSnapshots(config);
    } catch (error) {
        Logger.error(`Could not read retained values snapshots: ${error.message}`, error, LOG_SOURCE);
        const proceed = await ui.choose(
            Decision.SNAPSHOT_LOOKUP_FAILED,
            'Maximo could not be asked whether an earlier deployment left retained values snapshots behind.\n\n' +
                'Continuing may restore values captured by a deployment that did not complete, discarding any repair made since.',
            { actions: ['Continue'], severity: 'warning', detail: error.message }
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

        const choice = await ui.choose(
            Decision.RETAINED_SNAPSHOT,
            `A deployment that did not complete left retained values for ${record}, captured ${age}.\n\nRestore those values, or discard them and use the record as it is in Maximo now?`,
            {
                actions: ['Restore', 'Discard'],
                severity: 'warning',
                detail:
                    'Restore applies the captured values, which is what an immediate retry needs. ' +
                    'Discard throws them away, which is what a record repaired since needs. Cancel abandons the deployment without changing anything.'
            }
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
            await ui.error(`The retained values snapshots could not be discarded: ${error.message}`);
            return false;
        }
    }

    return true;
}
