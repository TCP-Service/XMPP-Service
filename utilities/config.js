import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logging from './log.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getObjectStructure(obj, prefix = '') {
    const structure = {};
    for (const key in obj) {
        const fullPath = prefix ? `${prefix}.${key}` : key;
        if (obj[key] !== null && typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
            Object.assign(structure, getObjectStructure(obj[key], fullPath));
        } else {
            structure[fullPath] = typeof obj[key];
        }
    }
    return structure;
}

function mergeConfigs(template, existing) {
    const merged = {};

    for (const key in template) {
        if (template[key] !== null && typeof template[key] === 'object' && !Array.isArray(template[key])) {
            if (existing[key] && typeof existing[key] === 'object' && !Array.isArray(existing[key])) {
                merged[key] = mergeConfigs(template[key], existing[key]);
            } else {
                merged[key] = template[key];
            }
        } else {
            merged[key] = existing.hasOwnProperty(key) ? existing[key] : template[key];
        }
    }

    return merged;
}

function configToString(obj, indent = 0) {
    const spaces = '    '.repeat(indent);
    const lines = [];

    for (const [key, value] of Object.entries(obj)) {
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
            lines.push(`${spaces}${key}: {`);
            lines.push(configToString(value, indent + 1));
            lines.push(`${spaces}},`);
        } else if (typeof value === 'string') {
            lines.push(`${spaces}${key}: '${value}',`);
        } else if (typeof value === 'boolean' || typeof value === 'number') {
            lines.push(`${spaces}${key}: ${value},`);
        } else {
            lines.push(`${spaces}${key}: ${JSON.stringify(value)},`);
        }
    }

    return lines.join('\n');
}

export async function initializeConfigFiles() {
    const templatesDir = path.join(__dirname, '../cfg/templates');
    const cfgDir = path.join(__dirname, '../cfg');
    const files = ['xmpp_config_template.js', 'rest_config_template.js'];

    for (const file of files) {
        const templatePath = path.join(templatesDir, file);
        const configPath = path.join(cfgDir, file.replace('_template', ''));

        if (!fs.existsSync(templatePath)) {
            logging.warn(`Template file not found: ${file}`);
            continue;
        }

        if (!fs.existsSync(configPath)) {
            fs.copyFileSync(templatePath, configPath);
            logging.config(`Created ${path.basename(configPath)}`);
        } else {
            try {
                const templateContent = fs.readFileSync(templatePath, 'utf8');
                const configContent = fs.readFileSync(configPath, 'utf8');

                const templateModule = await import(`file://${templatePath}?t=${Date.now()}`);
                const configModule = await import(`file://${configPath}?t=${Date.now()}`);

                const templateObj = templateModule.default;
                const configObj = configModule.default;

                const templateStructure = getObjectStructure(templateObj);
                const configStructure = getObjectStructure(configObj);

                const templateKeys = Object.keys(templateStructure).sort();
                const configKeys = Object.keys(configStructure).sort();

                const structureChanged =
                    templateKeys.length !== configKeys.length ||
                    templateKeys.some((key, i) => key !== configKeys[i]);

                if (structureChanged) {
                    const merged = mergeConfigs(templateObj, configObj);

                    const constMatch = templateContent.match(/const\s+(\w+)\s*=/);
                    const varName = constMatch ? constMatch[1] : 'config';

                    let header = '';
                    const lines = templateContent.split('\n');

                    for (let i = 0; i < lines.length; i++) {
                        const line = lines[i].trim();
                        if (line.startsWith('const ')) {
                            break;
                        }
                        if (line.startsWith('import ') || line.startsWith('//') || line.startsWith('/*') || line === '') {
                            header += lines[i] + '\n';
                        }
                    }

                    const newContent = `${header}const ${varName} = {\n${configToString(merged, 1)}\n}\n\nexport default ${varName};\n`;

                    fs.writeFileSync(configPath, newContent, 'utf8');
                }
            } catch { }
        }
    }
}