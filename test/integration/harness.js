/* eslint-disable no-undef */
/*
 * Minimal, dependency light harness that runs integration tests against the Maximo environment that is
 * currently selected in .devtools-config.json.
 *
 * The API key stored in .devtools-config.json is encrypted with a key held in the VS Code secret
 * storage and cannot be read outside of VS Code, so the key has to be supplied through the
 * MAXIMO_APIKEY environment variable (or stored unencrypted in the configuration file).
 */
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const CONFIG_PATH = path.join(REPO_ROOT, '.devtools-config.json');

function loadEnvironment(environmentName) {
    if (!fs.existsSync(CONFIG_PATH)) {
        throw new Error('No .devtools-config.json found at ' + CONFIG_PATH + '.');
    }

    const environments = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    const wanted = environmentName || process.env.MAXIMO_ENV;

    const environment = wanted ? environments.find((item) => item.name === wanted) : environments.find((item) => item.selected === true);

    if (!environment) {
        throw new Error(wanted ? 'No environment named "' + wanted + '" in .devtools-config.json.' : 'No environment is selected in .devtools-config.json.');
    }

    const apiKey = process.env.MAXIMO_APIKEY || (environment.apiKey && !environment.apiKey.startsWith('{encrypted}') ? environment.apiKey : null);

    if (!apiKey) {
        throw new Error(
            'The API key for environment "' +
            environment.name +
            '" is encrypted in .devtools-config.json and cannot be decrypted outside of VS Code. ' +
            'Set the MAXIMO_APIKEY environment variable to run the integration tests.'
        );
    }

    const useSSL = environment.useSSL === true;
    const port = environment.port;
    const context = environment.context || 'maximo';
    const isDefaultPort = (port === 443 && useSSL) || (port === 80 && !useSSL);

    return {
        name: environment.name,
        host: environment.host,
        port: port,
        context: context,
        useSSL: useSSL,
        apiKey: apiKey,
        baseURL: (useSSL ? 'https://' : 'http://') + environment.host + (isDefaultPort ? '' : ':' + port) + '/' + context + '/api'
    };
}

class MaximoTestClient {
    constructor(environment, options) {
        this.environment = environment;
        this.verbose = Boolean(options && options.verbose);
        this.client = axios.create({
            baseURL: environment.baseURL,
            timeout: 300000,
            headers: { apikey: environment.apiKey, 'x-public-uri': environment.baseURL },
            params: { lean: 'true' }
        });

        // A rejected API key otherwise surfaces as a bare HTTP 400, or as whatever the caller
        // makes of a body it does not expect.
        const rejectInvalidKey = (response) => {
            const error = response && response.data && response.data.Error;
            if (error && error.reasonCode === 'BMXAA9549E') {
                throw new Error(
                    'Maximo rejected the API key for "' + environment.name + '": ' + error.message + ' Check that MAXIMO_APIKEY holds the key of this environment.'
                );
            }
            return response;
        };
        this.client.interceptors.response.use(rejectInvalidKey, (error) => {
            rejectInvalidKey(error.response);
            return Promise.reject(error);
        });
    }

    /** Prints a message when the run is verbose, indented under the case that is running. */
    log(message) {
        if (this.verbose) {
            console.log('    ' + message);
        }
    }

    /**
     * Deploys a declarative JSON configuration through the same endpoint the extension uses.
     * Resolves on success and rejects with the Maximo error message on failure.
     */
    async deployConfig(config) {
        const response = await this.client.request({
            url: 'script/naviam.autoscript.deploy/config',
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
            responseType: 'text',
            transformResponse: [(data) => data],
            validateStatus: () => true,
            data: JSON.stringify(config)
        });

        const body = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
        this._sseEvents(body)
            .filter((event) => event.event !== 'error')
            .forEach((event) => this.log('  ' + event.event + ': ' + event.data));
        const error = this._findDeployError(body);

        if (error) {
            throw new Error(error);
        }

        if (response.status >= 400) {
            throw new Error('Deploy failed with HTTP ' + response.status + ': ' + body);
        }

        return { body: body, warnings: this._sseData(body, 'warning'), infos: this._sseData(body, 'info') };
    }

    _findDeployError(body) {
        const sseErrors = this._sseData(body, 'error');
        if (sseErrors.length > 0) {
            return sseErrors[0];
        }

        if (body && body.trim().startsWith('{')) {
            try {
                const parsed = JSON.parse(body);
                if (parsed.status === 'error' || parsed.Error || parsed.error) {
                    return parsed.message || JSON.stringify(parsed.Error || parsed.error);
                }
            } catch (ignored) {
                return null;
            }
        }

        return null;
    }

    _sseData(body, event) {
        return this._sseEvents(body)
            .filter((message) => message.event === event)
            .map((message) => message.data);
    }

    // The server-sent events of a response body, in the order Maximo sent them.
    _sseEvents(body) {
        if (!body) {
            return [];
        }

        return body
            .split('\n\n')
            .map((message) => message.split('\n'))
            .map((lines) => ({
                event: (lines.find((line) => line.startsWith('event: ')) || '').substring(7),
                data: lines.filter((line) => line.startsWith('data: ')).map((line) => line.substring(6))[0]
            }))
            .filter((message) => message.event && Boolean(message.data));
    }

    async synonymMap(domainId) {
        if (!this._synonymMaps) {
            this._synonymMaps = {};
        }
        if (this._synonymMaps[domainId]) {
            return this._synonymMaps[domainId];
        }

        const response = await this.client.request({
            url: 'os/mxapisynonymdomain',
            method: 'GET',
            params: {
                lean: 'true',
                'oslc.select': 'value,maxvalue,defaults',
                'oslc.where': 'domainid="' + domainId + '"'
            }
        });

        // An internal value may have several synonyms, deploy resolves it to the default one.
        const members = (response.data && response.data.member) || [];
        const map = {};
        members.forEach((item) => {
            if (item.maxvalue && (item.defaults || !map[item.maxvalue])) {
                map[item.maxvalue] = item.value;
            }
        });
        this._synonymMaps[domainId] = map;
        return map;
    }

    async extractObjectCfg(objectName) {
        const response = await this.client.request({
            url: 'os/mxobjectcfg',
            method: 'GET',
            params: {
                lean: 'true',
                'oslc.select': '*,rel.maxattributecfg{*},rel.maxrelationship{*},rel.maxsysindexes{*,rel.maxsyskeys{*}}',
                'oslc.where': 'objectname="' + String(objectName).toUpperCase() + '"'
            }
        });

        const members = (response.data && response.data.member) || [];
        return members.length > 0 ? members[0] : null;
    }

    /**
     * The retained values snapshots an earlier, incomplete deployment left behind for the records
     * this payload names. Read only, and the same pre-flight the extension performs before it
     * deploys a payload that declares _retain.
     */
    async listRetainedSnapshots(config) {
        const answer = await this._retainedSnapshots('list', config);
        return Array.isArray(answer.snapshots) ? answer.snapshots : [];
    }

    /** Deletes the named snapshots, so the next deployment captures the live record instead. */
    async discardRetainedSnapshots(keys) {
        const answer = await this._retainedSnapshots('discard', { keys: keys });
        return answer.discarded;
    }

    async _retainedSnapshots(action, body) {
        const response = await this.client.request({
            url: 'script/naviam.autoscript.deploy/snapshots/' + action,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            validateStatus: () => true,
            data: JSON.stringify(body)
        });

        const answer = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;

        if (!answer || answer.status !== 'ok') {
            throw new Error('Snapshot ' + action + ' failed: ' + ((answer && answer.message) || JSON.stringify(answer)));
        }

        return answer;
    }

    async getObjectList(objectType) {
        return await this._getObjects({ type: objectType, action: 'list' });
    }

    async getObjectDetail(objectType, id) {
        return await this._getObjects({ type: objectType, action: 'detail', id: id });
    }

    /**
     * Returns the extracted detail for the object with the given label, or null when it does not exist.
     */
    async extract(objectType, label) {
        const list = await this.getObjectList(objectType);
        const match = list.find((item) => String(item.label).toUpperCase() === String(label).toUpperCase());
        return match ? await this.getObjectDetail(objectType, match.id) : null;
    }

    async _getObjects(params) {
        const response = await this.client.request({
            url: 'script/naviam.autoscript.objects',
            method: 'GET',
            headers: { 'Content-Type': 'application/json' },
            params: params
        });

        if (response.data && response.data.status === 'success') {
            return response.data.data;
        }

        throw new Error((response.data && response.data.message) || 'Unexpected response from the objects script.');
    }

    /**
     * Deploys an automation script from its source, the way the extension's script deployment does.
     * Returns the parsed response body.
     */
    async deployScriptSource(source, isPython) {
        const response = await this.client.request({
            url: 'script/naviam.autoscript.deploy' + (isPython ? '/python' : ''),
            method: 'POST',
            headers: { 'Content-Type': 'text/plain', Accept: 'application/json' },
            validateStatus: () => true,
            data: source
        });

        return this._scriptResponse(response, 'deploy');
    }

    /**
     * Runs a one-off deploy script through the deployscript action: install, run once, remove.
     * Returns the parsed response body, including the error body Maximo answers 200 with.
     */
    async runDeployScript(source, isPython) {
        const response = await this.client.request({
            url: 'script/naviam.autoscript.deploy/deployscript' + (isPython ? '/python' : ''),
            method: 'POST',
            headers: { 'Content-Type': 'text/plain', Accept: 'application/json' },
            validateStatus: () => true,
            data: source
        });

        return this._scriptResponse(response, 'deployscript');
    }

    _scriptResponse(response, action) {
        if (response.status >= 400 && !response.data) {
            throw new Error('The ' + action + ' action failed with HTTP ' + response.status + '.');
        }

        return response.data;
    }

    /**
     * Returns the automation script with the given name as Maximo holds it, or null when it does
     * not exist. Maximo keys scripts by their upper-cased name.
     */
    async findScript(name) {
        const response = await this.client.request({
            url: 'os/mxapiautoscript',
            method: 'GET',
            params: {
                lean: 'true',
                'oslc.select': 'autoscript,description,source,status,href',
                'oslc.where': 'autoscript="' + String(name).toUpperCase() + '"'
            }
        });

        const members = (response.data && response.data.member) || [];
        return members.length > 0 ? members[0] : null;
    }

    /**
     * Uploads the local version of a Maximo side script so the tests exercise the working tree,
     * through the same deploy action the extension uses.
     *
     * The Maximo side scripts each declare their own scriptConfig block, so the action derives the
     * name from the source. A Maximo whose installed deploy script is older than the fix for
     * unquoted scriptConfig keys cannot parse them: upgrade it from the extension first.
     */
    async installScript(sourcePath) {
        const response = await this.client.request({
            url: 'script/naviam.autoscript.deploy',
            method: 'POST',
            headers: { 'Content-Type': 'text/plain', Accept: 'application/json' },
            validateStatus: () => true,
            data: fs.readFileSync(sourcePath, 'utf8')
        });


        if (response.status >= 400 || (response.data && response.data.status === 'error')) {
            const data = response.data || {};
            const reason = data.message || (data.Error && data.Error.message) || 'HTTP ' + response.status;
            throw new Error('Failed to install ' + path.basename(sourcePath) + ': ' + reason);
        }
    }

    /** Deploys a screen definition through the same action the extension uses. Returns the parsed response body. */
    async deployScreen(xml) {
        return await this._postText('script/naviam.autoscript.screens', xml, 'screen');
    }

    /** Deploys an inspection form through the same action the extension uses. Returns the parsed response body. */
    async deployForm(form) {
        return await this._postText('script/naviam.autoscript.form', JSON.stringify(form, null, 4), 'inspection form');
    }

    async _postText(url, data, what) {
        const response = await this.client.request({
            url: url,
            method: 'POST',
            headers: { 'Content-Type': 'text/plain', Accept: 'application/json' },
            validateStatus: () => true,
            data: data
        });

        if (response.status >= 400 && !response.data) {
            throw new Error('Deploying the ' + what + ' failed with HTTP ' + response.status + '.');
        }

        return response.data;
    }

    /** The inspection forms Maximo holds, except revised ones, as the extraction lists them. */
    async listForms() {
        const response = await this.client.request({ url: 'script/naviam.autoscript.form', method: 'GET' });

        if (response.data && response.data.status === 'success') {
            return response.data.inspectionForms || [];
        }

        throw new Error((response.data && response.data.message) || 'Unexpected response from the form script.');
    }

    /** The presentation XML of an application, or null when Maximo has none for it. */
    async extractScreen(app) {
        const response = await this.client.request({ url: 'script/naviam.autoscript.screens/' + app, method: 'GET', validateStatus: () => true });

        if (response.data && response.data.status === 'success') {
            return response.data.presentation;
        }

        if (response.data && response.data.reason === 'screen_not_found') {
            return null;
        }

        throw new Error((response.data && response.data.message) || 'Unexpected response from the screens script.');
    }

    /**
     * Applies pending database configuration the way the extension does, taking Admin Mode when
     * Maximo says it is required and always releasing it again. Admin Mode logs every user out, so
     * this must only ever run against a disposable environment. Returns whether anything was applied.
     */
    async applyDatabaseConfiguration() {
        if (!(await this._admin('GET', 'configdbrequired')).configDBRequired) {
            this.log('  No database configuration is pending.');
            return false;
        }

        if (!(await this._admin('GET', 'configdbrequiresadminmode')).configDBRequiresAdminMode) {
            this.log('  Applying the database configuration without Admin Mode.');
            await this._admin('POST', 'applyconfigdb');
            await sleep(2000);
            await this._waitForDatabaseConfiguration();
            return true;
        }

        this.log('  Turning Admin Mode on to apply the database configuration.');
        await this._admin('POST', 'adminmodeon');
        let failure = null;
        try {
            await this._waitForAdminMode(true);
            await this._admin('POST', 'applyconfigdb');

            while (!(await this._admin('GET', 'configuring')).configuring) {
                await sleep(2000);
            }
            await this._waitForDatabaseConfiguration();
        } catch (error) {
            failure = error;
        }

        // Admin Mode is released after a failure too, without letting that hide the failure.
        try {
            this.log('  Turning Admin Mode off.');
            await this._admin('POST', 'adminmodeoff');
            await this._waitForAdminMode(false);
        } catch (error) {
            if (!failure) {
                throw error;
            }
            failure.message += ' Releasing Admin Mode afterwards failed as well: ' + error.message;
        }

        if (failure) {
            throw failure;
        }

        return true;
    }

    // The same failure detection the extension applies to the configuration messages.
    async _waitForDatabaseConfiguration() {
        let printed = 0;
        const printNew = (lines) => {
            lines.slice(printed).forEach((line) => line.trim() && this.log('  ' + line.trim()));
            printed = Math.max(printed, lines.length);
        };

        while ((await this._admin('GET', 'configuring')).configuring) {
            await sleep(2000);

            const messages = (await this._admin('GET', 'configmessages')).messages || '';
            printNew(messages.split('\n'));
            const failure = messages.split('\n').find((message) => /BMX.*?E(?= -)/.test(message) || message.startsWith('BMXAA6819I'));
            if (failure) {
                throw new Error('Database configuration failed: ' + failure);
            }
        }

        if (this.verbose) {
            printNew(((await this._admin('GET', 'configmessages')).messages || '').split('\n'));
        }
    }

    async _waitForAdminMode(on) {
        for (let attempt = 0; attempt < 150; attempt++) {
            if ((await this._admin('GET', 'adminmodeon')).adminModeOn === on) {
                return;
            }
            await sleep(2000);
        }

        throw new Error('Admin Mode did not turn ' + (on ? 'on' : 'off') + ' within five minutes.');
    }

    async _admin(method, action) {
        const response = await this.client.request({
            url: 'script/naviam.autoscript.admin/' + action,
            method: method,
            headers: { 'Content-Type': 'application/json' },
            validateStatus: () => true
        });

        if (!response.data || response.data.status !== 'ok') {
            throw new Error('The admin action ' + action + ' failed: ' + ((response.data && (response.data.error || response.data.message)) || 'HTTP ' + response.status));
        }

        return response.data;
    }
}

function sleep(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function assertEquals(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(message + ' - expected ' + JSON.stringify(expected) + ' but got ' + JSON.stringify(actual));
    }
}

function assertNotNull(actual, message) {
    if (actual === null || typeof actual === 'undefined') {
        throw new Error(message + ' - value was ' + JSON.stringify(actual));
    }
}

module.exports = { loadEnvironment, MaximoTestClient, assertEquals, assertNotNull, REPO_ROOT };
