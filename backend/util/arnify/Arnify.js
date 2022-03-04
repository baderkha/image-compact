const { config, STS } = require('aws-sdk');

/**
 * @description Arnifier , transforms a label into an arn
 * @author Ahmad Baderkhan
 */
class Arnifier {
    static ACCOUNT_ID_KEY_ENV;
    constructor(region = 'us-east-1') {
        this.region = region;
        this.hasInit = !!process.env[Arnifier.ACCOUNT_ID_KEY_ENV];
        this.accountId = process.env[Arnifier.ACCOUNT_ID_KEY_ENV];
    }

    async _init() {
        const sts = new STS();
        // See https://docs.aws.amazon.com/sdk-for-javascript/v2/developer-guide/using-promises.html
        const { Account: account } = await sts.getCallerIdentity({}).promise();
        process.env[Arnifier.ACCOUNT_ID_KEY_ENV] = account;
        this.accountId = account;
    }
    /**
     * Generate an arn
     * @param {*} resourceLabel 
     * @param {String} service
     * @returns 
     */
    async generate(service , resourceLabel) {
        if (!this.hasInit) {
            await this._init()
        }
        return `arn:aws:${service}:${this.region}:${this.accountId}:${resourceLabel}`
    }

    service (service) {
        const boundFn =  this.generate.bind(this , service);
        return boundFn;
    }
}

module.exports = {
    Arnifier
}