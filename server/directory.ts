import type * as Party from "partykit/server";

type RoomStatus = "LOBBY" | "ROUND_ACTIVE" | "ROUND_RESULTS" | "GAME_OVER";

type RoomEntry = {
  room: string;
  status: RoomStatus;
  players: number;
  updatedAt: number;
};

// A room that stops announcing itself is treated as gone. Live rooms heartbeat
// well inside this window, so the only entries this drops are genuinely dead —
// a game server that crashed or was redeployed mid-round.
const ROOM_TTL_MS = 90_000;

const SWEEP_INTERVAL_MS = 15_000;

/** "TESTROOM" -> "T*******" */
function maskRoomId(id: string): string {
  if (id.length <= 1) return id;
  return id[0] + "*".repeat(id.length - 1);
}

/**
 * Stable handle so the client can key the list across updates without ever
 * receiving the real room code. Not reversible: the code cannot be recovered
 * from this value, only compared against itself.
 */
function publicKey(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (Math.imul(31, hash) + id.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

/**
 * Singleton party (room id "index") holding the list of live games.
 *
 * PartyKit has no API to enumerate rooms, so each `GameServer` announces itself
 * here over HTTP whenever its status or head count changes. Clients connect
 * read-only and receive a masked view.
 */
export default class DirectoryServer implements Party.Server {
  rooms: Map<string, RoomEntry> = new Map();
  sweepInterval: ReturnType<typeof setInterval> | null = null;

  constructor(readonly room: Party.Room) {}

  onStart() {
    this.sweepInterval = setInterval(() => {
      if (this.expireStaleRooms()) this.broadcastRooms();
    }, SWEEP_INTERVAL_MS);
  }

  onConnect(conn: Party.Connection) {
    this.expireStaleRooms();
    conn.send(this.serializeRooms());
  }

  /** Announcements from game servers arrive as POSTs, not websocket messages. */
  async onRequest(req: Request) {
    if (req.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    try {
      const data = (await req.json()) as Partial<RoomEntry>;
      if (!data || typeof data.room !== "string" || !data.room) {
        return new Response("Bad request", { status: 400 });
      }

      const players = Number(data.players);
      if (Number.isFinite(players) && players > 0) {
        this.rooms.set(data.room, {
          room: data.room,
          status: (data.status as RoomStatus) ?? "LOBBY",
          players,
          updatedAt: Date.now(),
        });
      } else {
        // Empty room: drop it rather than advertising a game nobody is in.
        this.rooms.delete(data.room);
      }

      this.expireStaleRooms();
      this.broadcastRooms();
      return new Response("OK");
    } catch (err) {
      console.error("Rejected directory announcement:", err);
      return new Response("Bad request", { status: 400 });
    }
  }

  /** Returns true if anything expired. */
  expireStaleRooms(): boolean {
    const cutoff = Date.now() - ROOM_TTL_MS;
    let changed = false;
    for (const [id, entry] of this.rooms) {
      if (entry.updatedAt < cutoff) {
        this.rooms.delete(id);
        changed = true;
      }
    }
    return changed;
  }

  serializeRooms(): string {
    // The real room code never leaves this server. Masking in the client would
    // be decorative — the full code would still sit in the websocket frame for
    // anyone with devtools open.
    const rooms = Array.from(this.rooms.values())
      .sort((a, b) => b.players - a.players || a.room.localeCompare(b.room))
      .map((entry) => ({
        key: publicKey(entry.room),
        masked: maskRoomId(entry.room),
        status: entry.status,
        players: entry.players,
      }));

    return JSON.stringify({ type: "rooms", rooms });
  }

  broadcastRooms() {
    this.room.broadcast(this.serializeRooms());
  }
}
