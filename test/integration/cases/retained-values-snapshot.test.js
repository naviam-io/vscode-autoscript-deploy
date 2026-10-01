/* eslint-disable no-undef */
/*
 * Proves the pre-flight that lets a user decide what happens to a retained values snapshot an
 * earlier, incomplete deployment left behind.
 *
 * The snapshot is the interesting part and cannot be created by asking for one: it only survives
 * when a deployment captures it and then fails before it can discard it. This case arranges exactly
 * that, with an upgrade whose cron schedule Maximo rejects, and then exercises the two endpoints
 * the prompt is built on.
 *
 * The prompt itself is VS Code UI and is not covered here; what is covered is everything it depends
 * on being true.
 */
const { assertEquals, assertNotNull } = require('../harness');
const { loadFixture } = require('../round-trip');

const CRON_TASK_NAME = 'TEST_SNAPSHOT';

async function expectDeployToFail(client, config, because) {
    try {
        await client.deployConfig(config);
    } catch (error) {
        return error;
    }

    throw new Error('The deployment was expected to fail, ' + because + ', but it succeeded.');
}

module.exports = {
    name: 'retained-values-snapshot',
    run: async (client) => {
        const fixture = loadFixture('retained-values-snapshot');
        let leftover = [];

        try {
            await client.deployConfig(fixture.productV1);

            // Nothing declares _retain, so nothing was ever captured for this payload.
            assertEquals(
                (await client.listRetainedSnapshots(fixture.productV1)).length,
                0,
                'A payload that declares no _retain has no snapshot to report'
            );

            await expectDeployToFail(client, fixture.failingUpgrade, 'because its cron schedule is invalid');

            leftover = await client.listRetainedSnapshots(fixture.failingUpgrade);
            assertEquals(leftover.length, 1, 'The failed upgrade left exactly one snapshot behind');
            assertEquals(leftover[0].identity, CRON_TASK_NAME, 'The snapshot is reported against the record it belongs to');
            assertEquals(leftover[0].type, 'cronTasks', 'The snapshot is reported against the payload type it came from');
            assertEquals(leftover[0].object, 'CRONTASKDEF', 'The snapshot is keyed by the Maximo object');
            assertNotNull(leftover[0].key, 'The snapshot carries the key the discard call needs');
            assertEquals(typeof leftover[0].capturedOn, 'number', 'The snapshot carries the time it was captured, so its age can be reported');

            assertEquals(await client.discardRetainedSnapshots([leftover[0].key]), 1, 'Discarding reports the snapshot it deleted');

            leftover = await client.listRetainedSnapshots(fixture.failingUpgrade);
            assertEquals(leftover.length, 0, 'A discarded snapshot is gone, so the next deployment captures the live record');
        } finally {
            // Whatever failed above, neither the cron task nor the snapshot may survive this run.
            for (const snapshot of leftover) {
                await client.discardRetainedSnapshots([snapshot.key]);
            }
            await client.deployConfig(fixture.cleanup);
        }
    }
};
