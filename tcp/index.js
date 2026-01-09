import tls from 'tls';
import fs from 'fs';
import crypto from 'crypto';
import net from 'net';
import xmpp_config from '../cfg/xmpp_config.js';
import logging from '../utilities/log.js';
import { XMLBuilder, XMLParser } from 'fast-xml-parser';

const options = {
    port: xmpp_config.server.port,
    key: xmpp_config.certs.key,
    cert: xmpp_config.certs.cert,
    cert_bundle: xmpp_config.certs.ca_bundle
}

const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: ""
});

const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    suppressEmptyNode: true
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
        this.mucDomain = `${xmpp_config.options.muc_name}.${this.domain}`;
        this.roomJid = `${xmpp_config.options.global_chat_name}@${this.mucDomain}`;

        this.server = null;
        this.clients = new Map();
        this.presences = new Map(); // username -> xml

        this.mucRoom = new Map(); // nick -> socket
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

    log(msg) {
        logging.xmpp(`${msg}`);
    }

    log_debug(msg) {
        // logging.xmpp(`${msg}`);
        if (xmpp_config.log_debug) {
            logging.debug(`${msg}`);
        }
    }

    authenticateClient(username, password) {
        this.log_debug(`AUTH attempt ${username}`);
        return true;
    }

    parseSASLPlain(b64) {
        const d = Buffer.from(b64, 'base64').toString('utf8').split('\0');
        return { username: d[d.length - 2], password: d[d.length - 1] };
    }

    sendStream(socket, encrypted = false) {
        socket.write(`<?xml version='1.0'?>
<stream:stream xmlns='jabber:client'
xmlns:stream='http://etherx.jabber.org/streams'
from='${this.domain}'
id='${crypto.randomUUID()}'
version='1.0'>`);

        if (!encrypted) {
            socket.write(`
<stream:features>
<starttls xmlns='urn:ietf:params:xml:ns:xmpp-tls'><required/></starttls>
</stream:features>`);
        } else if (!socket.authenticated) {
            socket.write(`
<stream:features>
<mechanisms xmlns='urn:ietf:params:xml:ns:xmpp-sasl'>
<mechanism>PLAIN</mechanism>
</mechanisms>
</stream:features>`);
        } else {
            socket.write(`
<stream:features>
<bind xmlns='urn:ietf:params:xml:ns:xmpp-bind'/>
<session xmlns='urn:ietf:params:xml:ns:xmpp-session'/>
</stream:features>`);
        }
    }

    handleData(socket, data) {
        const msg = data.toString();

        if (msg.includes('<starttls')) {
            socket.write(`<proceed xmlns='urn:ietf:params:xml:ns:xmpp-tls'/>`);
            const tlsSocket = new tls.TLSSocket(socket, { isServer: true, ...this.tlsOptions });
            this.clients.delete(socket);
            this.clients.set(tlsSocket, tlsSocket);
            tlsSocket.on('data', d => this.handleData(tlsSocket, d));
            this.sendStream(tlsSocket, true);
            return;
        }
        else if (msg.includes('<auth')) {
            const creds = this.parseSASLPlain(msg.match(/>([^<]+)</)?.[1] || '');
            if (this.authenticateClient(creds.username, creds.password)) {
                socket.username = creds.username;
                socket.fullJid = `${creds.username}@${this.domain}/res`;
                socket.authenticated = true;
                socket.write(`<success xmlns='urn:ietf:params:xml:ns:xmpp-sasl'/>`);
                this.log_debug(`AUTH OK ${socket.username}`);
            }
            return;
        }
        else if (msg.includes('<stream:stream') && socket.authenticated) {
            this.sendStream(socket, true);
            return;
        }
        else if (msg.includes('<iq') && msg.includes('bind')) {
            const id = msg.match(/id=['"]([^'"]+)['"]/)?.[1];
            socket.write(`<iq type='result' id='${id}'>
<bind xmlns='urn:ietf:params:xml:ns:xmpp-bind'>
<jid>${socket.fullJid}</jid>
</bind>
</iq>`);
            return;
        }
        else if (msg.includes('<iq') && msg.includes('session')) {
            const id = msg.match(/id=['"]([^'"]+)['"]/)?.[1];
            socket.write(`<iq type='result' id='${id}'/>`);
            return;
        }
        else if (msg.includes("<presence") && msg.includes("type='subscribe'")) {
            const to = msg.match(/to=['"]([^'"]+)['"]/)?.[1];
            socket.write(`<presence to='${to}' from='${socket.fullJid}' type='subscribed'/>`);
            return;
        }
        else if (msg.includes('<presence') && msg.includes(this.roomJid)) {
            const nick = msg.match(/\/([^'"]+)/)?.[1] || socket.username;
            socket.mucNick = nick;
            this.mucRoom.set(nick, socket);

            for (const [_, s] of this.mucRoom) {
                s.write(`<presence from='${this.roomJid}/${nick}'/>`);
            }

            this.log_debug(`MUC JOIN ${nick}`);
            return;
        }
        else if (msg.includes('<presence')) {
            const p = msg.includes('from=')
                ? msg
                : msg.replace('<presence', `<presence from='${socket.fullJid}'`);
            this.presences.set(socket.username, p);
            for (const [_, s] of this.clients) {
                if (s !== socket && s.authenticated) s.write(p);
            }
            this.log_debug(`PRESENCE ${socket.username}`);
            return;
        }
        else if (msg.includes('<message') && msg.includes(this.roomJid)) {
            const body = msg.match(/<body>([^<]+)<\/body>/)?.[1];
            if (!body) return;

            for (const [_, s] of this.mucRoom) {
                s.write(`<message type='groupchat'
from='${this.roomJid}/${socket.mucNick}'>
<body>${body}</body>
</message>`);
            }
            this.log_debug(`MUC MSG ${socket.mucNick}: ${body}`);
            return;
        }
        else if (msg.includes('<message')) {
            const to = msg.match(/to=['"]([^'"]+)['"]/)?.[1];
            const body = msg.match(/<body>([^<]+)<\/body>/)?.[1];
            if (!to || !body) return;

            for (const [_, s] of this.clients) {
                if (s.fullJid?.startsWith(to.split('/')[0])) {
                    s.write(`<message from='${socket.fullJid}' to='${to}'>
<body>${body}</body>
</message>`);
                }
            }
            this.log_debug(`MSG ${socket.username} -> ${to}`);
        }
        else if (msg.includes('<ping:ping')) {
            this.log_debug('PING received from client.');

            const obj = parser.parse(msg);
            const id = obj.iq.id;

            socket.write(builder.build({
                id: {
                    type: 'result',
                    id: id
                }
            }))
        }
        else {
            this.log_debug(`Unknown message received from client. ${msg}`);
        }
    }

    handleDisconnect(socket) {
        this.clients.delete(socket);

        if (socket.username) {
            const u = `<presence from='${socket.fullJid}' type='unavailable'/>`;
            for (const [_, s] of this.clients) s.write(u);
            this.presences.delete(socket.username);
        }

        if (socket.mucNick) {
            this.mucRoom.delete(socket.mucNick);
            for (const [_, s] of this.mucRoom) {
                s.write(`<presence from='${this.roomJid}/${socket.mucNick}' type='unavailable'/>`);
            }
            this.log_debug(`MUC LEAVE ${socket.mucNick}`);
        }
    }
}

const server = new SecureTCPServer();
export default { server };
