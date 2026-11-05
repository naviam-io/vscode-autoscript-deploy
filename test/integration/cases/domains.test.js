/* eslint-disable no-undef */
import { assertEquals } from '../harness.js';
import { loadFixture, localizedValue, roundTrip } from '../round-trip.js';

const PLAIN_DOMAIN_ID = 'TEST_PLAINDOM';

function tableDomain(domainId, domainType) {
    const table = loadFixture('domains').domains.find((domain) => domain.domainId === 'TEST_TABLEDOM');
    return { domains: [Object.assign({}, table, { domainId, domainType })] };
}

async function expectDeployToFail(client, config, expectedText) {
    try {
        await client.deployConfig(config);
    } catch (error) {
        expectedText.forEach((text) =>
            assertEquals(error.message.indexOf(text) !== -1, true, 'The deploy error names ' + text + ', it reported: ' + error.message)
        );
        return;
    }

    throw new Error('Deploying ' + JSON.stringify(config.domains[0].domainType) + ' as the domain type was expected to fail, but it succeeded.');
}

export default {
    name: 'domains',
    run: async (client) => {
        const domainTypes = await client.synonymMap('DOMTYPE');
        await roundTrip(client, {
            fixture: 'domains',
            payloadKey: 'domains',
            objectType: 'domains',
            identityProperty: 'domainId',
            synonymDomains: { domainType: 'DOMTYPE' },
            // The extraction list reports the localized domain type alongside the identifier.
            extractLabel: (item) => item.domainId + ' (' + localizedValue(domainTypes, item.domainType) + ')',
            compareFixture: true
        });

        // A plain value is the localized value, as extraction writes it, and deploys unchanged.
        const plainLabel = PLAIN_DOMAIN_ID + ' (' + domainTypes.MAXTABLE + ')';
        try {
            await client.deployConfig(tableDomain(PLAIN_DOMAIN_ID, domainTypes.MAXTABLE));
            const extracted = await client.extract('domains', plainLabel);
            assertEquals(extracted && extracted.domainType, domainTypes.MAXTABLE, 'Extracted domain type of a plain localized value');
            assertEquals((extracted.tableDomain || []).length, 1, 'A plain localized table domain type is applied as a table domain');
        } finally {
            await client.deployConfig({ domains: [{ domainId: PLAIN_DOMAIN_ID, _delete: true }] });
        }
        assertEquals(await client.extract('domains', plainLabel), null, 'Extract of ' + plainLabel + ' after delete');

        // Neither an unknown internal value nor a malformed one may create the domain.
        try {
            await expectDeployToFail(client, tableDomain(PLAIN_DOMAIN_ID, '!NOSUCHTYPE!'), ['!NOSUCHTYPE!', 'DOMTYPE']);
            await expectDeployToFail(client, tableDomain(PLAIN_DOMAIN_ID, '!MAXTABLE'), ['!MAXTABLE', '!VALUE!']);
        } finally {
            await client.deployConfig({ domains: [{ domainId: PLAIN_DOMAIN_ID, _delete: true }] });
        }

        // Synonym domains are product data that should not be changed, so only their extraction is
        // checked, read-only, against one Maximo ships. Value conditions differ between versions.
        const synonym = await client.extract('domains', 'INSPFIELDTYPE (' + domainTypes.SYNONYM + ')');
        assertEquals(synonym.synonymDomain.length > 0, true, 'Extract of domain INSPFIELDTYPE includes its values');
    }
};
