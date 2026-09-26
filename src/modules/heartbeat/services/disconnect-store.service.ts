import { Injectable } from '@nestjs/common';

/**
 * Disconnect in-memory store service
 * Temporarily stores connection IDs that must be forcibly disconnected and keeps sending them to the client until the connection is actually closed
 */
@Injectable()
export class DisconnectStoreService {
  /**
   * key: device UUID, value: set of connection IDs to disconnect
   */
  private store = new Map<string, Set<number>>();

  /**
   * Add connections pending disconnect
   * @param deviceUuid Device UUID
   * @param connIds List of connection IDs to disconnect
   */
  addPendingDisconnects(deviceUuid: string, connIds: number[]): void {
    if (connIds.length === 0) return;

    const existing = this.store.get(deviceUuid);
    if (existing) {
      for (const connId of connIds) {
        existing.add(connId);
      }
    } else {
      this.store.set(deviceUuid, new Set(connIds));
    }
  }

  /**
   * Get the list of connections pending disconnect (without clearing)
   * Called on every heartbeat; keeps returning until the client confirms the disconnect (no longer reports the connId)
   * @param deviceUuid Device UUID
   * @returns List of connection IDs to disconnect, or an empty array if none
   */
  getPendingDisconnects(deviceUuid: string): number[] {
    const pending = this.store.get(deviceUuid);
    return pending ? Array.from(pending) : [];
  }

  /**
   * Remove disconnected connections
   * A connId no longer present in the conns reported by the client heartbeat has been disconnected successfully and is removed from the pending list
   * @param deviceUuid Device UUID
   * @param currentConns List of active connection IDs currently reported by the client
   */
  removeDisconnected(deviceUuid: string, currentConns: number[]): void {
    const pending = this.store.get(deviceUuid);
    if (!pending || pending.size === 0) return;

    const currentSet = new Set(currentConns);
    for (const connId of pending) {
      // The client no longer reports this connection, so it has been disconnected
      if (!currentSet.has(connId)) {
        pending.delete(connId);
      }
    }

    // If the pending list is empty, clean up the Map entry
    if (pending.size === 0) {
      this.store.delete(deviceUuid);
    }
  }
}
