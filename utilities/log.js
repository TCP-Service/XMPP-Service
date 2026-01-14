class Logging {
    rest(message) {
        console.log(`\x1b[32m[REST]\x1b[0m ${message}`);
    }

    xmpp(message) {
        console.log(`\x1b[35m[XMPP]\x1b[0m ${message}`);
    }

    error(message) {
        console.log(`\x1b[31m[ERROR]\x1b[0m ${message}`);
    }

    warn(message) {
        console.log(`\x1b[33m[WARN]\x1b[0m ${message}`);
    }

    debug(message) {
        console.log(`\x1b[34m[DEBUG]\x1b[0m ${message}`);
    }

    config(message) {
        console.log(`\x1b[90m[CONFIG]\x1b[0m ${message}`);
    }
}

export default new Logging();
