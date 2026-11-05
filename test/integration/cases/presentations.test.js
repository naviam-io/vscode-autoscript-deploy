/* eslint-disable no-undef */
/*
 * Applies presentation changes to the ACTION application and the TOOLBOX system presentation and
 * checks the stored XML and its MAXLABELS rows after each step: add, modify and move, replace in
 * place, a whole screen deploy through the shared writer, payload-wide atomicity, and remove.
 */
import { assertEquals } from '../harness.js';
import { loadFixture } from '../round-trip.js';
import { childIds, findById, parsePresentation } from '../../unit/support/presentation-tree.js';

const APP = 'ACTION';
const SYSTEM = 'TOOLBOX';
const DIALOG = 'nvtest_pres_dlg';
const PROPERTY = 'nvtest.presentations.atomic';

async function screen(client, app) {
    return parsePresentation(await client.extractScreen(app));
}

/** The nvtest_pres MAXLABELS rows of the app as "id.property=value", sorted, read inside Maximo. */
async function labels(client, app) {
    const source = [
        'var MXServer = Java.type("psdi.server.MXServer");',
        'var SqlFormat = Java.type("psdi.mbo.SqlFormat");',
        'var set = MXServer.getMXServer().getMboSet("MAXLABELS", MXServer.getMXServer().getSystemUserInfo());',
        'var found = [];',
        'try {',
        '    var sqlf = new SqlFormat("app = :1 and id like \'nvtest_pres%\'");',
        '    sqlf.setObject(1, "MAXLABELS", "APP", ' + JSON.stringify(app) + ');',
        '    set.setWhere(sqlf.format());',
        '    var label = set.moveFirst();',
        '    while (label) {',
        '        found.push(label.getString("ID") + "." + label.getString("PROPERTY") + "=" + label.getString("VALUE"));',
        '        label = set.moveNext();',
        '    }',
        '} finally {',
        '    set.close();',
        '}',
        'throw new Error("LABELS[" + JSON.stringify(found) + "]");',
        'var scriptConfig = { autoscript: "TEST.PRESENTATIONS.LABELS", description: "Presentations test: read labels", active: true };'
    ].join('\n');

    const response = await client.runDeployScript(source, false);
    const match = /LABELS\[(.*)\]/.exec((response && response.message) || '');
    if (!match) {
        throw new Error('Reading the labels failed: ' + JSON.stringify(response));
    }
    return JSON.parse(match[1]).sort().join('; ');
}

async function deployError(client, payload) {
    try {
        await client.deployConfig(payload);
    } catch (caught) {
        return caught.message;
    }
    return null;
}

export default {
    name: 'presentations',
    run: async (client) => {
        const fixture = loadFixture('presentations');
        await client.deployConfig(fixture.removeDialog);
        await client.deployConfig(fixture.removeSystemDialog);
        await client.deployConfig(fixture.removeProperty);
        assertEquals(await labels(client, APP), '', 'No labels left over from an earlier run');

        try {
            client.log('  step: add');
            await client.deployConfig(fixture.add);
            let root = await screen(client, APP);
            assertEquals(childIds(findById(root, DIALOG)).join(), 'nvtest_pres_s2,nvtest_pres_s1,nvtest_pres_bg', 'Dialog content after add');
            assertEquals(childIds(root).at(-1), DIALOG, 'The dialog is appended to the root');
            assertEquals(findById(root, 'nvtest_pres_ok').attributes.sigoption, 'READ', 'The pushbutton keeps its sigoption');
            assertEquals(
                await labels(client, APP),
                'nvtest_pres_dlg.label=NV Test; nvtest_pres_ok.label=OK; nvtest_pres_s1.label=One; nvtest_pres_s2.label=Two; nvtest_pres_t1.label=Text One',
                'Labels after add'
            );

            client.log('  step: modify and move');
            await client.deployConfig(fixture.modifyAndMove);
            root = await screen(client, APP);
            assertEquals(childIds(findById(root, DIALOG)).join(), 'nvtest_pres_s1,nvtest_pres_s2,nvtest_pres_bg', 'Dialog content after move');
            assertEquals(
                await labels(client, APP),
                'nvtest_pres_dlg.label=NV Test; nvtest_pres_ok.label=OK; nvtest_pres_s1.label=First; nvtest_pres_t1.label=Text One',
                'Labels after modify'
            );

            client.log('  step: replace in place');
            await client.deployConfig(fixture.replace);
            root = await screen(client, APP);
            assertEquals(childIds(findById(root, DIALOG)).join(), 'nvtest_pres_s1,nvtest_pres_s2,nvtest_pres_bg', 'The replaced section keeps its position');
            assertEquals(childIds(findById(root, 'nvtest_pres_s1')).join(), 'nvtest_pres_t2', 'The replaced section has the new content');
            assertEquals(
                await labels(client, APP),
                'nvtest_pres_dlg.label=NV Test; nvtest_pres_ok.label=OK; nvtest_pres_s1.label=First; nvtest_pres_t2.label=Text Two',
                'Labels after replace'
            );

            client.log('  step: whole screen deploy');
            const xml = await client.extractScreen(APP);
            const deployed = await client.deployScreen(xml.replace('label="Text Two"', 'label="Text Three"'));
            assertEquals(deployed && deployed.status, 'success', 'The whole screen deploy succeeds: ' + JSON.stringify(deployed));
            assertEquals(
                await labels(client, APP),
                'nvtest_pres_dlg.label=NV Test; nvtest_pres_ok.label=OK; nvtest_pres_s1.label=First; nvtest_pres_t2.label=Text Three',
                'Labels after a whole screen deploy'
            );

            client.log('  step: atomicity');
            assertEquals(
                await deployError(client, fixture.missingAnchor),
                'ACTION changes[0] add: anchor section "nvtest_pres_missing" was not found.',
                'A missing anchor fails the deployment'
            );
            assertEquals(
                await deployError(client, fixture.unknownSignatureOption),
                'ACTION changes[0] modify: signature option "NVTEST_NOPE" does not exist for the application.',
                'An unknown signature option fails the deployment'
            );
            assertEquals(await client.extract('properties', PROPERTY), null, 'Nothing in the failed payloads was applied');
            assertEquals(findById(await screen(client, APP), 'nvtest_pres_ok').attributes.sigoption, 'READ', 'The presentation was not changed');

            client.log('  step: system presentation');
            await client.deployConfig(fixture.systemPresentation);
            assertEquals(childIds(findById(await screen(client, SYSTEM), DIALOG)).join(), 'nvtest_pres_sys', 'A system presentation does not check signature options');
        } finally {
            await client.deployConfig(fixture.removeSystemDialog);
            const removed = await client.deployConfig(fixture.removeDialog);
            assertEquals(removed.infos.length, 0, 'The dialog existed when it was removed');
            await client.deployConfig(fixture.removeProperty);
        }

        assertEquals(findById(await screen(client, APP), DIALOG), null, 'The dialog is gone');
        assertEquals(findById(await screen(client, SYSTEM), DIALOG), null, 'The system dialog is gone');
        assertEquals(await labels(client, APP), '', 'No labels remain after remove');
        const again = await client.deployConfig(fixture.removeDialog);
        assertEquals(again.infos.join(), 'ACTION changes[0] remove: dialog "nvtest_pres_dlg" was not found, nothing to remove.', 'Removing again is reported, not failed');
    }
};
