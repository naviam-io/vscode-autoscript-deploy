// @ts-nocheck
export class MaximoError extends Error {
    constructor(message, reasonCode, statusCode) {
        super();
        this.reasonCode = reasonCode;
        this.statusCode = statusCode;
        this.message = message;
    }
}

export class LoginFailedError extends MaximoError {
    constructor(message, reasonCode, statusCode) {
        super(message, reasonCode, statusCode);
    }
}

export class PasswordExpiredError extends MaximoError {
    constructor(message, reasonCode, statusCode) {
        super(message, reasonCode, statusCode);
    }
}

export class PasswordResetFailedError extends MaximoError {
    constructor(message, reasonCode, statusCode) {
        super(message, reasonCode, statusCode);
    }
}

export class MxAccessError extends MaximoError {
    constructor(message, reasonCode, statusCode) {
        super(message, reasonCode, statusCode);
    }
}

export class ResourceNotFoundError extends MaximoError {
    constructor(message, reasonCode, statusCode) {
        super(message, reasonCode, statusCode);
    }
}

export class InvalidApiKeyError extends MaximoError {
    constructor(message, reasonCode, statusCode) {
        super(message, reasonCode, statusCode);
    }
}

export class MxAdminLogoutError extends MaximoError {
    constructor(message, reasonCode, statusCode) {
        super(message, reasonCode, statusCode);
    }
}

export class MxDuplicateTransactionError extends MaximoError {
    constructor(message, reasonCode, statusCode, requestUri, transcationId) {
        super(message, reasonCode, statusCode);
        this.requestUri = requestUri;
        this.transcationId = transcationId;
    }
}
