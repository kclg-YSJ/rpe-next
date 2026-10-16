/**
 * Types for the standalone collaboration server.
 *
 * The package is plain JavaScript with no build step and no declarations of its own, so this file
 * describes just the entry point the repository's tools import. It is picked up automatically when
 * `server.mjs` is imported, and it changes nothing about how the server runs.
 */

/** The options `startCollaborationServer` accepts. */
export interface CollaborationServerOptions {
  port?: number;
  host?: string;
  maxRooms?: number;
  maxMembers?: number;
  onStatus?: (status: unknown) => void;
  onDiagnostic?: (diagnostic: unknown) => void;
  creationKey?: string;
}

/** The running service, as returned once the HTTP and WebSocket listeners are up. */
export interface CollaborationService {
  /** The port actually bound, which is the chosen one when `port` was `0`. */
  port: number;
  /** The live rooms, keyed by room id. */
  rooms: Map<string, unknown>;
  close(): Promise<void>;
}

export function startCollaborationServer(options?: CollaborationServerOptions): Promise<CollaborationService>;
