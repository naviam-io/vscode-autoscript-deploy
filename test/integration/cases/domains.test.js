/* eslint-disable no-undef */
const { assertEquals } = require('../harness');
const { roundTrip } = require('../round-trip');

module.exports = {
    name: 'domains',
    run: async (client) => {
        const domainTypes = await client.synonymMap('DOMTYPE');
        await roundTrip(client, {
            fixture: 'domains',
            payloadKey: 'domains',
            objectType: 'domains',
            identityProperty: 'domainId',
            // The extraction list reports the external domain type alongside the identifier.
            extractLabel: (item) => item.domainId + ' (' + domainTypes[item.domainType] + ')',
            compareFixture: true
        });

        // A synonym domain cannot be created, so the extraction of its value conditions is checked
        // against INSPFIELDTYPE, which Maximo ships with conditions.
        const synonym = await client.extract('domains', 'INSPFIELDTYPE (' + domainTypes.SYNONYM + ')');
        const conditions = synonym.synonymDomain.filter((value) => value.maxDomValCond && value.maxDomValCond.length > 0);
        assertEquals(conditions.length > 0, true, 'Extract of domain INSPFIELDTYPE includes its value conditions');
    }
};
