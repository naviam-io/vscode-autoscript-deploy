/* eslint-disable no-undef */
/* eslint-disable indent */
/* eslint-disable no-redeclare */
// @ts-nocheck
import axios from 'axios';
import https from 'https';
// @ts-ignore
import { CookieJar, Cookie } from 'tough-cookie';

import * as semver from 'semver';
import {
    InvalidApiKeyError,
    LoginFailedError,
    MaximoError,
    MxAccessError,
    MxAdminLogoutError,
    MxDuplicateTransactionError,
    PasswordExpiredError,
    PasswordResetFailedError,
    ResourceNotFoundError
} from './errors';

import * as fs from 'fs';
import * as path from 'path';

import MaximoConfig from './maximo-config';
import { TextDecoder } from 'util';
import { window } from 'vscode';

import Logger from '../logger';

const LOG_SOURCE = 'MaximoClient';

export default class MaximoClient {
    constructor(config) {
        if (!(config instanceof MaximoConfig)) {
            throw 'config parameter must be an instance of MaximoConfig';
        }
        this.maxVersion = 'undefined';
        // keep a reference to the config for later use.
        this.config = config;
        this.retry = true;

        this.requiredScriptVersion = '1.58.0';
        this.currentScriptVersion = '1.58.0';

        this.adminModeRetryCount = 0;

        this.scriptEndpoint = 'mxscript';

        if (config.ca) {
            https.globalAgent.options.ca = config.ca;
        }

        https.globalAgent.options.rejectUnauthorized = !config.allowUntrustedCerts;

        // This is the way it is supposed to be done, but in tested Axios seems to ignore the agent.
        // Allows untrusted certificates agent.
        // let httpsAgent = new https.Agent({
        //     rejectUnauthorized: !config.allowUntrustedCerts,
        //     ca: config.ca
        // });

        this.jar = new CookieJar(null, { rejectPublicSuffixes: false });

        this.client = axios.create({
            withCredentials: true,
            // httpsAgent: httpsAgent,
            baseURL: config.baseURL,
            timeout: config.connectTimeout
        });

        Logger.debug(
            `Initialized client for ${config.baseURL} (timeout=${config.connectTimeout}ms, apiKey=${Boolean(config.apiKey)}, proxy=${Boolean(
                config.proxyConfigured
            )}, allowUntrustedCerts=${Boolean(config.allowUntrustedCerts)})`,
            LOG_SOURCE
        );

        this.client.interceptors.request.use(
            function (request) {
                if (this.config.proxyConfigured) {
                    request.proxy = {
                        protocol: config.useSSL ? 'https' : 'http',
                        host: this.config.proxyHost,
                        port: this.config.proxyPort
                    };

                    if (this.config.proxyUsername && this.config.proxyPassword) {
                        request.proxy.auth = {
                            username: this.config.proxyUsername,
                            password: this.config.proxyPassword
                        };
                    }
                }

                this._addAuthHeaders(request);

                // If the requested URL is the login endpoint, the inject the auth headers.
                if (request.url === 'login') {
                    if (this.config.apiKey) {
                        if (request.params) {
                            request.params['apikey'] = config.apiKey;
                        } else {
                            request.params = { apikey: config.apiKey };
                        }
                    }

                    if (request.params) {
                        request.params['csrf'] = '1';
                    } else {
                        request.params = { csrf: '1' };
                    }

                    request.maxRedirects = 0;

                    request.validateStatus = function (status) {
                        return status == 200 || status == 302;
                    };
                } else {
                    // // Add the x-public-uri header to ensure Maximo response URI's are properly addressed for external access.
                    // // https://www.ibm.com/docs/en/mema"s?topic=imam-downloading-work-orders-by-using-maximo-mxapiwodetail-api
                    request.headers['x-public-uri'] = this.config.baseURL;

                    if (this.config.apiKey) {
                        if (request.params) {
                            request.params['apikey'] = config.apiKey;
                            request.params['lean'] = this.config.lean ? 'true' : 'false';
                        } else {
                            request.params = {
                                lean: this.config.lean ? 'true' : 'false',
                                apikey: this.config.apiKey
                            };
                        }
                    } else {
                        if (request.params) {
                            request.params['lean'] = this.config.lean ? 'true' : 'false';
                        } else {
                            request.params = {
                                lean: this.config.lean ? 'true' : 'false'
                            };
                        }
                    }
                }

                // @ts-ignore
                this.jar.getCookiesSync(
                    request.baseURL,
                    // @ts-ignore
                    function (err, cookies) {
                        request.headers['cookie'] = cookies.join('; ');
                    }
                );
                if (this.config.proxyConfigured) {
                    this.jar.getCookiesSync(
                        this.config.baseProxyURL,
                        // @ts-ignore
                        function (err, cookies) {
                            request.headers['cookie'] = cookies.join('; ');
                        }
                    );
                }

                Logger.debug(
                    `Preparing request ${this._getRequestSummary(request)} (proxy=${Boolean(this.config.proxyConfigured)}, csrf=${request.url === 'login'})`,
                    LOG_SOURCE
                );

                return request;
            }.bind(this)
        );

        this.client.interceptors.response.use(
            function (response) {
                Logger.debug(`Received response ${response.status} for ${this._getResponseSummary(response)}`, LOG_SOURCE);

                const cookies = response.headers['set-cookie'];

                if (cookies) {
                    let parsedCookies;

                    if (cookies instanceof Array) {
                        // @ts-ignore
                        parsedCookies = cookies.map(Cookie.parse);
                    } else {
                        parsedCookies = [Cookie.parse(cookies)];
                    }

                    let version;
                    let appSecurity;

                    if (response.data && response.data.maxupg) {
                        version = response.data.maxupg;
                        appSecurity = response.data.appserversecurity;
                    }

                    parsedCookies.forEach((cookie) => {
                        // If we are using a stand alone version of Maximo Manage it will return a secure cookie flag when not secure.
                        // To allow the session cookie to be used we need to force it to not be secure.
                        if (
                            // @ts-ignore
                            cookie.secure &&
                            response.request.protocol == 'http:' &&
                            version &&
                            version.startsWith('V8') &&
                            !appSecurity
                        ) {
                            // @ts-ignore
                            cookie.secure = false;
                        }
                        // @ts-ignore
                        this.jar.setCookieSync(cookie, response.request.protocol + '//' + response.request.host);
                    });

                    Logger.debug(`Stored ${parsedCookies.length} response cookie(s) for ${this._getResponseSummary(response)}`, LOG_SOURCE);
                }

                if (response.headers['csrftoken']) {
                    this._csrfToken = response.headers['csrftoken'];
                    Logger.debug('Updated CSRF token from response headers.', LOG_SOURCE);
                }

                return response;
            }.bind(this),
            this._processError.bind(this)
        );

        // When the first created the state of the client is disconnected.
        this._isConnected = false;

        this._currentLogFile = undefined;
        this._isLogging = false;
        this._csrfToken = null;
    }

    get connected() {
        return this._isConnected;
    }

    async connect() {
        Logger.debug('Starting connection to Maximo.', LOG_SOURCE);

        var response = await this.client.post('login');

        var maxRedirects = 5;

        var redirectUri = response.headers['location'];
        if (response.status == 302 && this._isOIDCAuthRedirectResponse(response)) {
            Logger.debug('Detected OIDC authentication redirect flow.', LOG_SOURCE);
            for (var i = 0; i < maxRedirects; i++) {
                if (redirectUri == null) {
                    Logger.debug(`OIDC redirect flow ended early at hop ${i + 1} because no redirect URI was returned.`, LOG_SOURCE);
                    break;
                }

                response = await this.client.get(redirectUri, {
                    maxRedirects: 0,
                    withCredentials: true,
                    auth: {
                        username: this.config.username,
                        password: this.config.password
                    },
                    validateStatus: function (status) {
                        return status == 200 || status == 302;
                    }
                });
                Logger.debug(`OIDC redirect hop ${i + 1} returned status ${response.status}.`, LOG_SOURCE);
                if (response.status == 302) {
                    // get the redirect URL from the header
                    redirectUri = response.headers['location'];
                } else {
                    break;
                }
            }
        } else if (response.status == 302 && this._isLTPAFormRedirect(response)) {
            Logger.debug('Detected LTPA form authentication redirect flow.', LOG_SOURCE);
            for (var i = 0; i < maxRedirects; i++) {
                if (redirectUri == null) {
                    Logger.debug(`LTPA redirect flow ended early at hop ${i + 1} because no redirect URI was returned.`, LOG_SOURCE);
                    break;
                }

                if (redirectUri.includes('login.jsp?')) {
                    Logger.debug('Submitting credentials to LTPA login form.', LOG_SOURCE);
                    const headers = {
                        'content-type': 'application/x-www-form-urlencoded'
                    };
                    const data = `j_username=${this.config.username}&j_password=${this.config.password}`;

                    response = await this.client.post(this.config.formLoginURL, data, {
                        maxRedirects: 0,
                        headers: headers,
                        withCredentials: true,
                        validateStatus: function (status) {
                            return status == 200 || status == 302;
                        }
                    });

                    await this.client.get(redirectUri);
                    response = await this.client.post('login');
                    break;
                } else if (redirectUri.includes('loginerror.jsp')) {
                    this._isConnected = false;
                    Logger.debug('LTPA login flow redirected to loginerror.jsp.', LOG_SOURCE);
                    throw new LoginFailedError('You cannot log in at this time. Contact the system administrator.');
                } else {
                    response = await this.client.post(redirectUri, {
                        maxRedirects: 0,
                        withCredentials: true,
                        validateStatus: function (status) {
                            return status == 200 || status == 302;
                        }
                    });
                    Logger.debug(`LTPA redirect hop ${i + 1} returned status ${response.status}.`, LOG_SOURCE);
                    if (response.status == 302) {
                        // get the redirect URL from the header
                        redirectUri = response.headers['location'];
                    } else {
                        break;
                    }
                }
            }
        }

        Logger.debug(`Connection flow completed with status ${response.status}.`, LOG_SOURCE);
        this._responseHandler(response);
    }

    _addAuthHeaders(request) {
        if (this.config.apiKey == null || this.config.apiKey == '') {
            request.headers['maxauth'] = this.config.maxauth;
            if (!this.config.maxauthOnly) {
                request.auth = {
                    username: this.config.username,
                    password: this.config.password
                };
            }

            request.withCredentials = true;
            Logger.debug(`Configured MAXAUTH headers for ${this._getRequestSummary(request)}.`, LOG_SOURCE);
        } else {
            Logger.debug(`Using API key authentication for ${this._getRequestSummary(request)}.`, LOG_SOURCE);
        }
    }

    _getRequestSummary(request) {
        const method = request && request.method ? request.method.toUpperCase() : 'GET';
        const url = request && request.url ? request.url : 'unknown';

        return `${method} ${url.split('?')[0]}`;
    }

    _getResponseSummary(response) {
        if (response && response.config) {
            return this._getRequestSummary(response.config);
        }

        if (response && response.request && response.request.path) {
            return response.request.path.split('?')[0];
        }

        return 'unknown request';
    }

    _isLTPAFormRedirect(response) {
        if (!response) {
            return false;
        }

        // Check whether this is a redirect response
        if (response.status < 300 || response.status >= 400) return false;

        const cookies = response.headers['set-cookie'];

        if (cookies) {
            var parsedCookies;
            if (cookies instanceof Array) {
                // @ts-ignore
                parsedCookies = cookies.map(Cookie.parse);
            } else {
                parsedCookies = [Cookie.parse(cookies)];
            }

            if (!parsedCookies || parsedCookies.length == 0) {
                return false;
            }

            // MAS8 sets matching cookies: WASOidcStateXXXXXX and WASReqURLOidcXXXXXX
            // This is from specific observation and may need review/revision
            var wasPostParamName = 'WASPostParam';
            var wasPostParamCookie = parsedCookies.filter((c) =>
                // @ts-ignore
                c.key.toLowerCase().startsWith(wasPostParamName.toLowerCase())
            );
            return wasPostParamCookie.length > 0;
        } else {
            return false;
        }
    }

    _isOIDCAuthRedirectResponse(response) {
        if (!response) {
            return false;
        }

        // Check whether this is a redirect response
        if (response.status < 300 || response.status >= 400) return false;

        const cookies = response.headers['set-cookie'];

        if (cookies) {
            var parsedCookies;
            if (cookies instanceof Array) {
                // @ts-ignore
                parsedCookies = cookies.map(Cookie.parse);
            } else {
                parsedCookies = [Cookie.parse(cookies)];
            }

            if (!parsedCookies || parsedCookies.length == 0) {
                return false;
            }

            // MAS8 sets matching cookies: WASOidcStateXXXXXX and WASReqURLOidcXXXXXX
            // This is from specific observation and may need review/revision
            var oidcStateCookieNamePrefix = 'WASOidcState';
            var oidcStateCookie = parsedCookies.filter((c) =>
                // @ts-ignore
                c.key.toLowerCase().startsWith(oidcStateCookieNamePrefix.toLowerCase())
            );
            if (!oidcStateCookie || oidcStateCookie.length == 0) return false;

            // determine the identifier for the corresponding req url cookie name.
            // @ts-ignore
            var stateIdentifier = oidcStateCookie[0].key.substring(oidcStateCookieNamePrefix.length);
            var oidcReqUrlCookieNamePrefix = 'WASReqURLOidc';
            var targetCookieName = oidcReqUrlCookieNamePrefix + stateIdentifier;

            // ensure we have a matching req url cookie
            return (
                parsedCookies.filter(
                    // @ts-ignore
                    (c) => c.key.toLowerCase() == targetCookieName.toLowerCase()
                ).length > 0
            );
        } else {
            return false;
        }
    }

    _responseHandler(response) {
        if (response) {
            if (response.status == 200) {
                if (response.data && response.data.maxupg) {
                    this.maxVersion = response.data.maxupg;
                }
                this._isConnected = true;
                Logger.debug(`Connection established successfully. maxVersion=${this.maxVersion}`, LOG_SOURCE);
            } else if (response.status == 401) {
                this._isConnected = false;
                Logger.debug('Connection failed with HTTP 401.', LOG_SOURCE);
                throw new LoginFailedError('You cannot log in at this time. Contact the system administrator.');
            } else {
                this._isConnected = false;
                Logger.debug(`Connection ended without success. status=${response.status}`, LOG_SOURCE);
            }
        }
    }

    async disconnect() {
        // we don't care about the response status because if it fails there is nothing we can do about it.
        if (this._isConnected) {
            Logger.debug('Disconnecting Maximo client session.', LOG_SOURCE);
            try {
                await this.client.post('logout', { withCredentials: true });
                Logger.debug('Logout request completed.', LOG_SOURCE);
            } catch (error) {
                Logger.error('Warning disconnecting: ' + JSON.stringify(error));
            }
        } else {
            Logger.debug('Disconnect requested while client was already disconnected.', LOG_SOURCE);
        }
    }

    async getScriptSource(script, progress, fileName) {
        let isPython = fileName.endsWith('.py') || fileName.endsWith('.jy');
        progress.report({
            increment: 33,
            message: 'Getting script from the server.'
        });

        const options = {
            url: 'script/naviam.autoscript.deploy/source/' + (isPython ? 'python' : ''),
            method: MaximoClient.Method.POST,
            headers: {
                'Content-Type': 'text/plain',
                Accept: 'application/json'
            },
            data: script
        };

        progress.report({
            increment: 33,
            message: 'Getting script from the server.'
        });
        await new Promise((resolve) => setTimeout(resolve, 100));
        // @ts-ignore
        const result = await this.client.request(options);

        progress.report({
            increment: 100,
            message: 'Getting script from the server.'
        });
        return result.data;
    }

    async dbConfigRequired() {
        const headers = new Map();
        headers['Content-Type'] = 'application/json';
        const options = {
            url: 'script/naviam.autoscript.admin/configdbrequired',
            method: MaximoClient.Method.GET,
            headers: { common: headers }
        };

        // @ts-ignore
        const response = await this.client.request(options);

        if (typeof response.data.status !== 'undefined' && response.data.status === 'ok') {
            if (typeof response.data.configDBRequired !== 'undefined') {
                return response.data.configDBRequired;
            } else {
                return false;
            }
        } else {
            throw new MaximoError('Error checking if database configuration is required: ' + response.data.error);
        }
    }

    async dbConfigRequiresAdminMode() {
        const headers = new Map();
        headers['Content-Type'] = 'application/json';
        const options = {
            url: 'script/naviam.autoscript.admin/configdbrequiresadminmode',
            method: MaximoClient.Method.GET,
            headers: { common: headers }
        };

        // @ts-ignore
        const response = await this.client.request(options);

        if (typeof response.data.status !== 'undefined' && response.data.status === 'ok') {
            if (typeof response.data.configDBRequiresAdminMode !== 'undefined') {
                return response.data.configDBRequiresAdminMode;
            } else {
                return false;
            }
        } else {
            throw new MaximoError('Error checking if database configuration requires admin mode: ' + response.data.error);
        }
    }

    async setAdminModeOn() {
        const headers = new Map();
        headers['Content-Type'] = 'application/json';
        const options = {
            url: 'script/naviam.autoscript.admin/adminmodeon',
            method: MaximoClient.Method.POST,
            headers: { common: headers }
        };

        // @ts-ignore
        const response = await this.client.request(options);

        if (typeof response.data.status !== 'undefined' && response.data.status === 'ok') {
            if (typeof response.data.configDBRequiresAdminMode !== 'undefined') {
                return response.data.configDBRequiresAdminMode;
            } else {
                return false;
            }
        } else {
            throw new MaximoError('Error setting Admin Mode On: ' + response.data.error);
        }
    }

    async setAdminModeOff() {
        const headers = new Map();
        headers['Content-Type'] = 'application/json';
        const options = {
            url: 'script/naviam.autoscript.admin/adminmodeoff',
            method: MaximoClient.Method.POST,
            headers: { common: headers }
        };

        // @ts-ignore
        const response = await this.client.request(options);

        if (typeof response.data.status !== 'undefined' && response.data.status === 'ok') {
            if (typeof response.data.configDBRequiresAdminMode !== 'undefined') {
                return response.data.configDBRequiresAdminMode;
            } else {
                return false;
            }
        } else {
            throw new MaximoError('Error setting Admin Mode Off: ' + response.data.error);
        }
    }

    async isAdminModeOn() {
        const headers = new Map();
        headers['Content-Type'] = 'application/json';
        const options = {
            url: 'script/naviam.autoscript.admin/adminmodeon',
            method: MaximoClient.Method.GET,
            headers: { common: headers }
        };

        // @ts-ignore
        try {
            const response = await this.client.request(options);

            if (typeof response.data.status !== 'undefined' && response.data.status === 'ok') {
                if (typeof response.data.adminModeOn !== 'undefined') {
                    return response.data.adminModeOn;
                } else {
                    return false;
                }
            } else {
                throw new MaximoError('Error checking if admin mode is on: ' + response.data.error);
            }
        } catch (error) {
            if (error.code === 'ECONNABORTED' && error.message && error.message.includes('timeout') && this.adminModeRetryCount < 10) {
                this.adminModeRetryCount++;
                Logger.debug('Retrying isAdminModeOn due to timeout, attempt ' + this.adminModeRetryCount, LOG_SOURCE);
                return await this.isAdminModeOn();
            } else {
                throw error;
            }
        } finally {
            this.adminModeRetryCount = 0;
        }
    }

    async dbConfigInProgress() {
        const headers = new Map();
        headers['Content-Type'] = 'application/json';
        const options = {
            url: 'script/naviam.autoscript.admin/configuring',
            method: MaximoClient.Method.GET,
            headers: { common: headers }
        };

        // @ts-ignore
        const response = await this.client.request(options);

        if (typeof response.data.status !== 'undefined' && response.data.status === 'ok') {
            if (typeof response.data.configuring !== 'undefined') {
                return response.data.configuring;
            } else {
                return false;
            }
        } else {
            throw new MaximoError('Error checking database configuration is in progress: ' + response.data.error);
        }
    }

    async dbConfigMessages() {
        const headers = new Map();
        headers['Content-Type'] = 'application/json';
        const options = {
            url: 'script/naviam.autoscript.admin/configmessages',
            method: MaximoClient.Method.GET,
            headers: { common: headers }
        };

        // @ts-ignore
        const response = await this.client.request(options);

        if (typeof response.data.status !== 'undefined' && response.data.status === 'ok') {
            return response.data.messages;
        } else {
            throw new MaximoError('Error checking database configuration is in progress: ' + response.data.error);
        }
    }

    async applyDBConfig() {
        const headers = new Map();
        headers['Content-Type'] = 'application/json';
        const options = {
            url: 'script/naviam.autoscript.admin/applyconfigdb',
            method: MaximoClient.Method.POST,
            headers: { common: headers }
        };

        // @ts-ignore
        const response = await this.client.request(options);

        if (typeof response.data.status !== 'undefined' && response.data.status === 'ok') {
            if (typeof response.data.configDBRequiresAdminMode !== 'undefined') {
                return response.data.configDBRequiresAdminMode;
            } else {
                return false;
            }
        } else {
            throw new MaximoError('Error applying database configuration: ' + response.data.error);
        }
    }

    async postConfig(json, cancelToken, progress) {
        Logger.debug(
            `Starting JSON configuration deploy (payloadType=${typeof json}, payloadSize=${typeof json === 'string' ? json.length : 'n/a'}).`,
            LOG_SOURCE
        );

        const headers = new Map();
        headers['Content-Type'] = 'application/json';
        headers['Accept'] = 'text/event-stream';

        const configOptions = {
            url: 'script/naviam.autoscript.deploy/config',
            method: MaximoClient.Method.POST,
            headers: { common: headers },
            responseType: 'stream',
            data: json
        };

        // @ts-ignore
        const response = await this.client.request(configOptions);

        let contentType = response.headers['content-type'];
        Logger.debug(`Configuration deploy response content type: ${contentType || 'unknown'}.`, LOG_SOURCE);

        var deployId = null;

        var cancelRequested = false;

        if (cancelToken) {
            cancelToken.onCancellationRequested(async () => {
                Logger.debug(`Configuration deploy cancellation requested (deployIdAvailable=${deployId != null}).`, LOG_SOURCE);
                if (deployId != null) {
                    const cancelOptions = {
                        url: 'script/naviam.autoscript.deploy',
                        method: MaximoClient.Method.PUT,
                        headers: {
                            Accept: 'application/json'
                        },
                        params: {
                            deployId: deployId,
                            cancel: 'true'
                        }
                    };

                    // @ts-ignore
                    this.client.request(cancelOptions);
                }
                cancelRequested = true;
            });
        }

        if (contentType && contentType.startsWith('text/event-stream')) {
            Logger.debug('Configuration deploy is using SSE streaming.', LOG_SOURCE);
            var result = await new Promise((resolve, reject) => {
                var dataBuffer = '';
                var isSSE = true;
                var firstData = true;

                if (typeof response.data !== 'undefined') {
                    if (typeof response.data.on !== 'function') {
                        Logger.debug('Configuration deploy stream did not expose an event emitter.', LOG_SOURCE);
                        return;
                    }
                    response.data.on('data', (data) => {
                        if (cancelRequested) {
                            Logger.debug('Configuration deploy stream handler stopped due to cancellation.', LOG_SOURCE);
                            resolve();
                        } else {
                            if (data && data instanceof Uint8Array) {
                                let decoder = new TextDecoder('utf-8');
                                let sData = decoder.decode(data);

                                if (sData) {
                                    if (firstData) {
                                        if (sData.indexOf('data: ') <= 0 && sData.indexOf('id: ') <= 0) {
                                            isSSE = false;
                                            Logger.debug('Configuration deploy response did not match SSE framing on first chunk.', LOG_SOURCE);
                                        }
                                        firstData = false;
                                    }

                                    if (isSSE) {
                                        dataBuffer += sData;

                                        if (dataBuffer.indexOf('\n\n') > 0) {
                                            sData = dataBuffer.substring(0, dataBuffer.lastIndexOf('\n\n'));
                                            dataBuffer = dataBuffer.substring(dataBuffer.lastIndexOf('\n\n') + 2);

                                            var messages = sData.split('\n\n');
                                            messages.forEach((message) => {
                                                if (message.indexOf(': ') > 0) {
                                                    var parts = message.split('\n');
                                                    var event = {};
                                                    parts.forEach((part) => {
                                                        if (part.indexOf(': ') > 0) {
                                                            var key = part.substring(0, part.indexOf(': '));
                                                            var value = part.substring(part.indexOf(': ') + 2);
                                                            event[key] = value;
                                                        }
                                                    });

                                                    if (typeof event.event === 'string') {
                                                        switch (event.event) {
                                                            case 'progress':
                                                                if (typeof event.data === 'string') {
                                                                    if (typeof progress !== 'undefined' && progress !== null) {
                                                                        progress.report({
                                                                            message: event.data
                                                                        });
                                                                    }
                                                                }
                                                                break;
                                                            case 'warning':
                                                                if (typeof event.data === 'string') {
                                                                    Logger.debug(`Configuration deploy warning: ${event.data}`, LOG_SOURCE);
                                                                    progress.report({
                                                                        message: '⚠️ ' + event.data
                                                                    });
                                                                }
                                                                break;
                                                            case 'error':
                                                                if (typeof event.data === 'string') {
                                                                    Logger.debug(`Configuration deploy error event: ${event.data}`, LOG_SOURCE);
                                                                    resolve({ status: 'error', message: event.data });
                                                                }
                                                                break;
                                                            default:
                                                                break;
                                                        }
                                                    }
                                                }
                                            });
                                        }
                                    }
                                }
                            }
                        }
                    });

                    response.data.on('end', () => {
                        Logger.debug('Configuration deploy stream completed.', LOG_SOURCE);
                        resolve({ status: 'success' });
                    });

                    response.data.on('error', (error) => {
                        Logger.debug(`Configuration deploy stream error: ${error.message}`, LOG_SOURCE);
                        reject({ status: 'error', message: error.message });
                    });
                }
            });

            if (typeof result !== 'undefined' && result.status === 'error') {
                if (result.message.startsWith('psdi.util')) {
                    result.message = result.message.substring(result.message.indexOf(':') + 1).trim();
                }
                Logger.debug(`Configuration deploy finished with an error: ${result.message}`, LOG_SOURCE);
                window.showErrorMessage('Error applying configuration:\n' + result.message, { modal: true });
            } else {
                Logger.debug('Configuration deploy completed successfully.', LOG_SOURCE);
            }
        } else {
            Logger.debug('Configuration deploy returned a non-stream response.', LOG_SOURCE);
            if (typeof response.data.status !== 'undefined' && response.data.status === 'error') {
                throw new MaximoError('Error applying JSON configuration: ' + response.data.message);
            }
        }
    }

    async postScript(script, progress, fileName, deployScript, cancelToken) {
        let isPython = fileName.endsWith('.py') || fileName.endsWith('.jy');
        Logger.debug(`Deploying script ${fileName} (language=${isPython ? 'python' : 'javascript'}, preDeploy=${Boolean(deployScript)}).`, LOG_SOURCE);

        progress.report({
            increment: 10,
            message: `Deploying script ${fileName}`
        });

        if (deployScript) {
            Logger.debug(`Submitting pre-deploy script for ${fileName}.`, LOG_SOURCE);
            const deployOptions = {
                url: 'script/naviam.autoscript.deploy' + (isPython ? '/python' : ''),
                method: MaximoClient.Method.POST,
                headers: {
                    'Content-Type': 'text/plain',
                    Accept: 'application/json'
                },
                data: deployScript
            };
            // @ts-ignore
            await this.client.request(deployOptions);
        }

        const options = {
            url: 'script/naviam.autoscript.deploy' + (isPython ? '/python' : ''),
            method: MaximoClient.Method.POST,
            headers: {
                'Content-Type': 'text/plain',
                Accept: 'application/json'
            },
            data: script
        };

        progress.report({
            increment: 40,
            message: `Deploying script ${fileName}`
        });
        await new Promise((resolve) => setTimeout(resolve, 100));
        // @ts-ignore
        const result = await this.client.request(options);
        Logger.debug(
            `Initial deploy response for ${fileName}: status=${result?.data?.status || 'unknown'}, deployId=${
                typeof result?.data?.deployid !== 'undefined' ? result.data.deployid : 'none'
            }.`,
            LOG_SOURCE
        );

        var nextProgress = 50;
        var deployId = null;

        if (cancelToken) {
            cancelToken.onCancellationRequested(async () => {
                Logger.debug(`Cancellation requested for script ${fileName} (deployIdAvailable=${deployId != null}).`, LOG_SOURCE);
                if (deployId != null) {
                    const cancelOptions = {
                        url: 'script/naviam.autoscript.deploy',
                        method: MaximoClient.Method.PUT,
                        headers: {
                            Accept: 'application/json'
                        },
                        params: {
                            deployId: result.data.deployid,
                            cancel: 'true'
                        }
                    };

                    // @ts-ignore
                    this.client.request(cancelOptions);
                }
            });
        }

        if (result.data && result.data.status == 'success' && typeof result.data.deployid !== 'undefined') {
            nextProgress = 25;
            deployId = result.data.deployid;
            let lastProgressMessage = null;

            Logger.debug(`Polling post-deploy configuration for ${fileName} using deployId=${deployId}.`, LOG_SOURCE);

            progress.report({
                increment: nextProgress,
                message: `Waiting for ${fileName} post deploy configuration to complete`
            });

            const checkOptions = {
                url: 'script/naviam.autoscript.deploy',
                method: MaximoClient.Method.GET,
                headers: {
                    'Content-Type': 'text/plain',
                    Accept: 'application/json'
                },
                params: { deployId: result.data.deployid }
            };

            // give the server a second to process the request.
            await new Promise((resolve) => setTimeout(resolve, 1000));

            // @ts-ignore
            var checkResult = await this.client.request(checkOptions);
            var checkCount = 0;

            while (checkResult.data.deploying) {
                checkCount++;
                await new Promise((resolve) => setTimeout(resolve, 5000));

                // @ts-ignore
                checkResult = await this.client.request(checkOptions);
                if (checkCount * 5000 > this.config.configurationTimeout) {
                    var minutes = this.config.configurationTimeout / 60000;
                    Logger.debug(`Post-deploy configuration timed out for ${fileName} after ${checkCount} poll(s).`, LOG_SOURCE);
                    throw new MaximoError(
                        `The script deployed, but the configuration script exceed the time out of ${minutes} minute${
                            minutes > 1 ? 's' : ''
                        }. The configuration script may continue to execute in the background.`
                    );
                } else {
                    if (typeof checkResult.data.progress !== 'undefined' && Array.isArray(checkResult.data.progress) && checkResult.data.progress.length > 0) {
                        const lastMessage = checkResult.data.progress[checkResult.data.progress.length - 1];
                        if (lastMessage.message !== lastProgressMessage) {
                            Logger.debug(`Post-deploy progress for ${fileName}: ${lastMessage.message}`, LOG_SOURCE);
                            lastProgressMessage = lastMessage.message;
                        }
                        progress.report({
                            increment: 0,
                            message: `Waiting for ${fileName} post deploy configuration to complete: ${lastMessage.message}`
                        });
                    }
                }
            }

            Logger.debug(`Post-deploy configuration completed for ${fileName} after ${checkCount} poll(s).`, LOG_SOURCE);
            progress.report({
                increment: nextProgress,
                message: `Deploying script ${fileName}`
            });
            return checkResult.data;
        } else {
            Logger.debug(`Script ${fileName} completed without post-deploy polling.`, LOG_SOURCE);
            progress.report({
                increment: nextProgress,
                message: `Deploying script ${fileName}`
            });
            return result.data;
        }
    }
    async postScreen(screen, progress, fileName) {
        progress.report({
            increment: 10,
            message: `Deploying screen ${fileName}`
        });

        const options = {
            url: 'script/naviam.autoscript.screens',
            method: MaximoClient.Method.POST,
            headers: {
                'Content-Type': 'text/plain',
                Accept: 'application/json'
            },
            data: screen
        };

        progress.report({
            increment: 50,
            message: `Deploying screen ${fileName}`
        });
        await new Promise((resolve) => setTimeout(resolve, 100));
        // @ts-ignore
        const result = await this.client.request(options);

        progress.report({
            increment: 90,
            message: `Deploying screen ${fileName}`
        });
        return result.data;
    }

    async postReport(report, progress, fileName) {
        progress.report({
            increment: 10,
            message: `Deploying report ${fileName}`
        });

        const options = {
            url: 'script/naviam.autoscript.report',
            method: MaximoClient.Method.POST,
            headers: {
                'Content-Type': 'text/plain',
                Accept: 'application/json'
            },
            data: report
        };

        progress.report({
            increment: 50,
            message: `Deploying report ${fileName}`
        });
        await new Promise((resolve) => setTimeout(resolve, 100));
        // @ts-ignore
        const result = await this.client.request(options);

        progress.report({
            increment: 90,
            message: `Deploying report ${fileName}`
        });
        return result.data;
    }

    async postForm(form, progress) {
        progress.report({
            increment: 10,
            message: `Deploying inspection form ${form.name}`
        });

        const options = {
            url: 'script/naviam.autoscript.form',
            method: MaximoClient.Method.POST,
            headers: {
                'Content-Type': 'text/plain',
                Accept: 'application/json'
            },
            data: JSON.stringify(form, null, 4)
        };

        progress.report({
            increment: 50,
            message: `Deploying inspection form ${form.name}`
        });
        await new Promise((resolve) => setTimeout(resolve, 100));
        // @ts-ignore
        const result = await this.client.request(options);

        progress.report({
            increment: 90,
            message: `Deploying inspection form ${form.name}`
        });
        return result.data;
    }

    async installed() {
        const headers = new Map();
        headers['Content-Type'] = 'application/json';
        const options = {
            url: `os/${this.scriptEndpoint}?oslc.select=autoscript&oslc.where=autoscript="NAVIAM.AUTOSCRIPT.DEPLOY"`,
            method: MaximoClient.Method.GET,
            headers: { common: headers }
        };

        try {
            // @ts-ignore
            const response = await this.client.request(options);
            if (!response || response.headers['content-type'] !== 'application/json') {
                throw new MaximoError('Received an unexpected response from the server. Content-Type header is not application/json.');
            }

            return response.data.member.length !== 0;
        } catch (e) {
            // If the response is BMXAA9301E the MXSCRIPT endpoint is not available.
            // If the response is BMXAA0024E the MXSCRIPT endpoint is not configured with security.
            if (e.reasonCode && (e.reasonCode === 'BMXAA9301E' || e.reasonCode === 'BMXAA0024E')) {
                this.scriptEndpoint = 'mxapiautoscript';
                return await this.installed();
            }
        }
    }

    async upgradeRequired() {
        const headers = new Map();
        headers['Content-Type'] = 'application/json';
        const options = {
            url: 'script/NAVIAM.AUTOSCRIPT.DEPLOY/version',
            method: MaximoClient.Method.GET,
            headers: { common: headers }
        };

        // @ts-ignore
        const response = await this.client.request(options);
        if (typeof response.data.version !== 'undefined') {
            return semver.lt(response.data.version, this.requiredScriptVersion);
        } else if (typeof response.data.status !== 'undefined' && response.data.status === 'error') {
            throw new MaximoError(response.data.message);
        } else {
            return true;
        }
    }

    async javaVersion() {
        const headers = new Map();
        headers['Content-Type'] = 'application/json';
        var options = {
            url: '',
            method: MaximoClient.Method.GET,
            headers: { common: headers }
        };

        // @ts-ignore
        var response = await this.client.request(options);

        if (response.data.thisserver) {
            options = {
                url: 'members/thisserver/jvm',
                method: MaximoClient.Method.GET,
                headers: { common: headers }
            };

            // @ts-ignore
            response = await this.client.request(options).catch((error) => {
                // if the user doesn't have access to check the Java version then just skip it.
                if (typeof error.reasonCode !== 'undefined' && error.reasonCode === 'BMXAA9051E') {
                    return 'no-permission';
                } else {
                    throw error;
                }
            });

            // @ts-ignore
            if (response === 'no-permission') {
                return response;
            }

            if (typeof response.data !== 'undefined') {
                return response.data.specVersion;
            } else {
                return 'unavailable';
            }
        } else {
            return 'unavailable';
        }
    }

    async maximoVersion() {
        if (typeof this.maxVersion !== 'undefined' && this.maxVersion !== 'unknown' && this.maxVersion !== 'undefined') {
            return this.maxVersion;
        } else {
            const headers = new Map();
            headers['Content-Type'] = 'application/json';
            const options = {
                url: '',
                method: MaximoClient.Method.GET,
                headers: { common: headers }
            };

            // @ts-ignore
            const response = await this.client.request(options);
            this.maxVersion = response.data.maxupg;
            return this.maxVersion;
        }
    }

    async sharptreeInstalled() {
        const headers = new Map();
        headers['Content-Type'] = 'application/json';
        const options = {
            url: `os/${this.scriptEndpoint}?oslc.select=autoscript&oslc.where=autoscript="SHARPTREE.AUTOSCRIPT.DEPLOY"`,
            method: MaximoClient.Method.GET,
            headers: { common: headers }
        };

        try {
            // @ts-ignore
            const response = await this.client.request(options);
            if (!response || response.headers['content-type'] !== 'application/json') {
                throw new MaximoError('Received an unexpected response from the server. Content-Type header is not application/json.');
            }

            return response.data.member.length !== 0;
        } catch (e) {
            // If the response is BMXAA9301E the MXSCRIPT endpoint is not available.
            // If the response is BMXAA0024E the MXSCRIPT endpoint is not configured with security.
            if (e.reasonCode && (e.reasonCode === 'BMXAA9301E' || e.reasonCode === 'BMXAA0024E')) {
                this.scriptEndpoint = 'mxapiautoscript';
                return await this.sharptreeInstalled();
            }
        }
    }

    async installOrUpgrade(progress, bootstrap) {
        if (!this._isConnected) {
            throw new MaximoError('Maximo client is not connected.');
        }

        Logger.debug(`Starting install/upgrade (bootstrap=${Boolean(bootstrap)}, scriptVersion=${this.currentScriptVersion}).`, LOG_SOURCE);

        let increment = 100 / 14;

        progress.report({ increment: increment });

        if (bootstrap) {
            Logger.debug('Running bootstrap installation.', LOG_SOURCE);
            var result = await this._bootstrap(progress, increment);

            if (result.status === 'error') {
                Logger.debug(`Bootstrap installation failed: ${result.message}`, LOG_SOURCE);
                progress.report({ increment: 100 });
                return result;
            }

            Logger.debug('Bootstrap installation completed successfully.', LOG_SOURCE);
            progress.report({
                increment: increment,
                message: 'Performed bootstrap installation.'
            });
            await new Promise((resolve) => setTimeout(resolve, 500));
        }

        let source = fs.readFileSync(path.resolve(__dirname, '../resources/naviam.autoscript.store.js')).toString();
        await this._installOrUpdateScript('naviam.autoscript.store', 'Naviam Automation Script Storage Script', source, progress, increment);

        source = fs.readFileSync(path.resolve(__dirname, '../resources/naviam.autoscript.extract.js')).toString();
        await this._installOrUpdateScript('naviam.autoscript.extract', 'Naviam Automation Script Extract Script', source, progress, increment);

        source = fs.readFileSync(path.resolve(__dirname, '../resources/naviam.autoscript.logging.js')).toString();
        await this._installOrUpdateScript('naviam.autoscript.logging', 'Naviam Automation Script Log Streaming', source, progress, increment);

        // initialize the logging security.
        result = this._initLogStreamSecurity();

        if (result.status == 'error') {
            throw new MaximoError(result.message);
        }

        source = fs.readFileSync(path.resolve(__dirname, '../resources/naviam.autoscript.deploy.js')).toString();
        await this._installOrUpdateScript('naviam.autoscript.deploy', 'Naviam Automation Script Deploy Script', source, progress, increment);

        source = fs.readFileSync(path.resolve(__dirname, '../resources/naviam.autoscript.screens.js')).toString();
        await this._installOrUpdateScript('naviam.autoscript.screens', 'Naviam Screens Script', source, progress, increment);

        source = fs.readFileSync(path.resolve(__dirname, '../resources/naviam.autoscript.form.js')).toString();
        await this._installOrUpdateScript('naviam.autoscript.form', 'Naviam Inspection Forms Script', source, progress, increment);

        source = fs.readFileSync(path.resolve(__dirname, '../resources/naviam.autoscript.library.js')).toString();
        await this._installOrUpdateScript('naviam.autoscript.library', 'Naviam Deployment Library Script', source, progress, increment);

        source = fs.readFileSync(path.resolve(__dirname, '../resources/naviam.autoscript.admin.js')).toString();
        await this._installOrUpdateScript('naviam.autoscript.admin', 'Naviam Admin Script', source, progress, increment);

        source = fs.readFileSync(path.resolve(__dirname, '../resources/naviam.autoscript.report.js')).toString();
        await this._installOrUpdateScript(
            'naviam.autoscript.report',
            'Report Automation Script for Exporting and Importing Reports',
            source,
            progress,
            increment
        );

        source = fs.readFileSync(path.resolve(__dirname, '../resources/naviam.autoscript.objects.js')).toString();
        await this._installOrUpdateScript('naviam.autoscript.objects', 'Naviam Objects Script', source, progress, increment);

        source = fs.readFileSync(path.resolve(__dirname, '../resources/naviam.autoscript.dbc.js')).toString();
        await this._installOrUpdateScript('naviam.autoscript.dbc', 'Naviam DBC Script', source, progress, increment);

        source = fs.readFileSync(path.resolve(__dirname, '../resources/naviam.autoscript.debug.js')).toString();
        await this._installOrUpdateScript('naviam.autoscript.debug', 'Naviam Debug Script', source, progress, increment);

        Logger.debug('All scripts installed/updated. Running post-install steps.', LOG_SOURCE);
        await this._fixInspectionFormData();
        progress.report({ increment: 100 });

        if (await this.sharptreeInstalled()) {
            Logger.debug('Sharptree installation detected. Starting migration.', LOG_SOURCE);
            progress.report({
                message: 'Migrating Sharptree configurations to Naviam.'
            });

            await this._migrateSharptree();

            Logger.debug('Sharptree migration completed.', LOG_SOURCE);
            progress.report({
                message: 'Migration from Sharptree to Naviam complete.'
            });
        }

        Logger.debug('Install/upgrade finished.', LOG_SOURCE);
    }

    async _migrateSharptree() {
        if (!this._isConnected) {
            throw new MaximoError('Maximo client is not connected.');
        }

        let refUri;

        let activeStatus = await this._synonymdomainToExternalDefaultValue('AUTOSCRPHASE', 'Production', 'Active');
        try {
            const headers = new Map();
            headers['Content-Type'] = 'application/json';

            if (this._csrfToken) {
                headers['csrftoken'] = this._csrfToken;
            }

            // eslint-disable-next-line no-undef
            let source = fs.readFileSync(path.resolve(__dirname, '../resources/naviam.autoscript.migrate.js')).toString();

            let options = {
                url: `os/${this.scriptEndpoint}?oslc.select=autoscript&oslc.where=autoscript="NAVIAM.AUTOSCRIPT.MIGRATE"`,
                method: MaximoClient.Method.GET,
                headers: { common: headers }
            };

            // @ts-ignore
            let response = await this.client.request(options);
            let href;
            if (response.data.member.length === 1) {
                href = response.data.member[0].href;
            }

            if (href) {
                let deployScript = {
                    description: 'Naviam AutoScript Migrate from Sharptree',
                    status: activeStatus,
                    version: this.currentScriptVersion,
                    scriptlanguage: 'javascript',
                    source: source
                };
                headers['x-method-override'] = 'PATCH';
                options = {
                    url: href,
                    method: MaximoClient.Method.POST,
                    headers: { common: headers },
                    data: deployScript
                };
            } else {
                let deployScript = {
                    autoscript: 'naviam.autoscript.migrate',
                    description: 'Naviam AutoScript Migrate from Sharptree',
                    status: activeStatus,
                    version: '1.0.0',
                    scriptlanguage: 'javascript',
                    source: source
                };
                options = {
                    url: `os/${this.scriptEndpoint}`,
                    method: MaximoClient.Method.POST,
                    headers: { common: headers },
                    data: deployScript
                };
            }

            // @ts-ignore
            response = await this.client.request(options);
            refUri = response.headers.location;

            if (href && !refUri) {
                refUri = href;
            }

            options = {
                url: 'script/naviam.autoscript.migrate',
                method: MaximoClient.Method.POST,
                headers: { common: headers }
            };

            // @ts-ignore
            var result = await this.client.request(options);
            return result.data;
        } finally {
            if (refUri) {
                const headers = new Map();
                headers['Content-Type'] = 'application/json';
                if (this._csrfToken) {
                    headers['csrftoken'] = this._csrfToken;
                }
                let options = {
                    url: refUri,
                    headers: { common: headers },
                    method: MaximoClient.Method.DELETE
                };

                // @ts-ignore
                await this.client.request(options);
            }
        }
    }

    async getLoggingServers() {
        const headers = new Map();
        headers['Content-Type'] = 'application/json';

        let options = {
            url: 'script/naviam.autoscript.logging?list=true',
            method: MaximoClient.Method.GET,
            headers: { common: headers }
        };

        // @ts-ignore
        const response = await this.client.request(options);
        return response.data;
    }

    // @ts-ignore
    async startLogging(filePath, timeout, statusBar, host) {
        if (typeof timeout === 'undefined') {
            timeout = 30;
        }

        Logger.debug(`Starting log streaming to ${filePath} (timeout=${timeout}s, host=${host || 'default'}).`, LOG_SOURCE);
        this._isLogging = true;

        const headers = new Map();
        headers['Content-Type'] = 'application/json';
        headers['Accept'] = 'text/event-stream';

        let options = {
            url: `script/naviam.autoscript.logging?timeout=${timeout}${
                host !== undefined && host !== null && host !== '' ? `&host=${encodeURIComponent(host)}` : ''
            }`,
            method: MaximoClient.Method.GET,
            responseType: 'stream',
            headers: { common: headers }
        };

        let lkp = undefined;
        let streamRequestCount = 0;
        try {
            while (this._isLogging) {
                // @ts-ignore
                if (typeof lkp !== 'undefined') {
                    lkp = lkp.replace(/(\r\n|\n|\r)/gm, '');
                    options.headers['log-lkp'] = lkp;
                }

                streamRequestCount++;
                Logger.debug(
                    `Opening log stream request ${streamRequestCount}${typeof lkp !== 'undefined' ? ' with checkpoint.' : ' without checkpoint.'}`,
                    LOG_SOURCE
                );

                // @ts-ignore
                let response = await this.client.request(options);

                let contentType = response.headers['content-type'];
                Logger.debug(`Log stream response content type: ${contentType || 'unknown'}.`, LOG_SOURCE);

                if (contentType === 'application/json') {
                    Logger.debug('Log stream returned JSON instead of SSE; attempting to parse error payload.', LOG_SOURCE);
                    if (typeof response !== 'undefined' && typeof response.data !== 'undefined') {
                        var internalError = await new Promise((resolve, reject) => {
                            let completeData = '';
                            response.data.on('data', (data) => {
                                if (!this._isLogging) {
                                    resolve();
                                } else {
                                    completeData += data;
                                }
                            });

                            response.data.on('end', () => {
                                if (completeData) {
                                    try {
                                        resolve(JSON.parse(completeData));
                                    } catch (error) {
                                        resolve();
                                    }
                                } else {
                                    resolve();
                                }
                            });

                            response.data.on('error', () => {
                                Logger.debug('Error occurred while reading JSON log stream response.', LOG_SOURCE);
                                this.stopLogging();
                                reject();
                            });
                        });
                        if (internalError) {
                            throw new MaximoError(internalError.message);
                        } else {
                            throw new MaximoError('An unexpected JSON response was returned by the server.');
                        }
                    } else {
                        throw new MaximoError('An unexpected JSON response was returned by the server.');
                    }
                } else if (contentType === 'text/event-stream') {
                    lkp = await new Promise((resolve, reject) => {
                        if (typeof response !== 'undefined' && typeof response.data !== 'undefined') {
                            var dataBuffer = '';
                            var isSSE = true;
                            var firstData = true;
                            var currentServerName = null;

                            response.data.on('data', (data) => {
                                if (!this._isLogging) {
                                    Logger.trace('Log stream handler stopped because logging was disabled.', LOG_SOURCE);
                                    resolve();
                                } else {
                                    if (data && data instanceof Uint8Array) {
                                        let decoder = new TextDecoder('utf-8');
                                        let sData = decoder.decode(data);

                                        if (sData) {
                                            if (firstData) {
                                                if (sData.indexOf('data: ') <= 0 && sData.indexOf('id: ') <= 0) {
                                                    isSSE = false;
                                                    Logger.debug('Log stream response fell back to plain text output.', LOG_SOURCE);
                                                }
                                                firstData = false;
                                            }

                                            if (isSSE) {
                                                dataBuffer += sData;

                                                if (dataBuffer.indexOf('\n\n') > 0) {
                                                    sData = dataBuffer.substring(0, dataBuffer.lastIndexOf('\n\n'));
                                                    dataBuffer = dataBuffer.substring(dataBuffer.lastIndexOf('\n\n') + 2);

                                                    var messages = sData.split('\n\n');
                                                    messages.forEach((message) => {
                                                        if (message.indexOf(': ') > 0) {
                                                            var parts = message.split('\n');
                                                            var event = {};
                                                            parts.forEach((part) => {
                                                                if (part.indexOf(': ') > 0) {
                                                                    var key = part.substring(0, part.indexOf(': '));
                                                                    var value = part.substring(part.indexOf(': ') + 2);
                                                                    event[key] = value;
                                                                }
                                                            });

                                                            if (
                                                                typeof event.event !== 'undefined' &&
                                                                event.event === 'name' &&
                                                                typeof statusBar !== 'undefined' &&
                                                                statusBar !== null
                                                            ) {
                                                                statusBar.text = '$(sync~spin) ' + event.data;
                                                                if (event.data !== currentServerName) {
                                                                    currentServerName = event.data;
                                                                    Logger.debug(`Log stream connected to server ${event.data}.`, LOG_SOURCE);
                                                                }
                                                            } else if (
                                                                typeof event.event !== 'undefined' &&
                                                                event.event === 'log' &&
                                                                typeof event.data !== 'undefined'
                                                            ) {
                                                                var parsedLogData = JSON.parse(event.data);
                                                                var logData = parsedLogData.join('\n') + '\n';
                                                                fs.appendFileSync(filePath, logData);
                                                            }

                                                            if (typeof event.data !== 'undefined') {
                                                                sData = event.data;
                                                            }

                                                            if (typeof event.id !== 'undefined') {
                                                                lkp = event.id;
                                                            }
                                                        }
                                                    });
                                                }
                                            } else {
                                                fs.appendFileSync(filePath, sData);
                                            }
                                        }
                                    }
                                }
                            });

                            response.data.on('end', () => {
                                Logger.debug('Log stream response ended.', LOG_SOURCE);
                                resolve(lkp);
                            });

                            response.data.on('error', (e) => {
                                Logger.debug(`Log stream response error: ${e.message}`, LOG_SOURCE);
                                this.stopLogging();
                                reject(e);
                            });
                        }
                    });
                } else {
                    Logger.debug(`Unexpected log stream content type received: ${contentType}.`, LOG_SOURCE);
                    throw new Error(`Unexpected Content-Type ${contentType} was returned by the server.`);
                }
            }
        } catch (error) {
            Logger.debug(`Log streaming failed: ${error && error.message ? error.message : error}`, LOG_SOURCE);
            if (error instanceof MaximoError) {
                throw error.message;
            }

            var internalError = await new Promise((resolve, reject) => {
                let completeData = '';
                if (typeof error !== 'undefined' && typeof error.response !== 'undefined') {
                    error.response.data.on('data', (data) => {
                        if (!this._isLogging) {
                            resolve();
                        } else {
                            completeData += data;
                        }
                    });

                    error.response.data.on('end', () => {
                        if (completeData) {
                            try {
                                resolve(JSON.parse(completeData));
                            } catch (error) {
                                resolve();
                            }
                        } else {
                            resolve();
                        }
                    });

                    error.response.data.on('error', () => {
                        Logger.debug('Error occurred while reading failed log stream response.', LOG_SOURCE);
                        this.stopLogging();
                        reject();
                    });
                } else {
                    this.stopLogging();
                    resolve();
                }
            });
            if (typeof internalError !== 'undefined' || typeof error !== 'undefined') {
                if (internalError) {
                    throw internalError;
                } else {
                    throw error;
                }
            }
        }
    }

    async stopLogging() {
        Logger.debug('Stopping log streaming session.', LOG_SOURCE);
        this._isLogging = false;
        this.disconnect();
    }

    async getAllScriptNames() {
        const headers = new Map();
        headers['Content-Type'] = 'application/json';

        let options = {
            url: `os/${this.scriptEndpoint}?oslc.select=autoscript,description&oslc.pageSize=10`,
            method: MaximoClient.Method.GET,
            headers: { common: headers }
        };

        var scriptNames = [];
        let hasMorePages = true;

        while (hasMorePages) {
            // @ts-ignore
            let response = await this.client.request(options);
            if (response.data.member.length !== 0) {
                response.data.member.forEach((member) => {
                    if (!member.autoscript.startsWith('NAVIAM.AUTOSCRIPT')) {
                        scriptNames.push({ label: member.autoscript.toLowerCase(), description: member.autoscript.description });
                    }
                });
            }
            hasMorePages = typeof response.data.responseInfo.nextPage !== 'undefined';

            if (hasMorePages) {
                let pageNumber = response.data.responseInfo.pagenum + 1;
                options.url = `os/${this.scriptEndpoint}?oslc.select=autoscript,description&oslc.pageSize=10&pageno=${pageNumber}`;
            }
        }

        return scriptNames;
    }

    async getAllScreenNames() {
        const headers = new Map();
        headers['Content-Type'] = 'application/json';

        let options = {
            url: 'script/naviam.autoscript.screens',
            method: MaximoClient.Method.GET,
            headers: { common: headers }
        };
        // @ts-ignore
        let response = await this.client.request(options);

        if (response.data.status === 'success') {
            return response.data.screenNames;
        } else {
            throw new Error(response.data.message);
        }
    }

    async getDebugVersion() {
        Logger.debug('Requesting installed debug driver version information.', LOG_SOURCE);
        const headers = new Map();
        headers['Content-Type'] = 'application/json';

        let options = {
            url: 'script/naviam.autoscript.debug',
            method: MaximoClient.Method.GET,
            headers: { common: headers }
        };
        // @ts-ignore
        let response = await this.client.request(options);

        if (response.data.status === 'success') {
            return response.data;
        } else {
            throw new Error(response.data.message);
        }
    }

    async loadDebugDriver() {
        Logger.debug('Requesting debug driver activation in the current JVM.', LOG_SOURCE);
        const headers = new Map();
        headers['Content-Type'] = 'application/json';

        let options = {
            url: 'script/naviam.autoscript.debug',
            method: MaximoClient.Method.POST,
            headers: { common: headers },
            data: { activateOnly: true }
        };

        // @ts-ignore
        let response = await this.client.request(options);

        if (response.data.status === 'success') {
            return response.data;
        } else {
            throw new Error(response.data.message);
        }
    }

    async unloadDebugDriver() {
        Logger.debug('Requesting debug driver deactivation in the current JVM.', LOG_SOURCE);
        const headers = new Map();
        headers['Content-Type'] = 'application/json';

        let options = {
            url: 'script/naviam.autoscript.debug',
            method: MaximoClient.Method.POST,
            headers: { common: headers },
            data: { deactivate: true }
        };

        // @ts-ignore
        let response = await this.client.request(options);

        if (response.data.status === 'success') {
            return response.data;
        } else {
            throw new Error(response.data.message);
        }
    }

    async installDebugDriver(jarBase64) {
        Logger.debug(`Uploading debug driver jar (${jarBase64.length} base64 chars).`, LOG_SOURCE);
        const headers = new Map();
        headers['Content-Type'] = 'application/json';

        let options = {
            url: 'script/naviam.autoscript.debug',
            method: MaximoClient.Method.POST,
            headers: { common: headers },
            data: { jar: jarBase64 }
        };

        // @ts-ignore
        let response = await this.client.request(options);

        if (response.data.status === 'success') {
            return response.data;
        } else {
            throw new Error(response.data.message);
        }
    }

    async getFormNames() {
        const headers = new Map();
        headers['Content-Type'] = 'application/json';

        let options = {
            url: 'script/naviam.autoscript.form',
            method: MaximoClient.Method.GET,
            headers: { common: headers }
        };
        // @ts-ignore
        let response = await this.client.request(options);

        if (response.data.status === 'success') {
            return response.data.inspectionForms;
        } else {
            throw new Error(response.data.message);
        }
    }

    async getReportNames() {
        const headers = new Map();
        headers['Content-Type'] = 'application/json';

        let options = {
            url: 'script/naviam.autoscript.report',
            method: MaximoClient.Method.GET,
            headers: { common: headers }
        };
        // @ts-ignore
        let response = await this.client.request(options);

        if (response.data.status === 'success') {
            return response.data.reports;
        } else {
            throw new Error(response.data.message);
        }
    }

    async getReport(reportId) {
        const headers = new Map();
        headers['Content-Type'] = 'application/json';

        let options = {
            url: `script/naviam.autoscript.report/${reportId}`,
            method: MaximoClient.Method.GET,
            headers: { common: headers }
        };

        // @ts-ignore
        let response = await this.client.request(options);

        if (response.data.status === 'success') {
            return response.data.report;
        } else {
            throw new Error(response.data.message);
        }
    }

    async getObjectList(objectType) {
        const headers = {};
        headers['Content-Type'] = 'application/json';

        let options = {
            url: 'script/naviam.autoscript.objects',
            method: MaximoClient.Method.GET,
            params: { type: objectType, action: 'list' },
            headers: { common: headers }
        };

        // @ts-ignore
        let response = await this.client.request(options);

        if (response.data.status === 'success') {
            return response.data.data;
        } else {
            throw new Error(response.data.message);
        }
    }

    async getDBCObjectList(objectType) {
        const headers = {};
        headers['Content-Type'] = 'application/json';

        let options = {
            url: 'script/naviam.autoscript.dbc',
            method: MaximoClient.Method.GET,
            params: { source: objectType, action: 'list' },
            headers: { common: headers }
        };

        // @ts-ignore
        let response = await this.client.request(options);

        if (response.data.status === 'success') {
            return response.data.data;
        } else {
            throw new Error(response.data.message);
        }
    }

    async getDBCAttributeList(objectName) {
        const headers = {};
        headers['Content-Type'] = 'application/json';

        let options = {
            url: 'script/naviam.autoscript.dbc',
            method: MaximoClient.Method.GET,
            params: { source: 'attribute', action: 'list', objectname: objectName },
            headers: { common: headers }
        };

        // @ts-ignore
        let response = await this.client.request(options);

        if (response.data.status === 'success') {
            return response.data.data;
        } else {
            throw new Error(response.data.message);
        }
    }

    async getDBCObject(objectType, name, fileName, where, description) {
        var payload = {
            name: name,
            filename: fileName
        };

        if (where) {
            payload.where = where;
        }

        if (description) {
            payload.description = description;
        }

        if (objectType === 'msg' || objectType === 'attribute') {
            payload.ids = where;
        }

        const headers = {};
        headers['Content-Type'] = 'application/json';

        let options = {
            url: 'script/naviam.autoscript.dbc',
            method: MaximoClient.Method.GET,
            params: { source: objectType, action: 'dbc' },
            headers: { common: headers },
            data: payload
        };

        // @ts-ignore
        let response = await this.client.request(options);

        if (response.data.status === 'success') {
            return response.data.data;
        } else {
            throw new Error(response.data.message);
        }
    }

    async getObjectDetail(objectType, id) {
        const headers = {};
        headers['Content-Type'] = 'application/json';

        let options = {
            url: 'script/naviam.autoscript.objects',
            method: MaximoClient.Method.GET,
            params: { type: objectType, action: 'detail', id: id },
            headers: { common: headers }
        };

        // @ts-ignore
        let response = await this.client.request(options);

        if (response.data.status === 'success') {
            return response.data.data;
        } else {
            throw new Error(response.data.message);
        }
    }

    // @ts-ignore
    // eslint-disable-next-line no-unused-vars
    async getPageData(url) {}

    // @ts-ignore
    // eslint-disable-next-line no-unused-vars
    async extractScript(script) {}

    async getScript(scriptName) {
        const headers = new Map();
        headers['Content-Type'] = 'application/json';

        let options = {
            url: `script/naviam.autoscript.extract/${scriptName}`,
            method: MaximoClient.Method.GET,
            headers: { common: headers }
        };

        // @ts-ignore
        let response = await this.client.request(options);

        if (response.data.status === 'success') {
            return response.data;
        } else {
            throw new Error(response.data.message);
        }
    }

    async getScreen(screenName) {
        const headers = new Map();
        headers['Content-Type'] = 'application/json';

        let options = {
            url: `script/naviam.autoscript.screens/${screenName}`,
            method: MaximoClient.Method.GET,
            headers: { common: headers }
        };

        // @ts-ignore
        let response = await this.client.request(options);

        if (response.data.status === 'success') {
            return response.data;
        } else {
            throw new Error(response.data.message);
        }
    }

    async getForm(formId) {
        const headers = new Map();
        headers['Content-Type'] = 'application/json';

        let options = {
            url: `script/naviam.autoscript.form/${formId}`,
            method: MaximoClient.Method.GET,
            headers: { common: headers }
        };

        // @ts-ignore
        let response = await this.client.request(options);

        if (response.data.status === 'success') {
            return response.data.form;
        } else {
            throw new Error(response.data.message);
        }
    }

    async _initLogStreamSecurity() {
        let headers = new Map();
        headers['Content-Type'] = 'application/json';

        let options = {
            url: 'script/naviam.autoscript.logging?initialize=true',
            method: MaximoClient.Method.GET,
            headers: { common: headers }
        };

        // @ts-ignore
        let response = await this.client.request(options);
        return response.data.status == true;
    }

    async _fixInspectionFormData() {
        let headers = new Map();
        headers['Content-Type'] = 'application/json';

        let options = {
            url: 'script/naviam.autoscript.form?fix=true',
            method: MaximoClient.Method.POST,
            headers: { common: headers }
        };

        // @ts-ignore
        let response = await this.client.request(options);
        return response.data.status == true;
    }

    async _installOrUpdateScript(script, description, source, progress, increment) {
        Logger.debug(`Checking for existing script ${script}.`, LOG_SOURCE);
        let scriptURI = await this._getScriptURI(script);

        let activeStatus = await this._synonymdomainToExternalDefaultValue('AUTOSCRPHASE', 'Production', 'Active');

        let headers = new Map();
        headers['Content-Type'] = 'application/json';

        if (this._csrfToken) {
            headers['csrftoken'] = this._csrfToken;
        }

        // update if a script uri was found.
        if (scriptURI) {
            Logger.debug(`Updating existing script ${script} (version=${this.currentScriptVersion}).`, LOG_SOURCE);
            let deployScript = {
                description: description,
                status: activeStatus,
                version: this.currentScriptVersion,
                scriptlanguage: 'javascript',
                source: source
            };

            headers['x-method-override'] = 'PATCH';

            let options = {
                url: scriptURI,
                method: MaximoClient.Method.POST,
                headers: { common: headers },
                data: deployScript
            };

            // @ts-ignore
            await this.client.request(options);

            Logger.debug(`Script ${script} updated successfully.`, LOG_SOURCE);
            progress.report({
                increment: increment,
                message: `Updated ${script}.`
            });
            await new Promise((resolve) => setTimeout(resolve, 500));
        } else {
            Logger.debug(`Installing new script ${script} (version=${this.currentScriptVersion}).`, LOG_SOURCE);
            const deployScript = {
                autoscript: script,
                description: description,
                status: activeStatus,
                version: this.currentScriptVersion,
                scriptlanguage: 'javascript',
                source: source
            };

            const options = {
                url: `os/${this.scriptEndpoint}`,
                method: MaximoClient.Method.POST,
                headers: { common: headers },
                data: deployScript
            };

            // @ts-ignore
            await this.client.request(options);
            Logger.debug(`Script ${script} installed successfully.`, LOG_SOURCE);
            progress.report({
                increment: increment,
                message: `Installed ${script}.`
            });
            await new Promise((resolve) => setTimeout(resolve, 500));
        }
    }

    async _getScriptURI(script) {
        const headers = new Map();
        headers['Content-Type'] = 'application/json';

        let options = {
            url: `os/${this.scriptEndpoint}?oslc.select=autoscript&oslc.where=autoscript="${script}"`,
            method: MaximoClient.Method.GET,
            headers: { common: headers }
        };

        // @ts-ignore
        let response = await this.client.request(options);
        if (response.data.member.length !== 0) {
            Logger.debug(`Script ${script} exists at ${response.data.member[0].href}.`, LOG_SOURCE);
            return response.data.member[0].href;
        } else {
            Logger.debug(`Script ${script} does not exist, will be created.`, LOG_SOURCE);
            return null;
        }
    }

    async _synonymdomainToExternalDefaultValue(domain, maxvalue, defaultValue) {
        if (!this._isConnected) {
            throw new MaximoError('Maximo client is not connected.');
        }

        const headers = new Map();
        headers['Content-Type'] = 'application/json';

        let options = {
            url: `os/MXAPIDOMAIN?oslc.select=*&oslc.where=domainid="${domain}"`,
            method: MaximoClient.Method.GET,
            headers: { common: headers }
        };

        // @ts-ignore
        let response = await this.client.request(options);
        for (var i = 0; i < response.data.member[0].synonymdomain.length; i++) {
            if (response.data.member[0].synonymdomain[i].maxvalue === maxvalue && response.data.member[0].synonymdomain[i].defaults === true) {
                return response.data.member[0].synonymdomain[i].value;
            }
        }
        return defaultValue;
    }

    async _bootstrap(progress, increment) {
        if (!this._isConnected) {
            throw new MaximoError('Maximo client is not connected.');
        }

        Logger.debug('Starting bootstrap install script deployment.', LOG_SOURCE);

        let refUri;

        let activeStatus = await this._synonymdomainToExternalDefaultValue('AUTOSCRPHASE', 'Production', 'Active');
        try {
            const headers = new Map();
            headers['Content-Type'] = 'application/json';

            if (this._csrfToken) {
                headers['csrftoken'] = this._csrfToken;
            }

            // eslint-disable-next-line no-undef
            let source = fs.readFileSync(path.resolve(__dirname, '../resources/naviam.autoscript.install.js')).toString();

            let options = {
                url: `os/${this.scriptEndpoint}?oslc.select=autoscript&oslc.where=autoscript="NAVIAM.AUTOSCRIPT.INSTALL"`,
                method: MaximoClient.Method.GET,
                headers: { common: headers }
            };

            // @ts-ignore
            let response = await this.client.request(options);
            let href;
            if (response.data.member.length === 1) {
                href = response.data.member[0].href;
            }

            Logger.debug(`Bootstrap install script ${href ? `found at ${href}, will update` : 'not found, will create fresh'}.`, LOG_SOURCE);
            progress.report({ increment: increment });

            if (href) {
                let deployScript = {
                    description: 'Naviam AutoScript Deploy Bootstrap',
                    status: activeStatus,
                    version: this.currentScriptVersion,
                    scriptlanguage: 'javascript',
                    source: source
                };
                headers['x-method-override'] = 'PATCH';
                options = {
                    url: href,
                    method: MaximoClient.Method.POST,
                    headers: { common: headers },
                    data: deployScript
                };
            } else {
                let deployScript = {
                    autoscript: 'naviam.autoscript.install',
                    description: 'Naviam AutoScript Deploy Bootstrap',
                    status: activeStatus,
                    version: '1.0.0',
                    scriptlanguage: 'javascript',
                    source: source
                };
                options = {
                    url: `os/${this.scriptEndpoint}`,
                    method: MaximoClient.Method.POST,
                    headers: { common: headers },
                    data: deployScript
                };
            }

            // @ts-ignore
            response = await this.client.request(options);
            refUri = response.headers.location;

            Logger.debug(`Bootstrap script ${href ? 'updated' : 'created'} (refUri=${refUri || href}).`, LOG_SOURCE);
            progress.report({ increment: increment });

            if (href && !refUri) {
                refUri = href;
            }

            options = {
                url: 'script/naviam.autoscript.install',
                method: MaximoClient.Method.POST,
                headers: { common: headers }
            };

            Logger.debug('Executing bootstrap install script on Maximo.', LOG_SOURCE);
            // @ts-ignore
            var result = await this.client.request(options);
            Logger.debug(`Bootstrap install script result: status=${result?.data?.status || 'unknown'}.`, LOG_SOURCE);
            return result.data;
        } finally {
            if (refUri) {
                Logger.debug(`Cleaning up temporary bootstrap script at ${refUri}.`, LOG_SOURCE);
                const headers = new Map();
                headers['Content-Type'] = 'application/json';
                if (this._csrfToken) {
                    headers['csrftoken'] = this._csrfToken;
                }
                let options = {
                    url: refUri,
                    headers: { common: headers },
                    method: MaximoClient.Method.DELETE
                };

                // @ts-ignore
                await this.client.request(options);
                Logger.debug('Bootstrap script cleanup complete.', LOG_SOURCE);
            }
        }
    }

    async _processError(error) {
        if (error && error.response && error.response.data) {
            const data = error.response.data;
            const requestSummary = this._getRequestSummary(error.response.config || error.config);

            // if this is a Maximo error then handle it.
            if (data.Error) {
                let message = data.Error.message;
                let reasonCode = data.Error.reasonCode;
                let statusCode = data.Error.statusCode;

                Logger.debug(`Processing Maximo error for ${requestSummary}: status=${statusCode}, reasonCode=${reasonCode || 'unknown'}`, LOG_SOURCE);

                if (statusCode == 401 && (reasonCode === 'BMXAA7901E' || reasonCode === 'BMXAA0021E')) {
                    // if there is a username and password, but no api key then try to reauthenticate
                    if (
                        this.config.username &&
                        this.config.password &&
                        this.config.apiKey == null &&
                        (error.config.__retryCount == 0 || typeof error.config.__retryCount === 'undefined')
                    ) {
                        try {
                            Logger.debug(`Attempting reauthentication for ${requestSummary}.`, LOG_SOURCE);
                            error.config.__retryCount += 1;
                            await this.connect();
                            return Promise.resolve(this.client(error.config));
                        } catch (err) {
                            Logger.debug(`Reauthentication failed for ${requestSummary}.`, LOG_SOURCE);
                            return Promise.reject(new LoginFailedError(message, reasonCode, statusCode));
                        }
                    }

                    // BMXAA7901E - You cannot log in at this time. Contact the system administrator.
                    return Promise.reject(new LoginFailedError(message, reasonCode, statusCode));
                } else if (reasonCode === 'BMXAA2283E') {
                    // BMXAA2283E - Your password has expired.
                    return Promise.reject(new PasswordExpiredError(message, reasonCode, statusCode));
                } else if (reasonCode === 'BMXAA7902E') {
                    // BMXAA7902E - You cannot reset your password at this time. Contact the system administrator.
                    return Promise.reject(new PasswordResetFailedError(message, reasonCode, statusCode));
                } else if (reasonCode === 'BMXAA0024E' || reasonCode === 'BMXAA9051E') {
                    // BMXAA0024E - The action {0} is not allowed on object {1}}. Verify the business rules for the object and define the appropriate action for the object.
                    // BMXAA9051E - You are not authorized to view the management metrics that are identified by the URI path element {0}.
                    return Promise.reject(new MxAccessError(message, reasonCode, statusCode));
                } else if (statusCode == 404 && reasonCode === 'BMXAA8727E') {
                    // BMXAA8727E - The OSLC resource {0}} with the ID {1} was not found as it does not exist in the system. In the database, verify whether the resource for the ID exists.
                    return Promise.reject(new ResourceNotFoundError(message, reasonCode, statusCode));
                } else if (reasonCode === 'BMXAA9549E') {
                    // BMXAA9549E - The API key token is invalid. Either the token may have expired or the token has been revoked by the administrator.
                    return Promise.reject(new InvalidApiKeyError(message, reasonCode, statusCode));
                } else if (reasonCode === 'BMXAA5646I' || (message != null && message.includes('BMXAA5646I'))) {
                    // BMXAA5646I - You have been logged out by the system administrator.
                    // This sometimes returns with a null reason code, but the reason code is present in the message.
                    return Promise.reject(new MxAdminLogoutError(message, reasonCode, statusCode));
                } else if (statusCode == 409 && reasonCode === 'BMXAA9524E') {
                    // BMXAA9524E - The transaction ID {0} already exists in the OSLC transaction table with resource ID...
                    // TOOD Implement transaction ID handling.
                    return Promise.reject(new MxDuplicateTransactionError(message, reasonCode, statusCode, error.response.config.url, -1));
                } else {
                    // Return the generic Maximo error
                    return Promise.reject(new MaximoError(message, reasonCode, statusCode));
                }
            } else {
                // If the error is not a Maximo error just pass on the error.
                Logger.debug(`Passing through non-Maximo response error for ${requestSummary}.`, LOG_SOURCE);
                return Promise.reject(error);
            }
        } else {
            // If the error is not a Maximo error just pass on the error.
            Logger.debug(
                `Passing through transport error${error && error.code ? ` ${error.code}` : ''}: ${error && error.message ? error.message : error}`,
                LOG_SOURCE
            );
            return Promise.reject(error);
        }
    }

    static get Method() {
        return {
            GET: 'GET',
            POST: 'POST',
            DELETE: 'DELETE',
            PUT: 'PUT'
        };
    }
}
