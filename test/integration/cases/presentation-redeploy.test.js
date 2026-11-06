/* eslint-disable no-undef */
/*
 * Deploys a large whole screen several times in a row: unchanged, with one label changed, then
 * unchanged again. Every deploy must succeed and leave one MAXLABELS row per label. Repeated
 * deploys of a screen with hundreds of labels are what exposed unreliable label matching inside
 * Maximo; see docs/modules/nashorn-library.md.
 */
import { assertEquals } from '../harness.js';

const APP = 'ASSET';
const CHANGED = 'NV Test Redeploy';

/** The app's MAXLABELS rows: how many, how many distinct id and property pairs, and the value of one label. */
async function labels(client, id) {
    const source = [
        'var MXServer = Java.type("psdi.server.MXServer");',
        'var SqlFormat = Java.type("psdi.mbo.SqlFormat");',
        'var set = MXServer.getMXServer().getMboSet("MAXLABELS", MXServer.getMXServer().getSystemUserInfo());',
        'var result = { rows: 0, keys: 0, value: null };',
        'var keys = new java.util.HashSet();',
        'try {',
        '    var sqlf = new SqlFormat("app = :1");',
        '    sqlf.setObject(1, "MAXLABELS", "APP", ' + JSON.stringify(APP) + ');',
        '    set.setWhere(sqlf.format());',
        '    set.setLogLargFetchResultDisabled(true);',
        '    var label = set.moveFirst();',
        '    while (label) {',
        '        result.rows++;',
        '        keys.add(label.getString("ID") + "." + label.getString("PROPERTY"));',
        '        if (label.getString("ID") == ' + JSON.stringify(id) + ' && label.getString("PROPERTY") == "label") {',
        '            result.value = String(label.getString("VALUE"));',
        '        }',
        '        label = set.moveNext();',
        '    }',
        '    result.keys = keys.size();',
        '} finally {',
        '    set.close();',
        '}',
        'throw new Error("LABELS[" + JSON.stringify(result) + "]");',
        'var scriptConfig = { autoscript: "TEST.PRESENTATION.REDEPLOY.LABELS", description: "Presentation redeploy test: read labels", active: true };'
    ].join('\n');

    const response = await client.runDeployScript(source, false);
    const match = /LABELS\[(.*)\]/.exec((response && response.message) || '');
    if (!match) {
        throw new Error('Reading the labels failed: ' + JSON.stringify(response));
    }
    return JSON.parse(match[1]);
}

async function deploy(client, xml, step) {
    const deployed = await client.deployScreen(xml);
    assertEquals(deployed && deployed.status, 'success', step + ': the screen deploy succeeds: ' + JSON.stringify(deployed));
}

export default {
    name: 'presentation-redeploy',
    run: async (client) => {
        const original = await client.extractScreen(APP);
        const tag = /<[a-z]+\s[^>]*\bid="([^"]+)"[^>]*\blabel="([^"]+)"[^>]*>/.exec(original);
        if (!tag) {
            throw new Error('No labelled control found in the ' + APP + ' screen.');
        }
        const [element, id, value] = tag;
        const changed = original.replace(element, element.replace('label="' + value + '"', 'label="' + CHANGED + '"'));

        try {
            client.log('  step: redeploy unchanged');
            await deploy(client, original, 'Unchanged');
            const before = await labels(client, id);
            assertEquals(before.rows, before.keys, 'One row per label after an unchanged deploy');
            await deploy(client, original, 'Unchanged again');
            assertEquals(JSON.stringify(await labels(client, id)), JSON.stringify(before), 'Redeploying unchanged keeps the labels');

            client.log('  step: redeploy with a changed label');
            await deploy(client, changed, 'Changed');
            assertEquals(JSON.stringify(await labels(client, id)), JSON.stringify({ rows: before.rows, keys: before.keys, value: CHANGED }), 'Only the changed label differs');

            client.log('  step: redeploy the original');
            await deploy(client, original, 'Original');
            assertEquals(JSON.stringify(await labels(client, id)), JSON.stringify(before), 'The original labels are restored');
        } finally {
            if ((await labels(client, id)).value === CHANGED) {
                await client.deployScreen(original);
            }
        }
    }
};
