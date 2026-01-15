import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import logging from './log.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default async function registerRoutes(app) {
    const restDir = path.join(__dirname, '../rest');

    if (!fs.existsSync(restDir)) {
        logging.warn('REST directory not found');
        return;
    }

    const files = fs.readdirSync(restDir);

    for (const file of files) {
        if (!file.endsWith('.js')) continue;

        const filePath = path.join(restDir, file);
        const fileUrl = pathToFileURL(filePath).href;

        try {
            const module = await import(fileUrl);
            if (typeof module.default === 'function') {
                module.default(app);
            }
        } catch (err) {
            logging.error(`Failed to load REST module ${file}:`, err);
        }
    }
}