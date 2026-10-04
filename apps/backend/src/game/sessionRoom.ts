// User-facing room IDs never contain ':'. A separate namespace prevents
// collisions with Socket.IO's automatically created private socket rooms.
export const sessionRoom = (sessionId: string) => `session:${sessionId}`;
