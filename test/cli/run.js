/* eslint-disable no-undef */
/*
 * Packaging and routing tests for the CLI. Packs cli/ as npm publishes it, installs the tarball into a
 * temporary folder, and runs each command through the installed maximo-dev-tools binary. What the
 * commands do in depth is covered by the unit and integration tests.
 *
 *   npm run test:cli -- --offline [--keep]
 *   MAXIMO_APIKEY=<key> npm run test:cli -- [--env "Local 9.2"] [--verbose] [--keep]
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { assertEquals, assertNotNull, loadEnvironment, MaximoTestClient, REPO_ROOT } from '../integration/harness.js';

const JS_SCRIPT = 'NVTEST.CLI';
const TS_SCRIPT = 'NVTEST.CLI.TS';
const MESSAGE = { msgGroup: 'NVTESTCLI', msgKey: 'SMOKE' };
const MESSAGE_LABEL = MESSAGE.msgGroup + ':' + MESSAGE.msgKey;
const VERSION = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'cli', 'package.json'), 'utf8')).version;

function parseArgs(argv) {
    const options = { offline: false, env: null, verbose: false, keep: false };
    for (let index = 0; index < argv.length; index++) {
        if (argv[index] === '--offline') {
            options.offline = true;
        } else if (argv[index] === '--keep') {
            options.keep = true;
        } else if (argv[index] === '--env') {
            options.env = argv[++index];
        } else if (argv[index] === '--verbose' || argv[index] === '-v') {
            options.verbose = true;
        }
    }
    return options;
}

function writeJson(file, content) {
    fs.writeFileSync(file, JSON.stringify(content, null, 4));
}

// Builds the bundle and installs the packed tarball, the way a user installs the published package.
function installPackage(work) {
    const run = (command, cwd) => execSync(command, { cwd, stdio: 'pipe', encoding: 'utf8' });
    run('npm run package:library', REPO_ROOT);
    run('npm run package:cli', REPO_ROOT);

    const packDir = path.join(work, 'pack');
    fs.mkdirSync(packDir);
    const [packed] = JSON.parse(run('npm pack ./cli --json --pack-destination "' + packDir + '"', REPO_ROOT));

    const installDir = path.join(work, 'install');
    fs.mkdirSync(installDir);
    writeJson(path.join(installDir, 'package.json'), { name: 'nvtest-cli-install', private: true });
    run('npm install --no-audit --no-fund "' + path.join(packDir, packed.filename) + '"', installDir);
    return path.join(installDir, 'node_modules', '.bin', 'maximo-dev-tools');
}

// Copies test/cli/project and adds what cannot be committed: the settings with the API key, empty folders,
// and the repository's node_modules, whose webpack builds the TypeScript script without an install.
function createProject(root, environment) {
    fs.cpSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'project'), root, { recursive: true });
    fs.symlinkSync(path.join(REPO_ROOT, 'node_modules'), path.join(root, 'node_modules'), 'dir');
    fs.mkdirSync(path.join(root, 'empty'));
    fs.mkdirSync(path.join(root, 'extracted'));
    writeJson(
        path.join(root, 'settings.json'),
        environment
            ? {
                host: environment.host,
                port: environment.port,
                context: environment.context,
                ssl: environment.useSSL,
                apikey: environment.apiKey,
                extract: { directory: './extracted' },
                deploy: { directory: './' }
            }
            : {}
    );
}

function createCli(bin, root, verbose) {
    const withSettings = (args) => (args.includes('--settings') ? args : [...args, '--settings', 'settings.json']);
    const shell = process.platform === 'win32';

    return {
        // A command still running after the timeout is interrupted as Ctrl+C would.
        run(args, timeout = 300000) {
            const result = spawnSync(bin, withSettings(args), { cwd: root, encoding: 'utf8', timeout, killSignal: 'SIGINT', shell });
            const output = (result.stdout || '') + (result.stderr || '');
            if (verbose) {
                console.log('    $ maximo-dev-tools ' + args.join(' ') + '\n' + output.replace(/^/gm, '      '));
            }
            return { code: result.status, output, interrupted: result.error?.code === 'ETIMEDOUT' };
        }
    };
}

function expectExit(run, code, step) {
    assertEquals(run.code, code, step + ' exited with ' + run.code + ':\n' + run.output);
}

function expectFileContains(file, text, step) {
    assertEquals(fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes(text), true, step + ': ' + file + ' is missing or does not contain "' + text + '"');
}

function offlineSteps(cli, root) {
    return [
        ['--version prints the package version', () => assertEquals(cli.run(['--version']).output.trim(), VERSION, '--version')],
        [
            '--help lists every command',
            () => {
                const help = cli.run(['--help']);
                expectExit(help, 0, '--help');
                ['deploy', 'encrypt', 'extract', 'log'].forEach((command) => {
                    assertEquals(help.output.includes('maximo-dev-tools ' + command), true, '--help does not list ' + command);
                });
            }
        ],
        ['an unknown command fails', () => expectExit(cli.run(['frobnicate']), 1, 'An unknown command')],
        [
            'deploy without a host fails validation',
            () => expectExit(cli.run(['deploy', '--file', 'scripts/nvtest.cli.js', '--settings', 'nohost/settings.json']), 1, 'Deploying without a host')
        ],
        [
            'encrypt encrypts the settings file',
            () => {
                expectExit(cli.run(['encrypt', '--settings', 'encrypt/settings.json']), 0, 'Encrypting');
                const settings = fs.readFileSync(path.join(root, 'encrypt', 'settings.json'), 'utf8');
                assertEquals(settings.includes('nvtest-secret') || settings.includes('nvtest-apikey'), false, 'The settings file still holds plain text credentials');
                assertEquals(fs.readdirSync(path.join(root, 'encrypt')).length > 1, true, 'No key file was written beside the settings file');
            }
        ]
    ];
}

function maximoSteps(cli, root, client) {
    return [
        [
            'nothing is left from an earlier run',
            async () => {
                assertEquals(await client.findScript(JS_SCRIPT), null, JS_SCRIPT + ' already exists');
                assertEquals(await client.findScript(TS_SCRIPT), null, TS_SCRIPT + ' already exists');
            }
        ],
        [
            'deploy a script, installing the server scripts from the package',
            async () => {
                expectExit(cli.run(['deploy', '--file', 'scripts/nvtest.cli.js']), 0, 'Deploying a script');
                const script = await client.findScript(JS_SCRIPT);
                assertNotNull(script, JS_SCRIPT + ' was not deployed');
                assertEquals(String(script.source).includes('cli js test'), true, JS_SCRIPT + ' has the wrong source');
            }
        ],
        [
            'deploy a manifest with a TypeScript script',
            async () => {
                expectExit(cli.run(['deploy', '--file', 'release.manifest.json']), 0, 'Deploying the manifest');
                const script = await client.findScript(TS_SCRIPT);
                assertNotNull(script, TS_SCRIPT + ' was not deployed');
                assertEquals(String(script.source).includes('cli ts test'), true, TS_SCRIPT + ' is not the TypeScript build');
            }
        ],
        [
            'deploy a JSON configuration file',
            async () => {
                // The objects script that reads the message is installed by the first deploy.
                assertEquals(await client.extract('messages', MESSAGE_LABEL), null, 'Message ' + MESSAGE_LABEL + ' already exists');
                expectExit(cli.run(['deploy', '--file', 'config/messages.json']), 0, 'Deploying the messages');
                assertNotNull(await client.extract('messages', MESSAGE_LABEL), 'Message ' + MESSAGE_LABEL + ' was not deployed');
            }
        ],
        [
            'extract a script',
            () => {
                expectExit(cli.run(['extract', '--type', 'script', '--name', JS_SCRIPT.toLowerCase()]), 0, 'Extracting the script');
                expectFileContains(path.join(root, 'extracted', JS_SCRIPT.toLowerCase() + '.js'), 'cli js test', 'Extracting the script');
            }
        ],
        [
            'extract a configuration type',
            () => {
                expectExit(cli.run(['extract', '--type', 'messages', '--name', MESSAGE_LABEL]), 0, 'Extracting the messages');
                expectFileContains(path.join(root, 'extracted', 'messages.json'), MESSAGE.msgKey, 'Extracting the messages');
            }
        ],
        [
            'log streams until interrupted',
            () => {
                const log = cli.run(['log', '--log-timeout', '30'], 8000);
                assertEquals(log.interrupted, true, 'The log command exited on its own with ' + log.code + ':\n' + log.output);
                expectExit(log, 0, 'Interrupting the log');
            }
        ],
        ['deploying a broken file fails', () => expectExit(cli.run(['deploy', '--directory', 'broken']), 1, 'Deploying a broken file')],
        [
            'deploy a configuration delete',
            async () => {
                expectExit(cli.run(['deploy', '--file', 'config/messages-delete.json']), 0, 'Deleting the messages');
                assertEquals(await client.extract('messages', MESSAGE_LABEL), null, 'Message ' + MESSAGE_LABEL + ' was not deleted');
            }
        ],
        [
            'delete scripts from a delete list',
            async () => {
                expectExit(cli.run(['deploy', '--directory', 'empty', '--deleteList', 'delete-scripts.json']), 0, 'Deleting from the delete list');
                assertEquals(await client.findScript(JS_SCRIPT), null, JS_SCRIPT + ' was not deleted');
                assertEquals(await client.findScript(TS_SCRIPT), null, TS_SCRIPT + ' was not deleted');
            }
        ]
    ];
}

async function cleanUp(client) {
    for (const name of [JS_SCRIPT, TS_SCRIPT]) {
        const script = await client.findScript(name);
        if (script) {
            await client.client.request({
                url: script.href,
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-method-override': 'DELETE' },
                validateStatus: () => true
            });
        }
    }
    if (await client.extract('messages', MESSAGE_LABEL)) {
        await client.deployConfig({ messages: [Object.assign({ _delete: true }, MESSAGE)] });
    }
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const environment = options.offline ? null : loadEnvironment(options.env);
    const client = environment ? new MaximoTestClient(environment, { verbose: options.verbose }) : null;

    console.log(environment ? 'Running the CLI tests against "' + environment.name + '" (' + environment.baseURL + ').' : 'Running the offline CLI tests.');

    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'nvtest-cli-'));
    const root = path.join(work, 'project');
    let failed = false;

    try {
        console.log('  packing and installing @naviam/maximo-dev-tools ' + VERSION + '...');
        const cli = createCli(installPackage(work), root, options.verbose);
        createProject(root, environment);
        console.log('  project: ' + root);

        const steps = [...offlineSteps(cli, root), ...(client ? maximoSteps(cli, root, client) : [])];
        for (const [name, step] of steps) {
            const started = Date.now();
            try {
                await step();
                console.log('  PASS ' + name + ' (' + (Date.now() - started) + 'ms)');
            } catch (error) {
                console.log('  FAIL ' + name + '\n\n' + error.message);
                failed = true;
                break;
            }
        }
    } finally {
        if (client) {
            await cleanUp(client).catch((error) => console.log('  Cleaning up failed: ' + error.message));
        }
        if (options.keep) {
            console.log('  kept: ' + work);
        } else {
            fs.rmSync(work, { recursive: true, force: true });
        }
    }

    if (failed) {
        process.exitCode = 1;
    } else {
        console.log('\nAll CLI tests passed.');
    }
}

main().catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
});
