// @ts-nocheck
import * as vscode from 'vscode';

export default class Logger {
    static _channel = null;

    /**
     * Call this in your extension's activate() function
     * @param {string} extensionName
     */
    static configure(extensionName) {
        if (!this._channel) {
            // Setting { log: true } enables the native timestamp and log levels
            this._channel = vscode.window.createOutputChannel(extensionName, { log: true });
        }
        return this._channel;
    }

    /**
     * Helper to get a custom timestamp if you don't like the native one
     */
    static _getTimestamp() {
        return new Date().toISOString();
    }

    static info(message, source = '') {
        const prefix = source ? `[${source}] ` : '';
        this._channel?.info(`${prefix}${message}`);
    }

    static error(message, error, source = '') {
        const prefix = source ? `[${source}] ` : '';
        // If an error object is passed, log its stack trace
        const detail = error?.stack ? `\n${error.stack}` : error;
        this._channel?.error(`${prefix}${message} ${detail}`);
    }

    static debug(message, source = '') {
        const prefix = source ? `[${source}] ` : '';
        this._channel?.debug(`${prefix}${message}`);
    }

    static get channel() {
        return this._channel;
    }
}
