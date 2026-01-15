export function handleMessage(server, socket, message, builder) {
    const to = message['@_to'];
    const body = message.body;
    if (!to || !body) return;

    if (to.includes('@')) {
        const handled = handleMUCMessage(server, socket, message, to, body, builder);
        if (handled) return;
    }

    handleDirectMessage(server, socket, message, to, body, builder);
}

function handleMUCMessage(server, socket, message, to, body, builder) {
    const parts = to.split('@');
    if (parts.length < 2) return false;

    const toDomain = parts[1].split('/')[0];
    if (
        toDomain !== server.mucDomain &&
        !toDomain.endsWith('.' + server.mucDomain) &&
        !server.mucDomain.endsWith('.' + toDomain)
    ) {
        return false;
    }

    const room = to;

    if (server.mucRooms.has(room)) {
        const occupants = server.mucRooms.get(room);

        if (!occupants.has(socket.fullJid)) {
            occupants.set(socket.fullJid, socket);

            if (!server.mucMembers.has(socket.fullJid)) {
                server.mucMembers.set(socket.fullJid, new Map());
            }
            const nick = socket.username;
            server.mucMembers.get(socket.fullJid).set(room, nick);

            socket.write(builder.build({
                'presence': { '@_from': `${room}/${nick}` }
            }));

            for (const client of occupants.values()) {
                if (client !== socket) {
                    client.write(builder.build({
                        'presence': {
                            '@_from': `${room}/${nick}`
                        }
                    }));
                }
            }
        }

        const userRooms = server.mucMembers.get(socket.fullJid);
        const nick = (userRooms && userRooms.has(room)) ? userRooms.get(room) : socket.username;

        for (const client of occupants.values()) {
            client.write(builder.build({
                'message': {
                    '@_from': `${to}/${nick}`,
                    '@_type': 'groupchat',
                    'body': body
                }
            }));
        }
        return true;
    }

    return false;
}

function handleDirectMessage(server, socket, message, to, body, builder) {
    const base = to.split('/')[0];
    for (const client of server.online.values()) {
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
}