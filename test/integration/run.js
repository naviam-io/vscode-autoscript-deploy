/* eslint-disable no-undef */
/*
 * CLI entry point for the Maximo integration tests.
 *
 *   MAXIMO_APIKEY=<key> npm run test:integration
 *   MAXIMO_APIKEY=<key> npm run test:integration -- --env "Local AQF" --case cron-tasks
 *
 * By default the Maximo side scripts from the working tree (naviam.autoscript.library.js and
 * naviam.autoscript.objects.js) are uploaded before the tests run, so the tests always verify the
 * local code. Pass --no-install to skip that step.
 *
 * Pass --verbose to print what Maximo reports while a case runs: the progress, info and warning
 * events a configuration deployment streams, the database configuration messages, and the step a
 * case is on, for the cases that report one.
 */
const fs = require('fs');
const path = require('path');
const { loadEnvironment, MaximoTestClient, REPO_ROOT } = require('./harness');

const CASES_DIR = path.join(__dirname, 'cases');

const MAXIMO_SCRIPTS = [
    path.join(REPO_ROOT, 'resources', 'naviam.autoscript.deploy.js'),
    path.join(REPO_ROOT, 'resources', 'naviam.autoscript.library.js'),
    path.join(REPO_ROOT, 'resources', 'naviam.autoscript.objects.js')
];

function parseArgs(argv) {
    const options = { install: true, env: null, only: [], verbose: false };

    for (let index = 0; index < argv.length; index++) {
        const arg = argv[index];
        if (arg === '--no-install') {
            options.install = false;
        } else if (arg === '--env') {
            options.env = argv[++index];
        } else if (arg === '--verbose' || arg === '-v') {
            options.verbose = true;
        } else if (arg === '--case') {
            options.only.push(argv[++index]);
        }
    }

    return options;
}

function discoverCases(only) {
    return fs
        .readdirSync(CASES_DIR)
        .filter((file) => file.endsWith('.test.js'))
        .map((file) => path.join(CASES_DIR, file))
        .map((file) => require(file))
        .filter((testCase) => only.length === 0 || only.includes(testCase.name));
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const environment = loadEnvironment(options.env);
    const client = new MaximoTestClient(environment, { verbose: options.verbose });

    console.log('Running integration tests against "' + environment.name + '" (' + environment.baseURL + ').');

    if (options.install) {
        for (const source of MAXIMO_SCRIPTS) {
            console.log('  installing ' + path.basename(source) + '...');
            await client.installScript(source);
        }
    }

    const cases = discoverCases(options.only);
    const failures = [];

    for (const testCase of cases) {
        const started = Date.now();
        client.log('RUN ' + testCase.name);
        try {
            await testCase.run(client);
            console.log('  PASS ' + testCase.name + ' (' + (Date.now() - started) + 'ms)');
        } catch (error) {
            failures.push([testCase.name, error]);
            console.log('  FAIL ' + testCase.name + ' (' + (Date.now() - started) + 'ms)');
        }
    }

    if (failures.length) {
        console.log('\n' + failures.length + ' of ' + cases.length + ' test(s) failed:\n');
        failures.forEach(([name, error]) => console.log('  ' + name + ': ' + error.message));
        process.exitCode = 1;
        return;
    }

    console.log('\nAll ' + cases.length + ' test(s) passed.');
}

main().catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
});
