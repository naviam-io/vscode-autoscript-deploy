/* eslint-disable no-undef */
import { assertEquals } from '../harness.js';

// The calendar fields of an escalation point name a calendar and a shift with a work period in that
// calendar. Demo data cannot be relied on, so the test creates its own in the first organization.
const ESCALATION = 'NVTEST_ESCCAL';
const CALENDAR = 'NVTESTCL';
const SHIFT = 'NVTESTSH';
const SCRIPT_NAME = 'NVTEST.ESCCAL.SETUP';

function script(description, body) {
    return [
        'var scriptConfig = { autoscript: "' + SCRIPT_NAME + '", description: "' + description + '", active: true };',
        "var MXServer = Java.type('psdi.server.MXServer');",
        'var MboConstants = Java.type("psdi.mbo.MboConstants");',
        'var userInfo = MXServer.getMXServer().getSystemUserInfo();'
    ]
        .concat(body)
        .join('\n');
}

// Returns the organization the calendar was created in, through the message of a marker error.
async function createCalendar(client) {
    const source = script('Escalation calendar test setup', [
        "var orgSet = MXServer.getMXServer().getMboSet('ORGANIZATION', userInfo);",
        "orgSet.setOrderBy('orgid');",
        "var orgId = orgSet.moveFirst().getString('ORGID');",
        'orgSet.close();',
        "var shiftSet = MXServer.getMXServer().getMboSet('SHIFT', userInfo);",
        'var shift = shiftSet.add();',
        "shift.setValue('ORGID', orgId, MboConstants.NOACCESSCHECK);",
        "shift.setValue('SHIFTNUM', '" + SHIFT + "');",
        "shift.setValue('DESCRIPTION', 'Escalation calendar test');",
        "shift.setValue('STARTDAY', MXServer.getMXServer().getMaximoDD().getTranslator().toExternalDefaultValue('DAYNAME', '02', shift));",
        'shiftSet.save();',
        'shiftSet.close();',
        "var calendarSet = MXServer.getMXServer().getMboSet('CALENDAR', userInfo);",
        'var calendar = calendarSet.add();',
        "calendar.setValue('ORGID', orgId, MboConstants.NOACCESSCHECK);",
        "calendar.setValue('CALNUM', '" + CALENDAR + "');",
        "calendar.setValue('DESCRIPTION', 'Escalation calendar test');",
        "calendar.setValue('STARTDATE', new java.util.Date(126, 0, 1));",
        "calendar.setValue('ENDDATE', new java.util.Date(127, 0, 1));",
        "var workPeriod = calendar.getMboSet('WORKPERIOD').add();",
        "workPeriod.setValue('SHIFTNUM', '" + SHIFT + "', MboConstants.NOACCESSCHECK);",
        "workPeriod.setValue('WORKDATE', new java.util.Date(126, 5, 1), MboConstants.NOACCESSCHECK);",
        "workPeriod.setValue('STARTTIME', new java.util.Date(70, 0, 1, 8, 0), MboConstants.NOACCESSCHECK);",
        "workPeriod.setValue('ENDTIME', new java.util.Date(70, 0, 1, 16, 0), MboConstants.NOACCESSCHECK);",
        "workPeriod.setValue('WORKHOURS', 8, MboConstants.NOACCESSCHECK);",
        'calendarSet.save();',
        'calendarSet.close();',
        "throw new Error('CALENDARORG[' + orgId + ']');"
    ]);

    const response = await client.runDeployScript(source);
    const match = /CALENDARORG\[([^\]]+)\]/.exec((response && response.message) || '');
    if (!match) {
        throw new Error('Creating the test calendar failed: ' + JSON.stringify(response));
    }

    return match[1];
}

// Maximo deletes a shift only for an interactive user, so the shift and its pattern days are
// deleted with SQL. The test created them, so nothing else refers to them.
async function deleteCalendar(client) {
    const calendarWhere = "calnum = '" + CALENDAR + "'";
    const shiftWhere = "shiftnum = '" + SHIFT + "'";
    const source = script('Escalation calendar test cleanup', [
        "var SqlFormat = Java.type('psdi.mbo.SqlFormat');",
        "var DBShortcut = Java.type('psdi.mbo.DBShortcut');",
        "['WORKPERIOD', 'CALENDAR'].forEach(function (objectName) {",
        '    var set = MXServer.getMXServer().getMboSet(objectName, userInfo);',
        '    try {',
        '        set.setWhere("' + calendarWhere + '");',
        '        set.deleteAll(MboConstants.NOACCESSCHECK);',
        '        set.save();',
        '    } finally {',
        '        set.close();',
        '    }',
        '});',
        'var db = new DBShortcut();',
        'try {',
        '    db.connect(userInfo.getConnectionKey());',
        '    db.execute(DBShortcut.UPDATE, new SqlFormat("delete from shiftpatternday where ' + shiftWhere + '"));',
        '    db.execute(DBShortcut.UPDATE, new SqlFormat("delete from shift where ' + shiftWhere + '"));',
        '    db.commit();',
        '} finally {',
        '    db.close();',
        '}',
        'var left = [];',
        "[['WORKPERIOD', \"" +
            calendarWhere +
            '"], [\'CALENDAR\', "' +
            calendarWhere +
            '"], [\'SHIFT\', "' +
            shiftWhere +
            '"], [\'SHIFTPATTERNDAY\', "' +
            shiftWhere +
            '"]].forEach(function (entry) {',
        '    var set = MXServer.getMXServer().getMboSet(entry[0], userInfo);',
        '    try {',
        '        set.setWhere(entry[1]);',
        '        if (set.count() > 0) {',
        '            left.push(entry[0]);',
        '        }',
        '    } finally {',
        '        set.close();',
        '    }',
        '});',
        'if (left.length > 0) {',
        "    throw new Error('LEFTOVERS[' + left.join(', ') + ']');",
        '}'
    ]);

    const response = await client.runDeployScript(source);
    assertEquals(response && response.status, 'success', 'Cleanup of the test calendar and shift reported ' + JSON.stringify(response));
}

function escalation(points) {
    return {
        escalations: [
            {
                escalation: ESCALATION,
                description: 'Integration test escalation with calendar based escalation points',
                objectName: 'WORKORDER',
                condition: "status = 'WAPPR'",
                schedule: '1h,*,0,*,*,*,*,*,*,*',
                escRefPoint: points
            }
        ]
    };
}

function pointNumbered(extracted, refPointNum) {
    return ((extracted && extracted.escRefPoint) || []).find((point) => point.refPointNum === refPointNum);
}

export default {
    name: 'escalation-calendar',
    run: async (client) => {
        try {
            const orgId = await createCalendar(client);

            const calendarPoint = {
                refPointNum: 1,
                eventAttribute: 'REPORTDATE',
                elapsedInterval: 4,
                intervalUom: '!HOURS!',
                calcOrgId: orgId,
                calcCalendar: CALENDAR,
                calcShift: SHIFT
            };
            await client.deployConfig(escalation([calendarPoint, { refPointNum: 2, eventAttribute: 'REPORTDATE', elapsedInterval: 1, intervalUom: '!DAYS!' }]));

            let extracted = await client.extract('escalations', ESCALATION);
            let point = pointNumbered(extracted, 1);
            assertEquals(point && point.calcOrgId, orgId, 'Calendar organization of the escalation point');
            assertEquals(point.calcCalendar, CALENDAR, 'Calendar of the escalation point');
            assertEquals(point.calcShift, SHIFT, 'Shift of the escalation point');
            const plain = pointNumbered(extracted, 2);
            assertEquals(plain && plain.calcCalendar, undefined, 'A point without a calendar extracts no calendar');

            // A product payload that omits the calendar keeps the customer's calendar when it declares
            // the fields retained.
            await client.deployConfig(
                escalation([
                    {
                        refPointNum: 1,
                        _retain: ['calcOrgId', 'calcCalendar', 'calcShift'],
                        eventAttribute: 'REPORTDATE',
                        elapsedInterval: 4,
                        intervalUom: '!HOURS!'
                    },
                    { refPointNum: 2, eventAttribute: 'REPORTDATE', elapsedInterval: 1, intervalUom: '!DAYS!' }
                ])
            );

            point = pointNumbered(await client.extract('escalations', ESCALATION), 1);
            assertEquals(point && point.calcOrgId, orgId, 'Redeploy keeps the retained calendar organization');
            assertEquals(point.calcCalendar, CALENDAR, 'Redeploy keeps the retained calendar');
            assertEquals(point.calcShift, SHIFT, 'Redeploy keeps the retained shift');

            // A redeploy that drops the calendar and empties the nullable fields clears them.
            await client.deployConfig(
                escalation([{ refPointNum: 1, eventAttribute: 'REPORTDATE', elapsedInterval: 4, intervalUom: '!HOURS!' }, { refPointNum: 2 }])
            );

            extracted = await client.extract('escalations', ESCALATION);
            point = pointNumbered(extracted, 1);
            assertEquals(point && point.calcOrgId, undefined, 'Redeploy clears the calendar organization');
            assertEquals(point.calcCalendar, undefined, 'Redeploy clears the calendar');
            assertEquals(point.calcShift, undefined, 'Redeploy clears the shift');
            const emptied = pointNumbered(extracted, 2);
            assertEquals(emptied && emptied.eventAttribute, undefined, 'Redeploy clears the event attribute');
            assertEquals(emptied.elapsedInterval, undefined, 'Redeploy clears the elapsed interval');
            assertEquals(emptied.intervalUom, undefined, 'Redeploy clears the interval unit');
        } finally {
            await client.deployConfig({ escalations: [{ _delete: true, escalation: ESCALATION }] });
            await deleteCalendar(client);
        }

        assertEquals(await client.extract('escalations', ESCALATION), null, 'Extract of escalation after delete');
    }
};
