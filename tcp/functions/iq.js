import crypto from 'crypto';

export function handleIQ(server, socket, iq, builder) {
    const id = iq['@_id'];
    const from = iq['@_from'];

    if (iq.ping && iq.ping['@_xmlns'] === 'urn:xmpp:ping') {
        socket.write(builder.build({
            iq: {
                '@_type': 'result',
                '@_id': id,
                ...(from ? { '@_to': from } : {})
            }
        }));
        return;
    }

    if (iq.bind) {
        const resource = iq.bind.resource || crypto.randomUUID();
        socket.fullJid = `${socket.username}@${server.domain}/${resource}`;
        socket.write(builder.build({
            iq: {
                '@_type': 'result',
                '@_id': id,
                bind: {
                    '@_xmlns': 'urn:ietf:params:xml:ns:xmpp-bind',
                    jid: socket.fullJid
                }
            }
        }));
        server.log_debug(`BIND ${socket.username} -> ${socket.fullJid}`);
        return;
    }

    socket.write(builder.build({
        iq: {
            '@_type': 'result',
            '@_id': id
        }
    }));
}