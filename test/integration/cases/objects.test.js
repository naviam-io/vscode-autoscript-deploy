/* eslint-disable no-undef */
const { roundTrip } = require('../round-trip');
const { assertEquals } = require('../harness');

// The extraction script does not cover objects, so the test reads MXOBJECTCFG and maps its columns back to
// the deploy JSON names that objects.ts writes them from.
const OBJECT_COLUMNS = {
    object: 'objectname',
    description: 'description',
    service: 'servicename',
    entity: 'entityname',
    class: 'classname',
    mainObject: 'mainobject',
    persistent: 'persistent',
    auditEnabled: 'eauditenabled',
    eAuditFilter: 'eauditfilter',
    eSignatureFilter: 'esigfilter'
};
const ATTRIBUTE_COLUMNS = {
    attribute: 'attributename',
    description: 'remarks',
    title: 'title',
    type: 'maxtype',
    length: 'length',
    required: 'required',
    persistent: 'persistent',
    primaryColumn: 'primarykeycolseq',
    searchType: 'searchtype',
    domain: 'domainid',
    defaultValue: 'defaultvalue',
    mustBe: 'mustbe',
    localizable: 'localizable',
    positive: 'ispositive',
    auditEnabled: 'eauditenabled',
    eSignatureEnabled: 'esigenabled'
};
const RELATIONSHIP_COLUMNS = { relationship: 'name', child: 'child', remarks: 'remarks', whereClause: 'whereclause', dbJoinRequired: 'dbjoinrequired', isDefault: 'isdefault' };
const INDEX_COLUMNS = { index: 'name', clusteredIndex: 'clusterrule', required: 'required', textSearchIndex: 'textsearch' };
const COLUMN_COLUMNS = { column: 'colname', sequence: 'colseq' };

function pick(raw, columns) {
    const mapped = {};
    Object.keys(columns).forEach((field) => {
        if (raw[columns[field]] !== undefined) {
            mapped[field] = raw[columns[field]];
        }
    });
    return mapped;
}

// Synonym domain values are extracted in their external form, the fixture holds the internal one.
function internal(map, value) {
    return Object.keys(map).find((key) => map[key] === value) || value;
}

function mapObject(raw, synonyms) {
    // Deleting an object that Database Configuration has not applied only marks it for removal.
    if (!raw || raw.changed === 'R') {
        return null;
    }

    return Object.assign(pick(raw, OBJECT_COLUMNS), {
        level: internal(synonyms.SITEORGTYPE, raw.siteorgtype),
        attributes: (raw.maxattributecfg || []).map((attribute) => pick(attribute, ATTRIBUTE_COLUMNS)),
        relationships: (raw.maxrelationship || []).map((relationship) =>
            Object.assign(pick(relationship, RELATIONSHIP_COLUMNS), { cardinality: internal(synonyms.RPTCARDINALITY, relationship.cardinality) })
        ),
        indexes: (raw.maxsysindexes || []).map((index) =>
            Object.assign(pick(index, INDEX_COLUMNS), {
                enforceUniqueness: index.unique !== undefined ? index.unique : index.uniquerule === 'U',
                columns: (index.maxsyskeys || []).map((key) => Object.assign(pick(key, COLUMN_COLUMNS), { ascending: key.ordering === 'A' }))
            })
        )
    });
}

module.exports = {
    name: 'objects',
    run: async (client) => {
        const synonyms = { SITEORGTYPE: await client.synonymMap('SITEORGTYPE'), RPTCARDINALITY: await client.synonymMap('RPTCARDINALITY') };
        let raw = null;

        const options = {
            fixture: 'objects',
            payloadKey: 'objects',
            objectType: 'objects',
            identityProperty: 'object',
            extract: async (c, item) => {
                raw = await c.extractObjectCfg(item.object);
                return mapObject(raw, synonyms);
            },
            compareFixture: true,
            ignore: [
                // Database Configuration derives these when it applies the object, until then MAXOBJECTCFG does not hold them.
                'uniqueColumn',
                'triggerRoot',
                'addRowstamp',
                'textSearchEnabled',
                // The MXOBJECTCFG object structure does not include EAUDITTBNAME.
                'auditTable',
                // MAXRELATIONSHIP.ISDEFAULT does not exist before MAS 9.1, verified below instead.
                'relationships.isDefault'
            ],
            verify: (extracted, describe, warnings, infos) => {
                if (raw.maxrelationship[0].isdefault === undefined) {
                    const mentions = (messages) => messages.some((message) => message.indexOf('MAXRELATIONSHIP.ISDEFAULT') !== -1);
                    assertEquals(mentions(infos), true, 'Deploying ' + describe + ' reported that MAXRELATIONSHIP.ISDEFAULT does not exist');
                } else {
                    assertEquals(raw.maxrelationship[0].isdefault, true, describe + ' relationship isDefault');
                }
            }
        };

        // The first pass leaves the object marked CHANGED = 'R', so the second must restore it.
        await roundTrip(client, options);
        assertEquals(raw && raw.changed, 'R', 'The deleted object is marked for removal');
        await roundTrip(client, options);
    }
};
