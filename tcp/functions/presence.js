import xmpp_config from '../../cfg/xmpp_config.js';

export function handlePresence(server, socket, presence, builder) {
    if (!socket.authenticated) return;

    const to = presence['@_to'];

    if (presence['@_type'] === 'unavailable') {
        handleUnavailable(server, socket, to, builder);
        return;
    }

    if (presence.status && !to) {
        handlePartyPresence(server, socket, presence, builder);
    }

    if (to && to.includes('@')) {
        const handled = handleMUCPresence(server, socket, presence, to, builder);
        if (handled) return;
    }

    broadcastPresence(server, socket, presence, builder);
}

function handlePartyPresence(server, socket, presence, builder) {
    try {
        const statusObj = JSON.parse(presence.status);

        if (Array.isArray(statusObj.Properties)) {
            statusObj.Properties = statusObj.Properties.map(prop => {
                if (prop.Value && prop.Type === 'String') {
                    try {
                        prop.Value = JSON.parse(prop.Value);
                    } catch { }
                }
                return prop;
            });
        }

        const partyProp = statusObj.Properties?.find(
            p => p.Name === 'party.joininfodata.286331153'
        );

        const partyData = partyProp?.Value;

        if (partyData?.partyId) {
            const partyRoom = `party-${partyData.partyId.toLowerCase()}@${server.mucDomain}`;
            const sourceName = partyData.sourceDisplayName;
            const baseUsername = socket.username.split(':')[0] || socket.username;
            const resource = socket.fullJid.split('/')[1];

            const nickParts = [];
            if (sourceName) nickParts.push(sourceName);
            nickParts.push(baseUsername);
            nickParts.push(resource);
            const nick = nickParts.join(':');

            const userRooms = server.mucMembers.get(socket.fullJid);
            const alreadyInParty = userRooms &&
                Array.from(userRooms.keys()).some(room => room.startsWith('party-'));

            if (!alreadyInParty || !userRooms.has(partyRoom)) {
                if (userRooms) {
                    for (const [room] of userRooms.entries()) {
                        if (room.startsWith('party-') && room !== partyRoom) {
                            handleUnavailable(server, socket, room, builder);
                        }
                    }
                }

                joinMUCRoom(server, socket, partyRoom, nick, builder);
            }
        }
    } catch { }
}

function handleMUCPresence(server, socket, presence, to, builder) {
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

    const room = to.split('/')[0];
    const nick = to.split('/')[1] || socket.username;

    joinMUCRoom(server, socket, room, nick, builder, presence);
    return true;
}

function joinMUCRoom(server, socket, room, nick, builder, presence = null) {
    if (!server.mucRooms.has(room)) {
        server.mucRooms.set(room, new Map());
        server.log_debug(`MUC CREATE ${room}`);
    }

    const occupants = server.mucRooms.get(room);
    const wasInRoom = occupants.has(socket.fullJid);

    occupants.set(socket.fullJid, socket);

    if (!server.mucMembers.has(socket.fullJid)) {
        server.mucMembers.set(socket.fullJid, new Map());
    }
    server.mucMembers.get(socket.fullJid).set(room, nick);

    if (!wasInRoom) {
        server.log_debug(`MUC JOIN ${socket.username} -> ${room}`);
    }

    socket.write(builder.build({
        presence: { '@_from': `${room}/${nick}` }
    }));

    for (const client of occupants.values()) {
        if (client !== socket) {
            client.write(builder.build({
                presence: {
                    '@_from': `${room}/${nick}`,
                    ...(presence?.show ? { show: presence.show } : {}),
                    ...(presence?.status ? { status: presence.status } : {})
                }
            }));
        }
    }
}

function broadcastPresence(server, socket, presence, builder) {
    const xml = builder.build({
        presence: {
            '@_from': socket.fullJid,
            ...(presence.show ? { show: presence.show } : {}),
            ...(presence.status ? (() => {
                const s = JSON.parse(presence.status);
                return {
                    status: JSON.stringify({
                        ...s,
                        Status: xmpp_config.options.show_version_in_status
                            ? `test ${s.Status || ''}`
                            : s.Status
                    })
                };
            })() : {})
        }
    });

    for (const [jid, p] of server.lastPresence.entries()) {
        if (jid !== socket.fullJid) socket.write(p);
    }

    server.lastPresence.set(socket.fullJid, xml);
    server.online.set(socket.fullJid, socket);

    for (const client of server.online.values()) {
        if (client !== socket) client.write(xml);
    }
}

export function handleUnavailable(server, socket, to, builder) {
    if (!socket.fullJid) return;

    if (to && to.includes('@')) {
        const handled = handleMUCUnavailable(server, socket, to, builder);
        if (handled) return;
    }

    broadcastUnavailable(server, socket, builder);
}

function handleMUCUnavailable(server, socket, to, builder) {
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

    const room = to.split('/')[0];
    const userRooms = server.mucMembers.get(socket.fullJid);

    if (userRooms && userRooms.has(room)) {
        const nick = userRooms.get(room);
        const occupants = server.mucRooms.get(room);

        if (occupants) {
            for (const client of occupants.values()) {
                if (client !== socket) {
                    client.write(builder.build({
                        'presence': {
                            '@_from': `${room}/${nick}`,
                            '@_type': 'unavailable'
                        }
                    }));
                }
            }

            occupants.delete(socket.fullJid);
            if (occupants.size === 0) {
                server.mucRooms.delete(room);
            }
        }

        userRooms.delete(room);
        if (userRooms.size === 0) {
            server.mucMembers.delete(socket.fullJid);
        }

        server.log_debug(`MUC LEAVE ${socket.username} from ${room}`);
    }
    return true;
}

function broadcastUnavailable(server, socket, builder) {
    server.lastPresence.delete(socket.fullJid);
    server.online.delete(socket.fullJid);

    const userRooms = server.mucMembers.get(socket.fullJid);
    if (userRooms) {
        for (const [room, nick] of userRooms.entries()) {
            const occupants = server.mucRooms.get(room);
            if (occupants) {
                for (const client of occupants.values()) {
                    if (client !== socket) {
                        client.write(builder.build({
                            'presence': {
                                '@_from': `${room}/${nick}`,
                                '@_type': 'unavailable'
                            }
                        }));
                    }
                }

                occupants.delete(socket.fullJid);
                if (occupants.size === 0) {
                    server.mucRooms.delete(room);
                }
            }
        }
        server.mucMembers.delete(socket.fullJid);
    }

    const stanza = builder.build({
        'presence': {
            '@_from': socket.fullJid,
            '@_type': 'unavailable'
        }
    });

    for (const client of server.clients.values()) {
        if (client !== socket && client.authenticated) {
            client.write(stanza);
        }
    }
}