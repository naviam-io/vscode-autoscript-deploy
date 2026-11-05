/* eslint-disable no-undef */
/*
 * Proves that _retain preserves customer managed logger values across a redeployment, and that it
 * has no effect when the logger is first created.
 *
 * The root and its child share one name, as Maximo's own sql and crontaskmgr loggers do, so the test
 * also proves each is found, retained and deleted on its own: the root by its log key, the child under
 * its parent, and a payload without a log key only once the name is no longer shared.
 *
 * The sequence mirrors a real product upgrade: install release 1, let the customer change the
 * values they own, then deploy release 2 with _retain and check that the customer's values survived
 * while everything else moved to the new release.
 */
import { assertEquals } from '../harness.js';
import { loadFixture } from '../round-trip.js';

const NAME = 'testretainlogger';
const ROOT_KEY = 'log4j.logger.maximo.' + NAME;
const DELETE_CHILD = { loggers: [{ _delete: true, logger: NAME, parent: NAME }] };
const DELETE_ROOT = { loggers: [{ _delete: true, logger: NAME, logKey: ROOT_KEY }] };

/** Extract finds a logger by name, which is not unique here, so the candidates are told apart by parent. */
async function findLogger(client, isChild) {
    const list = await client.getObjectList('loggers');
    for (const item of list.filter((entry) => entry.label === NAME)) {
        const logger = await client.getObjectDetail('loggers', item.id);
        if (isChild ? logger.parentLogKey === ROOT_KEY : !logger.parentLogKey && logger.logKey === ROOT_KEY) {
            return logger;
        }
    }

    return null;
}

async function extractLogger(client, isChild) {
    const logger = await findLogger(client, isChild);
    if (!logger) {
        throw new Error((isChild ? 'Child logger ' : 'Logger ') + NAME + ' was not found');
    }

    return logger;
}

async function deleteAll(client) {
    await client.deployConfig(DELETE_CHILD);
    await client.deployConfig(DELETE_ROOT);
}

export default {
    name: 'logger-retained-values',
    run: async (client) => {
        const fixture = loadFixture('logger-retained-values');

        await deleteAll(client);
        assertEquals(await findLogger(client, true), null, 'Child logger left over from an earlier run');
        assertEquals(await findLogger(client, false), null, 'Logger left over from an earlier run');

        try {
            // Release 1 already declares _retain, which must not stop a new logger receiving the
            // shipped values.
            await client.deployConfig(fixture.productV1);

            const installed = await extractLogger(client, false);
            assertEquals(installed.logLevel, 'INFO', 'First deploy installs the shipped log level');
            assertEquals(installed.appenders, 'Console', 'First deploy installs the shipped appenders');
            const installedChild = await extractLogger(client, true);
            assertEquals(installedChild.active, true, 'First deploy installs the shipped child active flag');
            assertEquals(installedChild.logLevel, 'ERROR', 'First deploy installs the shipped child log level');

            await client.deployConfig(fixture.customerEdit);
            await client.deployConfig(fixture.productV2);

            const upgraded = await extractLogger(client, false);
            assertEquals(upgraded.logLevel, 'DEBUG', 'Redeploy keeps the customer log level');
            assertEquals(upgraded.appenders, 'Rolling', 'Redeploy keeps the customer appenders');
            assertEquals(upgraded.active, true, 'active is not retained on the root, so it follows the product');
            const upgradedChild = await extractLogger(client, true);
            assertEquals(upgradedChild.active, false, 'Redeploy keeps the customer child active flag');
            assertEquals(upgradedChild.logLevel, 'WARN', 'logLevel is not retained on the child, so it follows the product');

            // A second edit must survive the next upgrade too. If the first upgrade had left its
            // snapshot behind, this upgrade would revert to the values captured before it. Clearing
            // the appenders also proves a retained value the customer emptied stays empty.
            await client.deployConfig(fixture.customerEditCleared);
            await client.deployConfig(fixture.productV2);

            const upgradedAgain = await extractLogger(client, false);
            assertEquals(upgradedAgain.logLevel, 'FATAL', 'A stale snapshot was left behind by the first upgrade');
            assertEquals(upgradedAgain.appenders, undefined, 'Appenders the customer cleared stay cleared');
            assertEquals((await extractLogger(client, true)).active, true, 'Child keeps the second customer active flag');

            // Two loggers carry the name and the payload gives no log key, so the deployment must
            // refuse to pick one.
            let ambiguity = null;
            try {
                await client.deployConfig(fixture.ambiguous);
            } catch (error) {
                ambiguity = error.message;
            }
            assertEquals(
                ambiguity !== null && ambiguity.indexOf('More than one logger is named ' + NAME) !== -1,
                true,
                'Ambiguous name is rejected: ' + ambiguity
            );

            await client.deployConfig(DELETE_CHILD);
            assertEquals(await findLogger(client, true), null, 'Child logger after its delete');
            assertEquals((await extractLogger(client, false)).logLevel, 'FATAL', 'Deleting the child leaves the root of the same name');

            await client.deployConfig(fixture.byName);
            assertEquals((await extractLogger(client, false)).logLevel, 'ERROR', 'A payload without a log key finds the root by its unique name');
        } finally {
            await deleteAll(client);
        }

        assertEquals(await findLogger(client, true), null, 'Child logger "' + NAME + '" after delete');
        assertEquals(await findLogger(client, false), null, 'Logger "' + NAME + '" after delete');
    }
};
