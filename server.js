import tcpServer from './tcp/index.js';
import rest_config from './cfg/rest_config.js';
import logging from './utilities/log.js';

import express from 'express';
import https from 'https';
import fs from 'fs';
import path from 'path';
import registerRoutes from './utilities/routes.js';
import { fileURLToPath } from 'url';

const nodeVersion = process.version;
const majorVersion = Number(nodeVersion.replace(/[a-z]/gi, '').split('.')[0]);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

process.on('unhandledRejection', (reason, promise) => {
    logging.error('Unhandled Rejection at promise:', promise);
    logging.error('Reason:', reason);
});

process.on('uncaughtException', (err) => {
    logging.error(`Uncaught exception! | ${err.stack}`);
    process.exit(1);
});

const REST_PORT = rest_config.host.port;
const app = express();

const options = {
    key: fs.readFileSync(path.join(__dirname, rest_config.certs.key)),
    cert: fs.readFileSync(path.join(__dirname, rest_config.certs.cert))
};

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
    res.send('online');
});

registerRoutes(app).then(() => {
    const httpsServer = https.createServer(options, app);

    httpsServer.listen(REST_PORT, () => {
        logging.rest(`REST API listening on port ${REST_PORT}`);
    });

    tcpServer.server.start();

    // I've changed this so it's easier for ppl to understand and download the right version
    // and I made it just check the major version (even tho 17 and 18 might still work)

    if (majorVersion > 16) {
        logging.warn(
            "TLS 1.0 is required for XMPP to function on older seasons (1-3). We recommend using " +
            "\x1b]8;;https://nodejs.org/dist/v16.20.2/node-v16.20.2-x64.msi\x1b\\Node.js v16 or lower.\x1b]8;;\x1b\\"
        );
    }
});
