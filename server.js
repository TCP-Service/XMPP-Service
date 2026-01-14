import logging from './utilities/log.js';

import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const cfgDir = path.join(__dirname, 'cfg');

const files = ['xmpp_config_template.js', 'rest_config_template.js'];

for (const file of files) {
    const oldPath = path.join(cfgDir, file);
    const newPath = path.join(cfgDir, file.replace('_template', ''));
    if (fs.existsSync(oldPath) && !fs.existsSync(newPath)) {
        fs.copyFileSync(oldPath, newPath);
        logging.config(`Created ${path.basename(newPath)}`);
    }
}

const tcpServer = await import(pathToFileURL(path.join(__dirname, 'tcp/index.js')).href);
const rest_config = await import(pathToFileURL(path.join(cfgDir, 'rest_config.js')).href);

import express from 'express';
import https from 'https';
import registerRoutes from './utilities/routes.js';

const nodeVersion = process.version;
const majorVersion = Number(nodeVersion.replace(/[a-z]/gi, '').split('.')[0]);

process.on('unhandledRejection', (reason, promise) => {
    logging.error('Unhandled Rejection at promise:', promise);
    logging.error('Reason:', reason);
});

process.on('uncaughtException', (err) => {
    tcpServer.default.server.shutdown();
    logging.error(`Uncaught exception! | ${err.stack}`);
    process.exit(1);
});

const REST_PORT = rest_config.default.host.port;
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
    res.send('online');
});

await registerRoutes(app);

let httpsServer;
try {
    const options = {
        key: fs.readFileSync(path.join(__dirname, rest_config.default.certs.key)),
        cert: fs.readFileSync(path.join(__dirname, rest_config.default.certs.cert))
    };

    httpsServer = https.createServer(options, app);

    httpsServer.listen(REST_PORT, () => {
        logging.rest(`REST API listening on port ${REST_PORT}`);
    });
} catch (err) {
    httpsServer = app.listen(REST_PORT, () => {
        logging.rest(`REST API listening on port ${REST_PORT}`);
    });
}

tcpServer.default.server.start();

if (majorVersion > 16) {
    // I've changed this so it's easier for ppl to understand and download the right version
    // and I made it just check the major version (even tho 17 and 18 might still work)
    logging.warn(
        "TLS 1.0 is required for XMPP to function on older seasons (1-3). We recommend using " +
        "\x1b]8;;https://nodejs.org/dist/v16.20.2/node-v16.20.2-x64.msi\x1b\\Node.js v16 or lower.\x1b]8;;\x1b\\"
    );
}
