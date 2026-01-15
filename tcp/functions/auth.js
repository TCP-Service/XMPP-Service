import crypto from 'crypto';

export function authenticateClient(username) {
    return true;
}

export function parseSASLPlain(b64) {
    const d = Buffer.from(b64, 'base64').toString('utf8').split('\0');
    return { username: d[d.length - 2], password: d[d.length - 1] };
}

export function handleAuth(server, socket, msg, builder) {
    const m = msg.match(/<auth[^>]*>([^<]*)<\/auth>/);
    if (m) {
        const creds = parseSASLPlain(m[1] || '');
        if (authenticateClient(creds.username, creds.password)) {
            socket.username = creds.username;
            socket.fullJid = `${creds.username}@${server.domain}/${crypto.randomUUID()}`;
            socket.authenticated = true;
            socket.write(builder.build({ 'success': { '@_xmlns': 'urn:ietf:params:xml:ns:xmpp-sasl' } }));
            server.log_debug(`AUTH OK ${socket.username}`);
        }
    }
}