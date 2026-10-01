/* eslint-disable no-undef */
/*
 * Proves that _retain preserves customer managed cron task values across a redeployment.
 *
 * The sequence mirrors a real product upgrade: install release 1, let the customer change the
 * values they own, then deploy release 2 with _retain and check that the customer's values survived
 * while everything else moved to the new release.
 */
const { assertEquals } = require('../harness');
const { loadFixture } = require('../round-trip');

const CRON_TASK_NAME = 'TEST_RETAIN';

function instanceNamed(extracted, instanceName) {
    const instance = findInstance(extracted, instanceName);
    if (!instance) {
        throw new Error('Extracted cron task has no instance named ' + instanceName);
    }

    return instance;
}

function findInstance(extracted, instanceName) {
    const instances = extracted.cronTaskInstance || [];
    for (let index = 0; index < instances.length; index++) {
        if (instances[index].instanceName === instanceName) {
            return instances[index];
        }
    }

    return null;
}

function paramNamed(instance, parameter) {
    const params = instance.cronTaskParam || [];
    for (let index = 0; index < params.length; index++) {
        if (params[index].parameter === parameter) {
            return params[index];
        }
    }

    throw new Error('Extracted instance ' + instance.instanceName + ' has no parameter named ' + parameter);
}

module.exports = {
    name: 'cron-task-retained-values',
    run: async (client) => {
        const fixture = loadFixture('cron-task-retained-values');

        try {
            await client.deployConfig(fixture.productV1);
            await client.deployConfig(fixture.customerEdit);
            await client.deployConfig(fixture.productV2);

            const extracted = await client.extract('crontasks', CRON_TASK_NAME);

            assertEquals(extracted.description, 'Retained values test, release 2', 'Cron task description is not retained, so it follows the product');

            const retained = instanceNamed(extracted, 'RETAININST1');
            assertEquals(retained.schedule, '7d,0,0,0,*,*,*,*,*,*', 'Existing instance keeps the customer schedule');
            assertEquals(retained.keepHistory, false, 'Existing instance keeps the customer keepHistory');
            assertEquals(retained.maxHistory, 99, 'Existing instance keeps the customer maxHistory');
            assertEquals(retained.description, 'Instance one', 'Instance description is not retained, so it follows the product');
            assertEquals(paramNamed(retained, 'PURGETIME').value, '7D', 'Existing parameter keeps the customer value');
            assertEquals(paramNamed(retained, 'NOTFOSNAME').value, 'MXNOTIFICATION', 'Parameter without _retain follows the product');

            const added = instanceNamed(extracted, 'RETAININST2');
            assertEquals(added.schedule, '1d,0,0,0,*,*,*,*,*,*', 'New instance gets the product schedule');
            assertEquals(added.keepHistory, true, 'New instance gets the product keepHistory');
            assertEquals(added.maxHistory, 20, 'New instance gets the product maxHistory');

            // The product payload never mentions CUSTOMERINST. It survives only because the cron
            // task declares _retain: ["cronTaskInstance"].
            const customerAdded = instanceNamed(extracted, 'CUSTOMERINST');
            assertEquals(customerAdded.schedule, '30d,0,0,0,*,*,*,*,*,*', 'Customer added instance keeps its schedule');
            assertEquals(customerAdded.maxHistory, 42, 'Customer added instance keeps its maxHistory');
            assertEquals(paramNamed(customerAdded, 'PURGETIME').value, '30D', 'Customer added instance keeps its parameter values');

            // The snapshot must have been discarded after the successful deployment. If it survived,
            // this second customer edit would be reverted to the values captured before productV2.
            await client.deployConfig(fixture.customerEdit);
            await client.deployConfig(fixture.productV2);

            const afterSecondUpgrade = await client.extract('crontasks', CRON_TASK_NAME);
            const reRetained = instanceNamed(afterSecondUpgrade, 'RETAININST1');
            assertEquals(reRetained.maxHistory, 99, 'A stale snapshot was left behind by the first upgrade');

            // Collection retention is opt-in. The same release without the declaration must destroy
            // the customer's instance, which is the behaviour every payload has today.
            await client.deployConfig(fixture.productV2NoCollectionRetain);

            const afterOptOut = await client.extract('crontasks', CRON_TASK_NAME);
            assertEquals(findInstance(afterOptOut, 'CUSTOMERINST'), null, 'Customer added instance survived without _retain on the collection');
            assertEquals(instanceNamed(afterOptOut, 'RETAININST1').maxHistory, 99, 'Scalar retention still applies when the collection is not retained');
        } finally {
            await client.deployConfig({ cronTasks: [{ _delete: true, cronTaskName: CRON_TASK_NAME }] });
        }

        const afterDelete = await client.extract('crontasks', CRON_TASK_NAME);
        assertEquals(afterDelete, null, 'Extract of cron task "' + CRON_TASK_NAME + '" after delete');
    }
};
