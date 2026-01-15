import tcpServer from '../tcp/index.js';
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseAttributeValue: false,
    trimValues: true,
    parseTagValue: true,
    cdataPropName: "__cdata"
});

export default function (app) {
    app.get('/users', async (req, res) => {
        const server = tcpServer.server;
        const users = [];

        for (const [jid, socket] of server.online.entries()) {
            const username = socket.username || jid.split('@')[0];
            const presenceXml = server.lastPresence.get(jid);

            let status = null;

            if (presenceXml) {
                try {
                    const parsed = parser.parse(presenceXml);

                    if (parsed.presence?.status) {
                        try {
                            status = JSON.parse(parsed.presence.status);

                            if (Array.isArray(status.Properties)) {
                                const props = {};

                                for (const prop of status.Properties) {
                                    if (!prop.Name) continue;

                                    let value = prop.Value;

                                    if (prop.Type === 'String') {
                                        try {
                                            value = JSON.parse(value);
                                        } catch {
                                        }
                                    }

                                    props[prop.Name] = value;
                                }

                                status.Properties = props;
                            }
                        } catch {
                            status = parsed.presence.status;
                        }
                    }
                } catch {
                }
            }

            users.push({
                jid,
                username,
                status
            });
        }

        return res.json({
            online: users.length,
            users
        });
    });
}
