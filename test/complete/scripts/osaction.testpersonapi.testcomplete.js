/* eslint-disable no-unused-vars */
/*
 * The script behind the testcomplete OSLC action of the TESTPERSONAPI object structure. Maximo only
 * accepts a script for an object structure action when it is named OSACTION.<structure>.<action>.
 */
main();

function main() {
    // Deliberately empty: the complete manifest test only needs the action to be deployable.
}

var scriptConfig = {
    autoscript: 'OSACTION.TESTPERSONAPI.TESTCOMPLETE',
    description: 'Complete manifest test object structure action',
    version: '1.0.0',
    active: true,
    logLevel: 'ERROR'
};
