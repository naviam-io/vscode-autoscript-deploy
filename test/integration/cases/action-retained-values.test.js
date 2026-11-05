/* eslint-disable no-undef */
/*
 * Proves that _retain preserves customer managed action values across a redeployment, including the
 * group members the customer added, and that it has no effect when the actions are first created.
 * A group member is identified by its sequence, because a sequence can hold one member of a group.
 * The customer adding a shipped member again at another sequence adds a row of its own, and a
 * shipped member replaces a customer member at its sequence.
 *
 * The sequence mirrors a real product upgrade: install release 1, let the customer change the
 * values they own, then deploy release 2 with _retain and check that the customer's values survived
 * while everything else moved to the new release.
 */
import { assertEquals } from '../harness.js';
import { loadFixture } from '../round-trip.js';

const SET = 'NVTEST_RETAIN_SET';
const APPR = 'NVTEST_RETAIN_APPR';
const CUSTOMER = 'NVTEST_RETAIN_CUSTOMER';
const GROUP = 'NVTEST_RETAIN_GROUP';

// The group goes first, so no member is deleted while a group still refers to it.
const DELETE = { actions: [GROUP, SET, APPR, CUSTOMER].map((action) => ({ _delete: true, action: action })) };

async function extractAction(client, action) {
    const extracted = await client.extract('actions', action);
    if (!extracted) {
        throw new Error('Action ' + action + ' was not found');
    }

    return extracted;
}

function membersOf(group) {
    return (group.actionGroup || [])
        .map((row) => row.member + '@' + row.sequence)
        .sort()
        .join(', ');
}

export default {
    name: 'action-retained-values',
    run: async (client) => {
        const fixture = loadFixture('action-retained-values');
        const useWith = await client.synonymMap('ACTIONUSEWITH');

        await client.deployConfig(DELETE);
        for (const action of [GROUP, SET, APPR, CUSTOMER]) {
            assertEquals(await client.extract('actions', action), null, 'Action ' + action + ' left over from an earlier run');
        }

        try {
            // Release 1 already declares _retain, which must not stop new actions receiving the
            // shipped values.
            await client.deployConfig(fixture.productV1);

            const installedSet = await extractAction(client, SET);
            assertEquals(installedSet.value, '1', 'First deploy installs the shipped value');
            assertEquals((await extractAction(client, APPR)).memo, 'Release 1 memo', 'First deploy installs the shipped memo');
            const installedGroup = await extractAction(client, GROUP);
            assertEquals(installedGroup.useWith, useWith.ALL, 'First deploy installs the shipped useWith');
            assertEquals(membersOf(installedGroup), APPR + '@2, ' + SET + '@1', 'First deploy installs the shipped members only');

            await client.deployConfig(fixture.customerEdit);
            await client.deployConfig(fixture.productV2);

            const upgradedSet = await extractAction(client, SET);
            assertEquals(upgradedSet.value, '5', 'Redeploy keeps the customer value');
            assertEquals(upgradedSet.description, 'Retained values test, release 2', 'description is not retained, so it follows the product');
            assertEquals((await extractAction(client, APPR)).memo, 'Memo written by the customer', 'Redeploy keeps the customer memo');

            const upgradedGroup = await extractAction(client, GROUP);
            assertEquals(upgradedGroup.useWith, useWith.ESCALATION, 'Redeploy keeps the customer useWith');
            assertEquals(upgradedGroup.description, 'Retained values test, release 2', 'Group description follows the product');
            assertEquals(
                membersOf(upgradedGroup),
                APPR + '@2, ' + CUSTOMER + '@7, ' + SET + '@1, ' + SET + '@8',
                'Redeploy keeps the members the customer added, including a shipped member at another sequence'
            );

            // A second edit must survive the next upgrade too. If the first upgrade had left its
            // snapshot behind, this upgrade would revert to the values captured before it. Clearing
            // the memo also proves a retained value the customer emptied stays empty, and the customer
            // replacing a shipped member proves the shipped member wins its sequence.
            await client.deployConfig(fixture.customerEditCleared);
            await client.deployConfig(fixture.productV2);

            assertEquals((await extractAction(client, SET)).value, '6', 'A stale snapshot was left behind by the first upgrade');
            assertEquals((await extractAction(client, APPR)).memo, undefined, 'Memo the customer cleared stays cleared');
            assertEquals(
                membersOf(await extractAction(client, GROUP)),
                APPR + '@2, ' + CUSTOMER + '@7, ' + SET + '@1, ' + SET + '@8',
                'The shipped member wins its sequence, and the members the customer added survive the second upgrade'
            );
        } finally {
            await client.deployConfig(DELETE);
        }

        for (const action of [GROUP, SET, APPR, CUSTOMER]) {
            assertEquals(await client.extract('actions', action), null, 'Extract of action "' + action + '" after delete');
        }
    }
};
