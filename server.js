import logging from './utilities/log.js';
import { initializeConfigFiles } from './utilities/config.js';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

await initializeConfigFiles();

const tcpServer = await import(pathToFileURL(path.join(__dirname, 'tcp/index.js')).href);
const rest_config = await import(pathToFileURL(path.join(__dirname, 'cfg/rest_config.js')).href);

import express from 'express';
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

await registerRoutes(app, tcpServer.default.server);

app.listen(REST_PORT, () => {
    logging.rest(`REST API listening on port ${REST_PORT}`);
});

tcpServer.default.server.start();

if (majorVersion > 16) {
    logging.warn(
        "TLS 1.0 is required for XMPP to function on older seasons (1-3). We recommend using " +
        "\x1b]8;;https://nodejs.org/dist/v16.20.2/node-v16.20.2-x64.msi\x1b\\Node.js v16 or lower.\x1b]8;;\x1b\\"
    );
}