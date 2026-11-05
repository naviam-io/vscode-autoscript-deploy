/* eslint-disable no-undef */
/*
 * Proves that _retain preserves customer managed values of an object, its attributes and its
 * relationships across a redeployment, and that it has no effect when the object is first created.
 *
 * Release 2 names the object, attribute and relationship in lower case, as payloads written before
 * the names were upper cased did, so its retained values must still be matched with the stored rows.
 * Database Configuration is never applied: the values live in the configuration tables either way.
 */
import { assertEquals } from '../harness.js';
import { loadFixture } from '../round-trip.js';

const OBJECT = 'NVTEST_RETAINOBJ';
const DELETE = { objects: [{ _delete: true, object: OBJECT }] };

async function extractObject(client) {
    const extracted = await client.extract('objects', OBJECT);
    if (!extracted) {
        throw new Error('Object ' + OBJECT + ' was not found');
    }

    return extracted;
}

function row(rows, property, name) {
    const found = (rows || []).find((candidate) => candidate[property] === name);
    if (!found) {
        throw new Error('Extracted object has no ' + property + ' ' + name);
    }

    return found;
}

export default {
    name: 'object-retained-values',
    run: async (client) => {
        const fixture = loadFixture('object-retained-values');

        // A deleted object stays marked for removal until Database Configuration, which extraction treats as gone.
        await client.deployConfig(DELETE);
        assertEquals(await client.extract('objects', OBJECT), null, 'Object ' + OBJECT + ' left over from an earlier run');

        try {
            // Release 1 already declares _retain, which must not stop a new object receiving the shipped values,
            // nor a previous run's object marked for removal lend it its values.
            await client.deployConfig(fixture.productV1);

            const installed = await extractObject(client);
            assertEquals(installed.description, 'Retained values test, release 1', 'First deploy installs the shipped description');
            assertEquals(row(installed.attributes, 'attribute', 'NVTEST_NOTE').length, 50, 'First deploy installs the shipped length');
            assertEquals(row(installed.attributes, 'attribute', 'NVTEST_NOTE').title, 'Note', 'First deploy installs the shipped title');
            assertEquals(row(installed.relationships, 'relationship', 'NVTEST_RETAIN_WO').whereClause, '1=0', 'First deploy installs the shipped where clause');

            await client.deployConfig(fixture.customerEdit);
            await client.deployConfig(fixture.productV2);

            const upgraded = await extractObject(client);
            assertEquals(upgraded.description, 'Customer description', 'Redeploy keeps the customer object description');
            const note = row(upgraded.attributes, 'attribute', 'NVTEST_NOTE');
            assertEquals(note.length, 200, 'Redeploy keeps the customer attribute length');
            assertEquals(note.title, 'Customer note', 'Redeploy keeps the customer attribute title');
            assertEquals(note.description, 'Note, release 2', 'The attribute description is not retained, so it follows the product');
            assertEquals(row(upgraded.attributes, 'attribute', 'NVTEST_ADDED').length, 20, 'A new attribute receives the shipped values');
            const relationship = row(upgraded.relationships, 'relationship', 'NVTEST_RETAIN_WO');
            assertEquals(relationship.whereClause, '1=2', 'Redeploy keeps the customer where clause');
            assertEquals(relationship.remarks, 'Release 2', 'The relationship remarks are not retained, so they follow the product');

            assertEquals((await client.listRetainedSnapshots(fixture.productV2)).length, 0, 'The redeploy left its snapshot behind');

            // Deploying the same release again changes nothing.
            await client.deployConfig(fixture.productV2);
            assertEquals(row((await extractObject(client)).attributes, 'attribute', 'NVTEST_NOTE').length, 200, 'A repeated redeploy keeps the customer length');

            // Retention is opt-in. The same release without the declarations installs the shipped values.
            await client.deployConfig(fixture.productV2NoRetain);

            const optedOut = await extractObject(client);
            assertEquals(optedOut.description, 'Retained values test, release 2', 'The description follows the product without _retain');
            assertEquals(row(optedOut.attributes, 'attribute', 'NVTEST_NOTE').length, 60, 'The length follows the product without _retain');
            assertEquals(row(optedOut.relationships, 'relationship', 'NVTEST_RETAIN_WO').whereClause, '1=3', 'The where clause follows the product without _retain');
        } finally {
            await client.deployConfig(DELETE);
        }

        assertEquals(await client.extract('objects', OBJECT), null, 'Extract of object "' + OBJECT + '" after delete');
    }
};
