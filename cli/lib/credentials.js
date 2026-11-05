import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

const ALGORITHM = 'aes-256-cbc';
const PREFIX = '{encrypted}';
const DEFAULT_KEY_FILE = '.settings.json.key';

/**
 * The key file: the configured path, with ~ for the home directory and a relative path relative to
 * the settings file's directory, or .settings.json.key beside the settings file.
 */
export function resolveKeyFile(settingsFile, key) {
    const settingsDir = path.dirname(path.resolve(settingsFile));
    if (!key) {
        return path.join(settingsDir, DEFAULT_KEY_FILE);
    }
    if (key === '~' || key.startsWith('~/') || key.startsWith('~\\')) {
        return path.join(os.homedir(), key.slice(1));
    }
    return path.resolve(settingsDir, key);
}

function isEncrypted(value) {
    return typeof value === 'string' && value.startsWith(PREFIX);
}

/**
 * Throws when the settings file has nothing left to encrypt.
 */
export function checkEncryptable(settingsFile) {
    const settings = readSettings(settingsFile);
    const { password, apikey } = settings;

    if (!password && !apikey) {
        throw new Error(`Neither an apikey nor a password is specified in the settings file ${settingsFile}. There is no value to encrypt.`);
    }
    if ((!password || isEncrypted(password)) && (!apikey || isEncrypted(apikey))) {
        throw new Error(
            `The values in ${settingsFile} are already encrypted. To encrypt them again, reset the apikey or password to plain text and try again.`
        );
    }
    return settings;
}

/**
 * Encrypts the plain text password and API key in the settings file, creating the key file when it does not exist.
 *
 * @returns {string} the key file used
 */
export function encryptSettingsFile(settingsFile, key) {
    const settings = checkEncryptable(settingsFile);
    const keyFile = resolveKeyFile(settingsFile, key);

    if (!fs.existsSync(keyFile)) {
        fs.mkdirSync(path.dirname(keyFile), { recursive: true });
        fs.writeFileSync(keyFile, crypto.randomBytes(16).toString('hex') + crypto.randomBytes(32).toString('hex'), { encoding: 'utf8', mode: 0o600 });
    }

    const cipherKey = readKey(keyFile);
    for (const field of ['password', 'apikey']) {
        if (settings[field] && !isEncrypted(settings[field])) {
            const cipher = crypto.createCipheriv(ALGORITHM, cipherKey.key, cipherKey.iv);
            settings[field] = PREFIX + cipher.update(settings[field], 'utf8', 'hex') + cipher.final('hex');
        }
    }

    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 4));
    return keyFile;
}

/**
 * Returns the configuration with an encrypted password and API key decrypted.
 *
 * Earlier versions ignored the key setting and always used .settings.json.key beside the settings
 * file, so that file is used, with a warning, when the configured key file does not exist.
 *
 * @param {object} config
 * @param {(message: string) => void} [warn]
 */
export function decryptCredentials(config, warn = () => {}) {
    if (!config.settingsFile || (!isEncrypted(config.password) && !isEncrypted(config.apikey))) {
        return config;
    }

    let keyFile = resolveKeyFile(config.settingsFile, config.key);
    if (!fs.existsSync(keyFile)) {
        const legacyKeyFile = resolveKeyFile(config.settingsFile);
        if (config.key && fs.existsSync(legacyKeyFile)) {
            warn(`The key file ${keyFile} does not exist, using ${legacyKeyFile}.`);
            keyFile = legacyKeyFile;
        } else {
            throw new Error(`The apikey or password cannot be decrypted because the key file ${keyFile} cannot be read.`);
        }
    }

    const cipherKey = readKey(keyFile);
    const decrypted = { ...config };
    for (const field of ['password', 'apikey']) {
        if (isEncrypted(decrypted[field])) {
            try {
                const decipher = crypto.createDecipheriv(ALGORITHM, cipherKey.key, cipherKey.iv);
                decrypted[field] = decipher.update(decrypted[field].substring(PREFIX.length), 'hex', 'utf8') + decipher.final('utf8');
            } catch {
                throw new Error(`The ${field} cannot be decrypted with the key file ${keyFile}.`);
            }
        }
    }
    return decrypted;
}

function readKey(keyFile) {
    const keyData = fs.readFileSync(keyFile, 'utf8').trim();
    return { iv: Buffer.from(keyData.slice(0, 32), 'hex'), key: Buffer.from(keyData.slice(32), 'hex') };
}

function readSettings(settingsFile) {
    try {
        return JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
    } catch (error) {
        if (error instanceof SyntaxError) {
            throw new Error(`The settings file ${settingsFile} exists, but is not a valid JSON format.`);
        }
        throw new Error(`An error occurred reading ${settingsFile}, ${error.message}`);
    }
}
