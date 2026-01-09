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
    constructor() {
        this.port = xmpp_config.server.port || 5222;
        this.host = xmpp_config.server.ip || '0.0.0.0';
        this.domain = xmpp_config.host.domain;
        this.mucDomain = `${xmpp_config.options.muc_name}.${this.domain}`;

        this.tlsOptions = {
            key: fs.readFileSync(xmpp_config.certs.key),
            cert: fs.readFileSync(xmpp_config.certs.cert),
            ca: fs.readFileSync(xmpp_config.certs.ca_bundle),
            rejectUnauthorized: false,
            secureProtocol: 'TLS_method'
        };

        this.server = null;
        this.clients = new Map();
        this.online = new Map();
        this.lastPresence = new Map();
        this.mucRooms = new Map();
    }

    log(msg) { logging.xmpp(`${msg}`); }
    log_debug(msg) { if (xmpp_config.log_debug) logging.debug(`${msg}`); }

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

    authenticateClient(username) {
        this.log_debug(`AUTH attempt ${username}`);
        return true;
    }

    parseSASLPlain(b64) {
        const d = Buffer.from(b64, 'base64').toString('utf8').split('\0');
        return { username: d[d.length - 2], password: d[d.length - 1] };
    }

    sendStream(socket, encrypted = false) {
        const open = builder.build({
            '?xml': { '@_version': '1.0' },
            'stream:stream': {
                '@_xmlns': 'jabber:client',
                '@_xmlns:stream': 'http://etherx.jabber.org/streams',
                '@_from': this.domain,
                '@_id': crypto.randomUUID(),
                '@_version': '1.0'
            }
        });

        socket.write(open.replace('/>', '>'));

        if (!encrypted) {
            socket.write(builder.build({
                'stream:features': {
                    'starttls': {
                        '@_xmlns': 'urn:ietf:params:xml:ns:xmpp-tls',
                        'required': ''
                    }
                }
            }));
        } else if (!socket.authenticated) {
            socket.write(builder.build({
                'stream:features': {
                    'mechanisms': {
                        '@_xmlns': 'urn:ietf:params:xml:ns:xmpp-sasl',
                        'mechanism': 'PLAIN'
                    }
                }
            }));
        } else {
            socket.write(builder.build({
                'stream:features': {
                    'bind': { '@_xmlns': 'urn:ietf:params:xml:ns:xmpp-bind' },
                    'session': { '@_xmlns': 'urn:ietf:params:xml:ns:xmpp-session' }
                }
            }));
        }
    }

    parseStanza(msg) {
        try {
            const wrapped = `<root>${msg}</root>`;
            const parsed = parser.parse(wrapped);
            const out = [];
            if (parsed.root) {
                for (const [k, v] of Object.entries(parsed.root)) {
                    if (k !== '?xml' && k !== 'stream:stream') {
                        out.push({ type: k, data: v });
                    }
                }
            }
            return out;
        } catch {
            return [];
        }
    }

    handleData(socket, data) {
        const msg = data.toString();

        if (msg.includes('<stream:stream')) {
            if (socket.authenticated) this.sendStream(socket, true);
            return;
        }

        if (msg.includes('<starttls')) {
            socket.write(builder.build({ 'proceed': { '@_xmlns': 'urn:ietf:params:xml:ns:xmpp-tls' } }));
            const tlsSocket = new tls.TLSSocket(socket, { isServer: true, ...this.tlsOptions });
            this.clients.delete(socket);
            this.clients.set(tlsSocket, tlsSocket);
            tlsSocket.on('data', d => this.handleData(tlsSocket, d));
            tlsSocket.on('close', () => this.handleDisconnect(tlsSocket));
            tlsSocket.on('error', () => this.handleDisconnect(tlsSocket));
            this.sendStream(tlsSocket, true);
            this.log_debug(`STARTTLS`);
            return;
        }

        if (msg.includes('<auth')) {
            const m = msg.match(/<auth[^>]*>([^<]*)<\/auth>/);
            if (m) {
                const creds = this.parseSASLPlain(m[1] || '');
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

        for (const stanza of this.parseStanza(msg)) {
            if (stanza.type === 'iq') this.handleIQ(socket, stanza.data);
            if (stanza.type === 'presence') this.handlePresence(socket, stanza.data);
            if (stanza.type === 'message') this.handleMessage(socket, stanza.data);
        }
    }

    handleIQ(socket, iq) {
        const id = iq['@_id'];

        if (iq.bind) {
            const resource = iq.bind.resource || crypto.randomUUID();
            socket.fullJid = `${socket.username}@${this.domain}/${resource}`;
            socket.write(builder.build({
                'iq': {
                    '@_type': 'result',
                    '@_id': id,
                    'bind': {
                        '@_xmlns': 'urn:ietf:params:xml:ns:xmpp-bind',
                        'jid': socket.fullJid
                    }
                }
            }));
            this.log_debug(`BIND ${socket.username} -> ${socket.fullJid}`);
            return;
        }

        socket.write(builder.build({ 'iq': { '@_type': 'result', '@_id': id } }));
    }

    handlePresence(socket, presence) {
        if (!socket.authenticated) return;

        const to = presence['@_to'];

        if (presence['@_type'] === 'unavailable') {
            this.handleUnavailable(socket);
            return;
        }

        const xml = builder.build({
            'presence': {
                '@_from': socket.fullJid,
                ...(presence.show ? { show: presence.show } : {}),
                ...(presence.status ? { status: presence.status } : {})
            }
        });

        if (to && to.includes('@') && to.split('@')[1].startsWith(this.mucDomain)) {
            const room = to.split('/')[0];
            const nick = to.split('/')[1] || socket.username;

            if (!this.mucRooms.has(room)) {
                this.mucRooms.set(room, new Map());
                this.log_debug(`MUC CREATE ${room}`);
            }

            const occupants = this.mucRooms.get(room);
            occupants.set(socket.fullJid, socket);
            socket.currentRoom = room;
            socket.roomNick = nick;

            socket.write(builder.build({
                'presence': { '@_from': `${room}/${nick}` }
            }));

            for (const client of occupants.values()) {
                if (client !== socket) {
                    client.write(builder.build({
                        'presence': {
                            '@_from': `${room}/${nick}`,
                            ...(presence.show ? { show: presence.show } : {}),
                            ...(presence.status ? { status: presence.status } : {})
                        }
                    }));
                }
            }

            this.log_debug(`MUC PRESENCE ${nick} -> ${room}`);
            return;
        }

        for (const [jid, p] of this.lastPresence.entries()) {
            if (jid !== socket.fullJid) socket.write(p);
        }

        this.lastPresence.set(socket.fullJid, xml);
        this.online.set(socket.fullJid, socket);

        for (const client of this.online.values()) {
            if (client !== socket) client.write(xml);
        }

        this.log_debug(`PRESENCE ${socket.username} (${socket.fullJid})`);
    }

    handleUnavailable(socket) {
        if (!socket.fullJid) return;

        this.lastPresence.delete(socket.fullJid);
        this.online.delete(socket.fullJid);

        if (socket.currentRoom) {
            const room = this.mucRooms.get(socket.currentRoom);
            if (room) {
                room.delete(socket.fullJid);
                if (room.size === 0) this.mucRooms.delete(socket.currentRoom);
            }
            socket.currentRoom = null;
            socket.roomNick = null;
        }

        const stanza = builder.build({
            'presence': {
                '@_from': socket.fullJid,
                '@_type': 'unavailable'
            }
        });

        for (const client of this.clients.values()) {
            if (client !== socket && client.authenticated) {
                client.write(stanza);
            }
        }

        this.log_debug(`UNAVAILABLE ${socket.username}`);
    }

    handleMessage(socket, message) {
        const to = message['@_to'];
        const body = message.body;
        if (!to || !body) return;

        if (this.mucRooms.has(to)) {
            const room = this.mucRooms.get(to);
            for (const client of room.values()) {
                client.write(builder.build({
                    'message': {
                        '@_from': `${to}/${socket.roomNick || socket.username}`,
                        '@_type': 'groupchat',
                        'body': body
                    }
                }));
            }
            this.log_debug(`MUC MSG ${socket.username} -> ${to}`);
            return;
        }

        const base = to.split('/')[0];
        for (const client of this.online.values()) {
            if (client.fullJid.startsWith(base)) {
                client.write(builder.build({
                    'message': {
                        '@_from': socket.fullJid,
                        '@_to': client.fullJid,
                        '@_type': message['@_type'],
                        'body': body
                    }
                }));
            }
        }

        this.log_debug(`MSG ${socket.username} -> ${to}`);
    }

    handleDisconnect(socket) {
        this.clients.delete(socket);
        this.handleUnavailable(socket);
        if (socket.username) this.log_debug(`DISCONNECT ${socket.username}`);
    }
}

const server = new SecureTCPServer();
export default { server };
