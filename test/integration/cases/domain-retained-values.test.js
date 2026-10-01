/* eslint-disable no-undef */
/*
 * Proves that _retain preserves customer managed domain values across a redeployment.
 *
 * This is the failure the feature exists for: a product ships a domain the customer then tunes, and
 * every later release of that product used to wipe the tuning. The sequence mirrors that upgrade:
 * install release 1, let the customer edit and extend the values they own, then deploy release 2
 * with _retain and check that the customer's values survived while everything else moved on.
 */
const { assertEquals } = require('../harness');
const { loadFixture } = require('../round-trip');

const DOMAIN_ID = 'TEST_RETAIN_DOM';
// The extraction list reports the domain type alongside the identifier.
const DOMAIN_LABEL = DOMAIN_ID + ' (ALN)';

function findValue(extracted, value) {
    const values = extracted.alnDomain || [];
    for (let index = 0; index < values.length; index++) {
        if (values[index].value === value) {
            return values[index];
        }
    }

    return null;
}

function valueNamed(extracted, value) {
    const found = findValue(extracted, value);
    if (!found) {
        throw new Error('Extracted domain has no value named ' + value);
    }

    return found;
}

module.exports = {
    name: 'domain-retained-values',
    run: async (client) => {
        const fixture = loadFixture('domain-retained-values');

        try {
            await client.deployConfig(fixture.productV1);
            await client.deployConfig(fixture.customerEdit);
            await client.deployConfig(fixture.productV2);

            const extracted = await client.extract('domains', DOMAIN_LABEL);

            assertEquals(extracted.description, 'Retained values test, release 2', 'Domain description is not retained, so it follows the product');

            const retained = valueNamed(extracted, 'RETVAL1');
            assertEquals(retained.description, 'Value one, renamed by the customer', 'Existing value keeps the customer description');

            const added = valueNamed(extracted, 'RETVAL2');
            assertEquals(added.description, 'Value two, new in release 2', 'New value gets the product description');

            // The product payload never mentions CUSTVAL. It survives only because the domain
            // declares _retain: ["alnDomain"].
            const customerAdded = valueNamed(extracted, 'CUSTVAL');
            assertEquals(customerAdded.description, 'Value the customer added, unknown to the product', 'Customer added value keeps its description');

            // The snapshot must have been discarded after the successful deployment. If it survived,
            // this second customer edit would be reverted to the values captured before productV2.
            await client.deployConfig(fixture.customerEdit);
            await client.deployConfig(fixture.productV2);

            const afterSecondUpgrade = await client.extract('domains', DOMAIN_LABEL);
            assertEquals(
                valueNamed(afterSecondUpgrade, 'RETVAL1').description,
                'Value one, renamed by the customer',
                'A stale snapshot was left behind by the first upgrade'
            );

            // Collection retention is opt-in. The same release without the declaration must destroy
            // the customer's value, which is the behaviour every payload has today.
            await client.deployConfig(fixture.productV2NoCollectionRetain);

            const afterOptOut = await client.extract('domains', DOMAIN_LABEL);
            assertEquals(findValue(afterOptOut, 'CUSTVAL'), null, 'Customer added value survived without _retain on the collection');
            assertEquals(
                valueNamed(afterOptOut, 'RETVAL1').description,
                'Value one, renamed by the customer',
                'Scalar retention still applies when the collection is not retained'
            );
        } finally {
            await client.deployConfig({ domains: [{ _delete: true, domainId: DOMAIN_ID, domainType: 'ALN' }] });
        }

        const afterDelete = await client.extract('domains', DOMAIN_LABEL);
        assertEquals(afterDelete, null, 'Extract of domain "' + DOMAIN_ID + '" after delete');
    }
};
