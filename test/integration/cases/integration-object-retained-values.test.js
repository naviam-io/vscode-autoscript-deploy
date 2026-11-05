/* eslint-disable no-undef */
/*
 * Proves that _retain preserves customer managed integration object values across a redeployment,
 * including the objects, columns, signature options and actions the customer added, and that it has
 * no effect when the integration object is first created.
 *
 * The sequence mirrors a real product upgrade: install release 1, let the customer change the values
 * they own, then deploy release 2 with _retain and check that the customer's values survived while
 * everything else moved to the new release. Release 2 no longer ships ASSETMETER, which the customer
 * extended, so retaining the objects keeps it as the parent of the customer's METERREADING.
 */
import { assertEquals } from '../harness.js';
import { loadFixture } from '../round-trip.js';

const INTEGRATION_OBJECT = 'NVTEST_RETAINIO';
const SCRIPTS = ['OSACTION.' + INTEGRATION_OBJECT + '.NVTESTPRODACT', 'OSACTION.' + INTEGRATION_OBJECT + '.NVTESTCUSTACT'];

const DELETE = { integrationObjects: [{ _delete: true, intObjectName: INTEGRATION_OBJECT }] };

function scriptSource(name, remove) {
    return [
        'var scriptConfig = {',
        '    "autoscript": "' + name + '",',
        remove ? '    "_delete": true' : '    "description": "Integration object retained values test action"',
        '};'
    ].join('\n');
}

async function deleteScripts(client) {
    for (const script of SCRIPTS) {
        await client.deployScriptSource(scriptSource(script, true));
    }
}

async function extractIntegrationObject(client) {
    const extracted = await client.extract('integrationobjects', INTEGRATION_OBJECT);
    if (!extracted) {
        throw new Error('Integration object ' + INTEGRATION_OBJECT + ' was not found');
    }

    return extracted;
}

function detailsOf(integrationObject) {
    return integrationObject.maxIntObjDetail.map((detail) => detail.objectName).join(', ');
}

function detailNamed(integrationObject, objectName) {
    const detail = integrationObject.maxIntObjDetail.find((row) => row.objectName === objectName);
    if (!detail) {
        throw new Error('Extracted integration object has no object ' + objectName);
    }

    return detail;
}

function columnsOf(detail) {
    return (detail.maxIntObjCols || [])
        .map((column) => column.name + ':' + column.intObjFldType)
        .sort()
        .join(', ');
}

function optionNamed(integrationObject, optionName) {
    return (integrationObject.sigOption || []).find((option) => option.optionName === optionName) || null;
}

function actionsOf(integrationObject) {
    return (integrationObject.osOSLCAction || [])
        .map((action) => action.name)
        .sort()
        .join(', ');
}

function templatesOf(integrationObject) {
    return (integrationObject.queryTemplate || []).filter((template) => template.templateName === 'NVTESTTPL');
}

export default {
    name: 'integration-object-retained-values',
    run: async (client) => {
        const fixture = loadFixture('integration-object-retained-values');

        await client.deployConfig(DELETE);
        await deleteScripts(client);
        assertEquals(
            await client.extract('integrationobjects', INTEGRATION_OBJECT),
            null,
            'Integration object ' + INTEGRATION_OBJECT + ' left over from an earlier run'
        );

        try {
            // Maximo only accepts a script action whose script is named for the object structure and action.
            for (const script of SCRIPTS) {
                const response = await client.deployScriptSource(scriptSource(script, false));
                assertEquals(response && response.status, 'success', 'Deploying script ' + script + ' reported ' + JSON.stringify(response));
            }

            // Release 1 already declares _retain, which must not stop a new integration object
            // receiving the shipped values.
            await client.deployConfig(fixture.productV1);

            const installed = await extractIntegrationObject(client);
            assertEquals(installed.description, 'Retained values test, release 1', 'First deploy installs the shipped description');
            assertEquals(installed.searchAttrs, undefined, 'First deploy installs no search attributes');
            assertEquals(detailsOf(installed), 'ASSET, ASSETMETER', 'First deploy installs the shipped objects');
            assertEquals(detailNamed(installed, 'ASSET').skipKeyUpdate, undefined, 'First deploy installs the shipped skip key update flag');
            assertEquals(columnsOf(detailNamed(installed, 'ASSET')), 'ROWSTAMP:EXCLUDE', 'First deploy installs the shipped columns');
            assertEquals(optionNamed(installed, 'NVTESTPROD').description, 'Product option, release 1', 'First deploy installs the shipped option');
            assertEquals(actionsOf(installed), 'NVTESTPRODACT', 'First deploy installs the shipped action');
            assertEquals(templatesOf(installed).length, 1, 'First deploy installs one template');
            assertEquals(templatesOf(installed)[0].description, 'Product template, release 1', 'First deploy installs the shipped template');
            client.log('  query template owner: ' + templatesOf(installed)[0].owner);

            await client.deployConfig(fixture.customerEdit);
            await client.deployConfig(fixture.productV2);

            const upgraded = await extractIntegrationObject(client);
            assertEquals(upgraded.description, 'Retained values test, release 2', 'description is not retained, so it follows the product');
            assertEquals(upgraded.searchAttrs, 'ASSETNUM,DESCRIPTION', 'Redeploy keeps the customer search attributes');
            assertEquals(
                detailsOf(upgraded),
                'ASSET, ASSETMETER, METERREADING, ASSETSPEC',
                'Redeploy keeps the objects the customer added, and the one the product dropped as their parent, in the depth first processing order'
            );
            assertEquals(detailNamed(upgraded, 'ASSET').skipKeyUpdate, true, 'Existing object keeps the customer skip key update flag');
            assertEquals(
                columnsOf(detailNamed(upgraded, 'ASSET')),
                'ROWSTAMP:EXCLUDE, VENDOR:EXCLUDE',
                'Existing object keeps the column the customer excluded'
            );
            assertEquals(optionNamed(upgraded, 'NVTESTPROD').description, 'Customer option', 'Existing option keeps the customer description');
            assertEquals(optionNamed(upgraded, 'NVTESTCUST') !== null, true, 'Redeploy keeps the option the customer added');
            assertEquals(actionsOf(upgraded), 'NVTESTCUSTACT, NVTESTPRODACT', 'Redeploy keeps the action the customer added');
            assertEquals(templatesOf(upgraded).length, 1, 'The unowned template matched the existing one instead of being added twice');
            assertEquals(templatesOf(upgraded)[0].description, 'Customer template', 'Existing template keeps the customer description');

            // A second edit must survive the next upgrade too. If the first upgrade had left its
            // snapshot behind, this upgrade would revert to the values captured before it.
            await client.deployConfig(fixture.customerEditAgain);
            await client.deployConfig(fixture.productV2);
            assertEquals((await extractIntegrationObject(client)).searchAttrs, 'ASSETNUM,SITEID', 'A stale snapshot was left behind by the first upgrade');

            // Without the options and actions retained, the customer's option and the action that needs it go.
            await client.deployConfig(fixture.productV2NoOptionRetain);

            const afterOptOut = await extractIntegrationObject(client);
            assertEquals(optionNamed(afterOptOut, 'NVTESTCUST'), null, 'Customer added option survived without _retain on the collection');
            assertEquals(actionsOf(afterOptOut), 'NVTESTPRODACT', 'The customer action went with the actions collection');
            assertEquals(
                optionNamed(afterOptOut, 'NVTESTPROD').description,
                'Customer option',
                'Option retention still applies when the collection is not retained'
            );

            assertEquals((await client.listRetainedSnapshots(fixture.productV2)).length, 0, 'A successful deployment left its snapshot behind');
        } finally {
            await client.deployConfig(DELETE);
            await deleteScripts(client);
        }

        assertEquals(
            await client.extract('integrationobjects', INTEGRATION_OBJECT),
            null,
            'Extract of integration object "' + INTEGRATION_OBJECT + '" after delete'
        );
        for (const script of SCRIPTS) {
            assertEquals(await client.findScript(script), null, 'Script ' + script + ' after delete');
        }
    }
};
