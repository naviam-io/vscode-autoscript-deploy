/* eslint-disable no-unused-vars */
main();

function main() {
    // Deliberately empty: the complete manifest test only needs the script and its launch point to exist.
}

var scriptConfig = {
    autoscript: 'TEST.COMPLETE',
    description: 'Complete manifest test script',
    version: '1.0.0',
    active: true,
    logLevel: 'ERROR',
    autoScriptVars: [
        {
            varname: 'TESTLIMIT',
            description: 'Complete manifest test variable',
            varBindingType: 'LITERAL',
            varType: 'IN',
            literalDataType: 'INTEGER',
            varBindingValue: '5'
        }
    ],
    scriptLaunchPoints: [
        {
            launchPointName: 'TEST.COMPLETE.SAVE',
            launchPointType: 'OBJECT',
            objectName: 'TESTOBJ',
            description: 'Complete manifest test launch point',
            active: false,
            save: true,
            add: true,
            update: true,
            delete: false,
            beforeSave: true,
            launchPointVars: [{ varName: 'TESTLIMIT', varBindingValue: '9' }]
        }
    ]
};
