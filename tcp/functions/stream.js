import crypto from 'crypto';
import tls from 'tls';

export function sendStream(server, socket, encrypted, builder) {
    const open = builder.build({
        '?xml': { '@_version': '1.0' },
        'stream:stream': {
            '@_xmlns': 'jabber:client',
            '@_xmlns:stream': 'http://etherx.jabber.org/streams',
            '@_from': server.domain,
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

export function handleStartTLS(server, socket, builder) {
    socket.write(builder.build({ 'proceed': { '@_xmlns': 'urn:ietf:params:xml:ns:xmpp-tls' } }));
    const tlsSocket = new tls.TLSSocket(socket, { isServer: true, ...server.tlsOptions });
    server.clients.delete(socket);
    server.clients.set(tlsSocket, tlsSocket);
    tlsSocket.on('data', d => server.handleData(tlsSocket, d));
    tlsSocket.on('close', () => server.handleDisconnect(tlsSocket));
    tlsSocket.on('error', () => server.handleDisconnect(tlsSocket));
    sendStream(server, tlsSocket, true, builder);
    server.log_debug(`STARTTLS`);
}

export function parseStanza(parser, msg) {
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