// @ts-nocheck
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Buffer } from 'node:buffer';
import Logger from './logger';
import * as crypto from 'crypto';

export default class LocalConfiguration {
    /**
     * @param {String} path
     * @param {SecretStorage} secretStorage
     */
    constructor(path, secretStorage) {
        this.path = path;
        this.secretStorage = secretStorage;
        this.algorithm = 'aes-256-cbc';
    }

    get configAvailable() {
        return fs.existsSync(this.path);
    }

    get config() {
        if (!this.configAvailable) {
            return {};
        } else {
            return this.decrypt(JSON.parse(fs.readFileSync(this.path, 'utf8')));
        }
    }

    async encryptIfRequired() {
        await this.encrypt(JSON.parse(fs.readFileSync(this.path, 'utf8')));
        let gitIgnorePath = path.dirname(this.path) + path.sep + '.gitignore';
        if (fs.existsSync(gitIgnorePath)) {
            fs.readFile(gitIgnorePath, function (err, data) {
                if (err) throw err;
                if (data.indexOf('.devtools-config.json') < 0) {
                    fs.appendFile(gitIgnorePath, '\n.devtools-config.json', function (err) {
                        if (err) throw err;
                    });
                }
            });
        } else {
            fs.writeFileSync(gitIgnorePath, '.devtools-config.json');
        }
    }

    async encrypt(config) {
        const result = await this._encryptAll(config);

        // Only rewrite the file when something was actually encrypted, otherwise the file watcher
        // that calls encryptIfRequired() on change would retrigger itself in an infinite loop.
        if (result.changed) {
            fs.writeFileSync(this.path, JSON.stringify(result.config, null, 4));
        }
    }

    /**
     * Encrypts any plain text secrets and writes the configuration, whether or not anything was
     * encrypted, for changes such as the selected environment that carry no secret.
     */
    async save(config) {
        const result = await this._encryptAll(config);
        fs.writeFileSync(this.path, JSON.stringify(result.config, null, 4));
    }

    async _encryptAll(config) {
        if (Array.isArray(config)) {
            const results = await Promise.all(config.map((item) => this._encrypt(item)));
            return { config: results.map((result) => result.config), changed: results.some((result) => result.changed) };
        }
        return this._encrypt(config);
    }

    async _encrypt(config) {
        let encryptKey = await this.secretStorage.get('encryptKey');
        let changed = false;

        if (!encryptKey) {
            encryptKey = new Buffer.from(crypto.randomBytes(16)).toString('hex') + new Buffer.from(crypto.randomBytes(32)).toString('hex');
            await this.secretStorage.store('encryptKey', encryptKey);
        }

        const iv = Buffer.from(encryptKey.slice(0, 32), 'hex');
        const key = Buffer.from(encryptKey.slice(32), 'hex');

        if (config.password && !config.password.startsWith('{encrypted}')) {
            const cipher = crypto.createCipheriv(this.algorithm, key, iv);
            let encPassword = cipher.update(config.password, 'utf-8', 'hex');
            encPassword += cipher.final('hex');

            config.password = '{encrypted}' + encPassword;
            changed = true;
        }
        if (config.apiKey && !config.apiKey.startsWith('{encrypted}')) {
            const cipher = crypto.createCipheriv(this.algorithm, key, iv);
            let encApiKey = cipher.update(config.apiKey, 'utf-8', 'hex');
            encApiKey += cipher.final('hex');

            config.apiKey = '{encrypted}' + encApiKey;
            changed = true;
        }

        if (config.proxyPassword && !config.proxyPassword.startsWith('{encrypted}')) {
            const cipher = crypto.createCipheriv(this.algorithm, key, iv);
            let encProxyPassword = cipher.update(config.proxyPassword, 'utf-8', 'hex');
            encProxyPassword += cipher.final('hex');

            config.proxyPassword = '{encrypted}' + encProxyPassword;
            changed = true;
        }
        return { config, changed };
    }

    async decrypt(config) {
        if (Array.isArray(config)) {
            return await Promise.all(
                config.map(async (item) => {
                    return await this._decrypt(item);
                })
            );
        } else {
            return await this._decrypt(config);
        }
    }

    async _decrypt(config) {
        let encryptKey = await this.secretStorage.get('encryptKey');

        if (!encryptKey) {
            return config;
        }

        const iv = Buffer.from(encryptKey.slice(0, 32), 'hex');
        const key = Buffer.from(encryptKey.slice(32), 'hex');
        try {
            if (config.password && config.password.startsWith('{encrypted}')) {
                const decipher = crypto.createDecipheriv(this.algorithm, key, iv);
                let decryptedPassword = decipher.update(config.password.substring(11), 'hex', 'utf-8');
                decryptedPassword += decipher.final('utf8');
                config.password = decryptedPassword;
            }

            if (config.apiKey && config.apiKey.startsWith('{encrypted}')) {
                const decipher = crypto.createDecipheriv(this.algorithm, key, iv);
                let decryptedApiKey = decipher.update(config.apiKey.substring(11), 'hex', 'utf-8');
                decryptedApiKey += decipher.final('utf8');
                config.apiKey = decryptedApiKey;
            }

            if (config.proxyPassword && config.proxyPassword.startsWith('{encrypted}')) {
                const decipher = crypto.createDecipheriv(this.algorithm, key, iv);
                let decryptedProxyPassword = decipher.update(config.proxyPassword.substring(11), 'hex', 'utf-8');
                decryptedProxyPassword += decipher.final('utf8');
                config.proxyPassword = decryptedProxyPassword;
            }
        } catch (error) {
            if (error.code === 'ERR_OSSL_BAD_DECRYPT') {
                Logger.warn(
                    'Unable to decrypt configuration. This may be due to an encryption key change. Please re-enter your sensitive information in the configuration and save it to encrypt with the new key.'
                );
                vscode.window.showWarningMessage(
                    'Unable to decrypt configuration. Did you copy the configuration from another machine? Encryption keys are unique to each machine, you will need to re-add password, apiKey and proxyPassword values.',
                    { modal: true }
                );
            }
        }

        return config;
    }
}
