import tcpServer from '../tcp/index.js';

export default function (app) {
    app.post('/friend/request', async (req, res) => {
        const { from, to, status = 'PENDING', direction = 'OUTBOUND' } = req.body;

        if (!from) {
            return res.status(400).json({ error: 'Missing required field: from' });
        }

        if (!to) {
            return res.status(400).json({ error: 'Missing required field: to' });
        }

        try {
            const server = tcpServer.server;
            server.handleFriendRequest(from, to, status, direction);

            return res.json({
                success: true,
                from: from,
                to: to,
                status: status,
                direction: direction
            });
        } catch (error) {
            return res.status(500).json({
                error: 'Failed to send friend request',
                details: error.message
            });
        }
    });
}
