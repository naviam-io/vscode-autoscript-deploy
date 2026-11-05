/* eslint-disable no-undef */
/*
 * Proves that _retain preserves customer managed escalation values across a redeployment, including
 * the escalation points the customer added, and that it has no effect when the escalation is first
 * created.
 *
 * The sequence mirrors a real product upgrade: install release 1, let the customer change the
 * values they own, then deploy release 2 with _retain and check that the customer's values survived
 * while everything else moved to the new release. The escalation condition matches no record, so the
 * escalation never acts while it is active.
 */
import { assertEquals } from '../harness.js';
import { createCommTemplates, deleteCommTemplates } from '../comm-templates.js';
import { loadFixture } from '../round-trip.js';

const ESCALATION = 'NVTEST_RETAINESC';
const PRODUCT_ACTION = 'NVTEST_ESC_PRODUCT';
const CUSTOMER_ACTION = 'NVTEST_ESC_CUSTOMER';
const ACTIONS = [PRODUCT_ACTION, CUSTOMER_ACTION, 'NVTEST_ESC_PRODHOST', 'NVTEST_ESC_CUSTHOST'];
const PRODUCT_TEMPLATE = 'NVTESTESCPROD';
const CUSTOMER_TEMPLATE = 'NVTESTESCCUST';
const TEMPLATES = [PRODUCT_TEMPLATE, CUSTOMER_TEMPLATE];

// The escalation goes first and the action groups before their members, so nothing is deleted while
// another record still refers to it.
const DELETE = {
    escalations: [{ _delete: true, escalation: ESCALATION }],
    actions: ACTIONS.map((action) => ({ _delete: true, action: action }))
};

async function extractEscalation(client) {
    const extracted = await client.extract('escalations', ESCALATION);
    if (!extracted) {
        throw new Error('Escalation ' + ESCALATION + ' was not found');
    }

    return extracted;
}

function findPoint(escalation, refPointNum) {
    return (escalation.escRefPoint || []).find((point) => point.refPointNum === refPointNum) || null;
}

function notificationsOf(point) {
    return (point.escNotification || [])
        .map((notification) => notification.templateId)
        .sort()
        .join(', ');
}

function pointNumbered(escalation, refPointNum) {
    const point = findPoint(escalation, refPointNum);
    if (!point) {
        throw new Error('Extracted escalation has no escalation point ' + refPointNum);
    }

    return point;
}

export default {
    name: 'escalation-retained-values',
    run: async (client) => {
        const fixture = loadFixture('escalation-retained-values');

        await client.deployConfig(DELETE);
        assertEquals(await client.extract('escalations', ESCALATION), null, 'Escalation ' + ESCALATION + ' left over from an earlier run');

        try {
            await createCommTemplates(client, 'REPORTJOB', TEMPLATES);

            // Release 1 already declares _retain, which must not stop a new escalation receiving the
            // shipped values.
            await client.deployConfig(fixture.productV1);

            const installed = await extractEscalation(client);
            assertEquals(installed.active, false, 'First deploy installs the shipped active flag');
            assertEquals(installed.schedule, '1h,*,0,*,*,*,*,*,*,*', 'First deploy installs the shipped schedule');
            const installedPoint = pointNumbered(installed, 1);
            assertEquals(installedPoint.elapsedInterval, 10, 'First deploy installs the shipped elapsed interval');
            assertEquals(installedPoint.action, PRODUCT_ACTION, 'First deploy installs the shipped action');
            assertEquals(installedPoint.eventCondition, "reportname = 'RELEASE1'", 'First deploy installs the shipped event condition');
            assertEquals(notificationsOf(installedPoint), PRODUCT_TEMPLATE, 'First deploy installs the shipped notification');

            await client.deployConfig(fixture.customerEdit);
            await client.deployConfig(fixture.productV2);

            const upgraded = await extractEscalation(client);
            assertEquals(upgraded.active, true, 'Redeploy keeps the escalation the customer activated');
            assertEquals(upgraded.schedule, '30m,*,*,*,*,*,*,*,*,*', 'Redeploy keeps the customer schedule');
            assertEquals(upgraded.description, 'Retained values test, release 2', 'description is not retained, so it follows the product');

            const retained = pointNumbered(upgraded, 1);
            assertEquals(retained.elapsedInterval, 30, 'Existing escalation point keeps the customer elapsed interval');
            assertEquals(retained.action, CUSTOMER_ACTION, 'Existing escalation point keeps the customer action');
            assertEquals(retained.eventCondition, undefined, 'Existing escalation point keeps the event condition the customer cleared');
            assertEquals(
                notificationsOf(retained),
                CUSTOMER_TEMPLATE + ', ' + PRODUCT_TEMPLATE,
                'Existing escalation point keeps the notification the customer added'
            );

            // The product payload never mentions point 2. It survives only because the escalation
            // declares _retain: ["escRefPoint"].
            const customerAdded = pointNumbered(upgraded, 2);
            assertEquals(customerAdded.eventAttribute, 'LASTACTIVETIME', 'Customer added escalation point keeps its event attribute');
            assertEquals(customerAdded.elapsedInterval, 5, 'Customer added escalation point keeps its elapsed interval');

            // A second edit must survive the next upgrade too. If the first upgrade had left its
            // snapshot behind, this upgrade would revert to the values captured before it.
            await client.deployConfig(fixture.customerEditAgain);
            await client.deployConfig(fixture.productV2);

            assertEquals(pointNumbered(await extractEscalation(client), 1).elapsedInterval, 45, 'A stale snapshot was left behind by the first upgrade');

            // Collection retention is opt-in. The same release without the declaration must destroy
            // the customer's escalation point, which is the behaviour every payload has today.
            await client.deployConfig(fixture.productV2NoCollectionRetain);

            const afterOptOut = await extractEscalation(client);
            assertEquals(findPoint(afterOptOut, 2), null, 'Customer added escalation point survived without _retain on the collection');
            assertEquals(pointNumbered(afterOptOut, 1).elapsedInterval, 45, 'Point retention still applies when the collection is not retained');
        } finally {
            await client.deployConfig(DELETE);
            await deleteCommTemplates(client, TEMPLATES);
        }

        assertEquals(await client.extract('escalations', ESCALATION), null, 'Extract of escalation "' + ESCALATION + '" after delete');
        for (const action of ACTIONS) {
            assertEquals(await client.extract('actions', action), null, 'Extract of action "' + action + '" after delete');
        }
    }
};
