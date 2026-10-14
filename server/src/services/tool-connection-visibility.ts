/** Original connection visibility shared by inventory and bounded readers.
 * Draft credentials/connection identity stay with their creator or manager. */
export function filterVisibleToolConnections<T extends { status?: string; createdByUserId?: string | null }>(
  connections: T[], actor: { userId?: string | null; canManageConnections: boolean },
): T[] {
  return connections.filter(connection => connection.status !== "draft" || actor.canManageConnections ||
    Boolean(actor.userId && connection.createdByUserId === actor.userId));
}
