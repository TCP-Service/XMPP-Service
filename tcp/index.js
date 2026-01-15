import net from 'net';
import fs from 'fs';
import xmpp_config from '../cfg/xmpp_config.js';
import logging from '../utilities/log.js';
import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import forge from 'node-forge';
import { handleAuth } from './functions/auth.js';
import { handleIQ } from './functions/iq.js';
import { handlePresence, handleUnavailable } from './functions/presence.js';
import { handleMessage } from './functions/message.js';
import { sendStream, handleStartTLS, parseStanza } from './functions/stream.js';

const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseAttributeValue: false,
    trimValues: true,
    parseTagValue: false
});

const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    suppressEmptyNode: true,
    format: false
});

class SecureTCPServer {
    constructor() {
        this.port = xmpp_config.server.port || 5222;
        this.host = xmpp_config.server.ip || '0.0.0.0';

        this.tlsOptions = null;
        let cert, validTo;

        try {
            this.tlsOptions = {
                key: fs.readFileSync(xmpp_config.certs.key),
                cert: fs.readFileSync(xmpp_config.certs.cert),
                ca: fs.readFileSync(xmpp_config.certs.ca_bundle),
                rejectUnauthorized: false,
                secureProtocol: 'TLS_method'
            };

            const pem = this.tlsOptions.cert.toString('utf8');
            cert = forge.pki.certificateFromPem(pem);
            validTo = cert.validity.notAfter;

            if (validTo < new Date()) {
                throw new Error('Certificate expired');
            }
        } catch (e) {
            logging.warn(
                "SSL Disabled - Your certificate is invalid/expired. Go to " +
                "\x1b]8;;https://app.zerossl.com/certificate/new\x1b\\ZeroSSL\x1b]8;;\x1b\\ " +
                "to request a new one."
            );
        }

        this.domain = cert?.subject?.getField('CN')?.value || 'prod.ol.epicgames.com';
        this.mucDomain = `${xmpp_config.options.muc_name}.${this.domain}`;

        this.server = null;
        this.clients = new Map();
        this.online = new Map();
        this.lastPresence = new Map();
        this.mucRooms = new Map();
        this.mucMembers = new Map();
    }

    log(msg) { logging.xmpp(`${msg}`); }
    log_debug(msg) { if (xmpp_config.log_debug) logging.debug(`${msg}`); }

    start() {
        this.server = net.createServer(socket => {
            this.clients.set(socket, socket);
            this.log_debug(`CONNECT ${socket.remoteAddress}`);
            sendStream(this, socket, false, builder);
            socket.on('data', d => this.handleData(socket, d));
            socket.on('close', () => this.handleDisconnect(socket));
            socket.on('error', () => this.handleDisconnect(socket));
        });

        this.server.listen(this.port, this.host, () =>
            this.log(`XMPP running on ${this.host}:${this.port}`)
        );
    }

    handleData(socket, data) {
        const msg = data.toString();

        if (msg.includes('<stream:stream')) {
            if (socket.authenticated) sendStream(this, socket, true, builder);
            return;
        }

        if (msg.includes('<starttls')) {
            handleStartTLS(this, socket, builder);
            return;
        }

        if (msg.includes('<auth')) {
            handleAuth(this, socket, msg, builder);
            return;
        }

        for (const stanza of parseStanza(parser, msg)) {
            if (stanza.type === 'iq') handleIQ(this, socket, stanza.data, builder);
            if (stanza.type === 'presence') handlePresence(this, socket, stanza.data, builder);
            if (stanza.type === 'message') handleMessage(this, socket, stanza.data, builder);
        }
    }

    handleDisconnect(socket) {
        this.clients.delete(socket);
        handleUnavailable(this, socket, null, builder);
        if (socket.username) this.log_debug(`DISCONNECT ${socket.username}`);
    }

    handleFriendRequest(from, to, status = "PENDING") {
        const fromId = typeof from === 'string' ? from : from.accountId;
        const toId = typeof to === 'string' ? to : to.accountId;

        const timestamp = new Date().toISOString();

        const senderPayload = {
            accountId: toId,
            status,
            direction: 'OUTBOUND',
            created: timestamp,
            favorite: false
        };

        const receiverPayload = {
            accountId: fromId,
            status,
            direction: 'INBOUND',
            created: timestamp,
            favorite: false
        };

        const senderMessage = {
            from: 'xmpp-admin',
            to: fromId,
            payload: senderPayload,
            type: "com.epicgames.friends.core.apiobjects.Friend",
            timestamp
        };

        const receiverMessage = {
            from: 'xmpp-admin',
            to: toId,
            payload: receiverPayload,
            type: "com.epicgames.friends.core.apiobjects.Friend",
            timestamp
        };

        for (const client of this.online.values()) {
            const clientAccount = client.fullJid.split('/')[0].split('@')[0].toLowerCase();

            if (clientAccount === fromId.toLowerCase()) {
                client.write(builder.build({
                    message: {
                        '@_from': `xmpp-admin@${this.domain}`,
                        '@_to': client.fullJid,
                        body: JSON.stringify(senderMessage)
                    }
                }));
            }

            if (clientAccount === toId.toLowerCase()) {
                client.write(builder.build({
                    message: {
                        '@_from': `xmpp-admin@${this.domain}`,
                        '@_to': client.fullJid,
                        body: JSON.stringify(receiverMessage)
                    }
                }));
            }
        }
    }


    shutdown() {
        this.log('Disconnecting all clients');

        const kickStanza = builder.build({
            'stream:error': {
                'policy-violation': { '@_xmlns': 'urn:ietf:params:xml:ns:xmpp-streams' }
            }
        });

        for (const socket of this.clients.values()) {
            try {
                if (socket.authenticated) {
                    socket.write(kickStanza);
                }
                socket.destroy();
            } catch (e) { }
        }

        this.clients.clear();
        this.online.clear();
        this.lastPresence.clear();
        this.mucRooms.clear();
        this.mucMembers.clear();

        if (this.server) {
            this.server.close(() => this.log('Server socket closed'));
        }
    }
}

const server = new SecureTCPServer();
export default { server };

process.on('SIGINT', () => {
    server.shutdown();
    process.exit(0);
});

process.on('SIGTERM', () => {
    server.shutdown();
    process.exit(0);
});