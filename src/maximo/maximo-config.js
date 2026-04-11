// @ts-nocheck
import { Buffer } from 'buffer';

export default class MaximoConfig {
    constructor({
        username,
        password,
        host,
        port = 443,
        useSSL = true,
        context = 'maximo',
        allowUntrustedCerts = false,
        configurationTimeout = 5000 * 60000, // 5 minutes
        connectTimeout = 5000,
        responseTimeout = 30000,
        lean = true,
        ca,
        maxauthOnly = false,
        apiKey,
        extractLocation,
        extractLocationScreens,
        extractLocationForms,
        extractLocationReports,
        extractLocationDBC,
        proxyHost,
        proxyPort = 3128,
        proxyUsername,
        proxyPassword,
        debugPort = 4711
    }) {
        this.username = username;
        this.password = password;
        this.host = host;
        this.port = port;
        this.useSSL = useSSL;
        this.configurationTimeout = configurationTimeout;
        this.context = context;
        this.allowUntrustedCerts = allowUntrustedCerts;
        this.connectTimeout = connectTimeout;
        this.responseTimeout = responseTimeout;
        this.lean = lean;
        this.ca = ca;
        this.maxauthOnly = maxauthOnly;
        this.apiKey = apiKey;
        this.extractLocation = extractLocation;
        this.extractLocationScreens = extractLocationScreens;
        this.extractLocationForms = extractLocationForms;
        this.extractLocationReports = extractLocationReports;
        this.extractLocationDBC = extractLocationDBC;
        this.proxyHost = proxyHost;
        this.proxyPort = proxyPort;
        this.proxyUsername = proxyUsername;
        this.proxyPassword = proxyPassword;
        this.debugPort = debugPort;
    }

    get maxauth() {
        return Buffer.from(this.username + ':' + this.password).toString('base64');
    }

    get baseURL() {
        return (
            (this.useSSL ? 'https://' : 'http://') +
            this.host +
            ((this.port === 443 && this.useSSL) || (this.port === 80 && !this.useSSL) ? '' : ':' + this.port) +
            '/' +
            this.context +
            (this.apiKey ? '/api' : '/oslc')
        );
    }

    get baseProxyURL() {
        if (!this.proxyHost) {
            return null;
        } else {
            return (this.useSSL ? 'https://' : 'http://') + this.proxyHost + ':' + this.proxyPort + '/' + this.context + (this.apiKey ? '/api' : '/oslc');
        }
    }

    get formLoginURL() {
        return (
            (this.useSSL ? 'https://' : 'http://') +
            this.host +
            ((this.port === 443 && this.useSSL) || (this.port === 80 && !this.useSSL) ? '' : ':' + this.port) +
            '/' +
            this.context +
            '/j_security_check'
        );
    }

    get proxyConfigured() {
        return this.proxyHost && this.proxyPort && this.proxyPort > 0 && this.proxyPort < 65536;
    }
}
