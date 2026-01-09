import tls from 'tls';
import fs from 'fs';
import crypto from 'crypto';
import net from 'net';
import xmpp_config from '../cfg/xmpp_config.js';
import logging from '../utilities/log.js';
import { XMLBuilder, XMLParser } from 'fast-xml-parser';

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
    constructor(options = {}) {
        this.port = xmpp_config.server.port || 5222;
        this.host = xmpp_config.server.ip || '0.0.0.0';
        this.tlsOptions = {
            key: fs.readFileSync(options.key || 'cfg/certificate/private.key'),
            cert: fs.readFileSync(options.cert || 'cfg/certificate/certificate.crt'),
            ca: fs.readFileSync(options.ca_cert || 'cfg/certificate/ca_bundle.crt'),
            rejectUnauthorized: false,
            secureProtocol: 'TLS_method'
        };
        this.domain = xmpp_config.host.domain;
        this.server = null;
        this.clients = new Map();
        this.presences = new Map();
    }

    start() {
        this.server = net.createServer(socket => {
            this.clients.set(socket, socket);
            this.log_debug(`CONNECT ${socket.remoteAddress}`);
            this.sendStream(socket);

            socket.on('data', d => this.handleData(socket, d));
            socket.on('close', () => this.handleDisconnect(socket));
            socket.on('error', () => this.handleDisconnect(socket));
        });

        this.server.listen(this.port, this.host, () =>
            this.log(`XMPP running on ${this.host}:${this.port}`)
        );
    }

    log(msg) { logging.xmpp(`${msg}`); }
    log_debug(msg) { if (xmpp_config.log_debug) logging.debug(`${msg}`); }

    authenticateClient(username, password) {
        this.log_debug(`AUTH attempt ${username}`);
        return true;
    }

    parseSASLPlain(b64) {
        const d = Buffer.from(b64, 'base64').toString('utf8').split('\0');
        return { username: d[d.length - 2], password: d[d.length - 1] };
    }

    sendStream(socket, encrypted = false) {
        const streamOpen = builder.build({
            '?xml': { '@_version': '1.0' },
            'stream:stream': {
                '@_xmlns': 'jabber:client',
                '@_xmlns:stream': 'http://etherx.jabber.org/streams',
                '@_from': this.domain,
                '@_id': crypto.randomUUID(),
                '@_version': '1.0'
            }
        });

        socket.write(streamOpen.replace('/>', '>'));

        if (!encrypted) {
            socket.write(builder.build({ 'stream:features': { 'starttls': { '@_xmlns': 'urn:ietf:params:xml:ns:xmpp-tls', 'required': '' } } }));
        } else if (!socket.authenticated) {
            socket.write(builder.build({ 'stream:features': { 'mechanisms': { '@_xmlns': 'urn:ietf:params:xml:ns:xmpp-sasl', 'mechanism': 'PLAIN' } } }));
        } else {
            socket.write(builder.build({ 'stream:features': { 'bind': { '@_xmlns': 'urn:ietf:params:xml:ns:xmpp-bind' }, 'session': { '@_xmlns': 'urn:ietf:params:xml:ns:xmpp-session' } } }));
        }
    }

    parseStanza(msg) {
        try {
            const stanzas = [];
            const wrapped = `<root>${msg}</root>`;
            const parsed = parser.parse(wrapped);
            if (parsed.root) {
                for (const [key, value] of Object.entries(parsed.root)) {
                    if (key !== '?xml' && key !== 'stream:stream') stanzas.push({ type: key, data: value });
                }
            }
            return stanzas;
        } catch {
            return [];
        }
    }

    handleData(socket, data) {
        const msg = data.toString();
        if (msg.includes('<stream:stream')) { if (socket.authenticated) this.sendStream(socket, true); return; }
        if (msg.includes('<starttls')) {
            socket.write(builder.build({ 'proceed': { '@_xmlns': 'urn:ietf:params:xml:ns:xmpp-tls' } }));
            const tlsSocket = new tls.TLSSocket(socket, { isServer: true, ...this.tlsOptions });
            this.clients.delete(socket);
            this.clients.set(tlsSocket, tlsSocket);
            tlsSocket.on('data', d => this.handleData(tlsSocket, d));
            this.sendStream(tlsSocket, true);
            return;
        }

        if (msg.includes('<auth')) {
            const authMatch = msg.match(/<auth[^>]*>([^<]*)<\/auth>/);
            if (authMatch) {
                const creds = this.parseSASLPlain(authMatch[1] || '');
                if (this.authenticateClient(creds.username, creds.password)) {
                    socket.username = creds.username;
                    socket.fullJid = `${creds.username}@${this.domain}/${crypto.randomUUID()}`;
                    socket.authenticated = true;
                    socket.write(builder.build({ 'success': { '@_xmlns': 'urn:ietf:params:xml:ns:xmpp-sasl' } }));
                    this.log_debug(`AUTH OK ${socket.username}`);
                }
            }
            return;
        }

        const stanzas = this.parseStanza(msg);
        for (const stanza of stanzas) {
            console.log(stanza.type)
            if (stanza.type === 'iq') this.handleIQ(socket, stanza.data);
            else if (stanza.type === 'presence') this.handlePresence(socket, stanza.data);
            else if (stanza.type === 'message') this.handleMessage(socket, stanza.data);
        }
    }

    handleIQ(socket, iq) {
        const id = iq['@_id'];
        if (iq.bind) {
            const resource = iq.bind.resource || crypto.randomUUID();
            socket.fullJid = `${socket.username}@${this.domain}/${resource}`;
            socket.write(builder.build({
                'iq': { '@_type': 'result', '@_id': id, 'bind': { '@_xmlns': 'urn:ietf:params:xml:ns:xmpp-bind', 'jid': socket.fullJid } }
            }));
            this.log_debug(`BIND ${socket.username} -> ${socket.fullJid}`);
            return;
        }

        if (iq.session) {
            socket.write(builder.build({ 'iq': { '@_type': 'result', '@_id': id } }));
            return;
        }

        if (iq.ping || iq['ping:ping']) {
            socket.write(builder.build({ 'iq': { '@_type': 'result', '@_id': id } }));
        }
    }

    handlePresence(socket, presence) {
        if (!socket.username) return;
        const type = presence['@_type'];
        if (type === 'unavailable') {
            this.handleUnavailable(socket);
            return;
        }

        const presenceStanza = { 'presence': { '@_from': socket.fullJid } };
        if (presence.show) presenceStanza.presence.show = presence.show;
        if (presence.status) presenceStanza.presence.status = presence.status;
        const presenceXML = builder.build(presenceStanza);

        this.presences.set(socket.fullJid, { username: socket.username, presence: presenceXML, socket });

        for (const [_, client] of this.clients.entries()) {
            if (client.authenticated && client !== socket) client.write(presenceXML);
        }

        this.log_debug(`PRESENCE ${socket.username} (${socket.fullJid})`);
    }

    handleUnavailable(socket) {
        if (!socket.username) return;
        const unavailableStanza = builder.build({ 'presence': { '@_from': socket.fullJid, '@_type': 'unavailable' } });
        for (const [_, client] of this.clients.entries()) {
            if (client.authenticated && client !== socket) client.write(unavailableStanza);
        }
        this.presences.delete(socket.fullJid);
        this.log_debug(`UNAVAILABLE ${socket.username} (${socket.fullJid})`);
    }

    handleMessage(socket, message) {
        const to = message['@_to'];
        const body = message.body;
        console.log(message);
        if (!body || !to) return;

        const toBase = to.split('/')[0];
        for (const [fullJid, pres] of this.presences.entries()) {
            if (fullJid.startsWith(toBase)) {
                pres.socket.write(builder.build({ 'message': { '@_from': socket.fullJid, '@_to': fullJid, 'body': body } }));
            }
        }

        this.log_debug(`MSG ${socket.username} -> ${to}`);
    }

    handleDisconnect(socket) {
        this.clients.delete(socket);
        this.handleUnavailable(socket);
    }
}

const server = new SecureTCPServer();
export default { server };