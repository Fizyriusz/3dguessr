import type * as Party from "partykit/server";

type Player = {
  id: string;
  nickname: string;
  score: number;
  hasGuessed: boolean;
  guess: { lat: number; lng: number } | null;
  roundPoints: number;
  distance: number | null; // in km
  isHost: boolean;
  
  // Realtime geographical coordinates of the player's bean
  lat: number;
  lng: number;
};

type GameStatus = "LOBBY" | "ROUND_ACTIVE" | "ROUND_RESULTS" | "GAME_OVER";

const LOCATIONS = [
  { lat: 52.2304, lng: 21.0044, name: "Pałac Kultury i Nauki (ul. Emilii Plater), Warszawa" },
  { lat: 50.0626, lng: 19.9388, name: "Rynek Główny (przy Sukiennicach), Kraków" },
  { lat: 51.1098, lng: 17.0315, name: "Rynek we Wrocławiu, Wrocław" },
  { lat: 54.3486, lng: 18.6533, name: "Długi Targ (przy Fontannie Neptuna), Gdańsk" },
  { lat: 52.4082, lng: 16.9348, name: "Stary Rynek (przy Ratuszu), Poznań" },
  { lat: 49.2958, lng: 19.9519, name: "Krupówki (deptak), Zakopane" },
  { lat: 53.0103, lng: 18.6046, name: "Rynek Staromiejski (przy Pomniku Kopernika), Toruń" },
  { lat: 51.1143, lng: 17.0462, name: "Ostrów Tumski (przy Katedrze), Wrocław" },
  { lat: 54.0405, lng: 19.0238, name: "Zamek w Malborku (most pieszy), Malbork" },
  { lat: 54.4443, lng: 18.5645, name: "Deptak Bohaterów Monte Cassino, Sopot" }
];

function getDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in km
}

function calculateScore(distanceKm: number): number {
  if (distanceKm < 0.025) return 5000; // Perfect score < 25 meters
  const points = Math.round(5000 * Math.pow(Math.E, -0.008 * distanceKm));
  return Math.max(0, Math.min(5000, points));
}

export default class GameServer implements Party.Server {
  players: Map<string, Player> = new Map();
  status: GameStatus = "LOBBY";
  currentRound: number = 0;
  
  // Game settings (configurable by host)
  totalRounds: number = 5;
  roundTimeLimit: number = 60; // seconds, 0 = disabled/infinity
  firstGuessTimerEnabled: boolean = false;
  firstGuessTimerDuration: number = 20; // seconds
  countdownActive: boolean = false;
  
  timeRemaining: number = 60; // active timer
  targetLocation: typeof LOCATIONS[0] | null = null;
  usedLocationIndices: Set<number> = new Set();
  
  timerInterval: ReturnType<typeof setInterval> | null = null;
  tickInterval: ReturnType<typeof setInterval> | null = null;

  constructor(readonly room: Party.Room) {}

  onStart() {
    // Broadcast positions and game state 20 times per second
    this.tickInterval = setInterval(() => {
      this.broadcastState();
    }, 1000 / 20);
  }

  onConnect(conn: Party.Connection) {
    console.log("Connection established:", conn.id);
    // Don't auto-add to players map. They must send a "join" message first.
    this.broadcastState();
  }

  onMessage(message: string, sender: Party.Connection) {
    try {
      const data = JSON.parse(message);
      
      // If it's a join message, register the player profile
      if (data.type === "join") {
        if (!this.players.has(sender.id)) {
          const isHost = this.players.size === 0;
          this.players.set(sender.id, {
            id: sender.id,
            nickname: (data.nickname || "Player").trim().substring(0, 16),
            score: 0,
            hasGuessed: false,
            guess: null,
            roundPoints: 0,
            distance: null,
            isHost: isHost,
            lat: 52.2304,
            lng: 21.0044
          });
        } else {
          const p = this.players.get(sender.id)!;
          p.nickname = (data.nickname || "Player").trim().substring(0, 16);
        }
        this.broadcastState();
        return;
      }

      const player = this.players.get(sender.id);
      if (!player) return;

      switch (data.type) {
        case "leave":
          this.removePlayer(sender.id);
          this.broadcastState();
          break;

        case "update":
          // Realtime 2D coordinates sync
          player.lat = Number(data.lat);
          player.lng = Number(data.lng);
          break;

        case "configure":
          // Settings updates (Host only, in LOBBY state)
          if (player.isHost && this.status === "LOBBY") {
            this.totalRounds = Math.max(1, Math.min(20, Number(data.totalRounds)));
            this.roundTimeLimit = Math.max(0, Math.min(600, Number(data.roundTimeLimit)));
            this.firstGuessTimerEnabled = Boolean(data.firstGuessTimerEnabled);
            this.firstGuessTimerDuration = Math.max(5, Math.min(120, Number(data.firstGuessTimerDuration)));
          }
          break;

        case "start":
          if (player.isHost && this.status === "LOBBY") {
            this.startGame();
          }
          break;

        case "reset_game":
          // Force reset game to Lobby (Host only)
          if (player.isHost) {
            this.resetGame();
          }
          break;

        case "guess":
          if (this.status === "ROUND_ACTIVE" && !player.hasGuessed && this.targetLocation) {
            // Check if this is the first guess submitted in this round
            const isFirstGuess = Array.from(this.players.values()).every(p => !p.hasGuessed);

            player.guess = { lat: Number(data.lat), lng: Number(data.lng) };
            player.hasGuessed = true;
            
            player.distance = getDistance(
              player.guess.lat,
              player.guess.lng,
              this.targetLocation.lat,
              this.targetLocation.lng
            );
            player.roundPoints = calculateScore(player.distance);
            player.score += player.roundPoints;

            // Trigger Geoguessr-style countdown if enabled and this is the first guess
            if (isFirstGuess && this.firstGuessTimerEnabled) {
              if (this.roundTimeLimit === 0 || this.timeRemaining > this.firstGuessTimerDuration) {
                this.timeRemaining = this.firstGuessTimerDuration;
                this.countdownActive = true;
              }
            }

            // Check if all connected players have guessed
            const allGuessed = Array.from(this.players.values()).every(p => p.hasGuessed);
            if (allGuessed) {
              this.endRound();
            }
          }
          break;

        case "next":
          if (player.isHost) {
            if (this.status === "ROUND_RESULTS") {
              if (this.currentRound >= this.totalRounds) {
                this.status = "GAME_OVER";
              } else {
                this.startRound();
              }
            } else if (this.status === "GAME_OVER") {
              this.resetGame();
            }
          }
          break;
      }
    } catch (err) {
      console.error("Error processing message:", err);
    }
  }

  onClose(conn: Party.Connection) {
    console.log("Player disconnected:", conn.id);
    this.removePlayer(conn.id);
    this.broadcastState();
  }

  removePlayer(id: string) {
    const wasHost = this.players.get(id)?.isHost;
    this.players.delete(id);

    // Reassign host if needed
    if (wasHost && this.players.size > 0) {
      const firstPlayerId = Array.from(this.players.keys())[0];
      const newHost = this.players.get(firstPlayerId);
      if (newHost) {
        newHost.isHost = true;
      }
    }

    if (this.players.size === 0) {
      this.resetGameData();
    } else {
      if (this.status === "ROUND_ACTIVE") {
        const allGuessed = Array.from(this.players.values()).every(p => p.hasGuessed);
        if (allGuessed) {
          this.endRound();
        }
      }
    }
  }

  startGame() {
    this.resetGameData();
    this.startRound();
  }

  startRound() {
    this.status = "ROUND_ACTIVE";
    this.currentRound++;
    this.countdownActive = false;
    this.timeRemaining = this.roundTimeLimit > 0 ? this.roundTimeLimit : 999999;

    // Pick a random location
    let availableIndices = LOCATIONS.map((_, i) => i).filter(i => !this.usedLocationIndices.has(i));
    if (availableIndices.length === 0) {
      this.usedLocationIndices.clear();
      availableIndices = LOCATIONS.map((_, i) => i);
    }
    
    const randomIndex = availableIndices[Math.floor(Math.random() * availableIndices.length)];
    this.usedLocationIndices.add(randomIndex);
    this.targetLocation = LOCATIONS[randomIndex];

    // Reset players round-specific state & set them to the start position
    for (const p of this.players.values()) {
      p.hasGuessed = false;
      p.guess = null;
      p.roundPoints = 0;
      p.distance = null;
      
      // Reset position to round start position
      p.lat = this.targetLocation.lat;
      p.lng = this.targetLocation.lng;
    }

    if (this.timerInterval) clearInterval(this.timerInterval);
    this.timerInterval = setInterval(() => {
      // Tick down if a limit is set OR if the post-guess countdown is active
      if (this.roundTimeLimit > 0 || this.countdownActive) {
        this.timeRemaining--;
        if (this.timeRemaining <= 0) {
          this.endRound();
        }
      }
    }, 1000);
  }

  endRound() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }

    for (const p of this.players.values()) {
      if (!p.hasGuessed) {
        p.hasGuessed = true;
        p.guess = null;
        p.roundPoints = 0;
        p.distance = null;
      }
    }

    this.status = "ROUND_RESULTS";
  }

  resetGame() {
    this.resetGameData();
    this.status = "LOBBY";
  }

  resetGameData() {
    this.currentRound = 0;
    this.usedLocationIndices.clear();
    this.targetLocation = null;
    this.countdownActive = false;
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    for (const p of this.players.values()) {
      p.score = 0;
      p.hasGuessed = false;
      p.guess = null;
      p.roundPoints = 0;
      p.distance = null;
      p.lat = 52.2304;
      p.lng = 21.0044;
    }
  }

  broadcastState() {
    const state = {
      type: "sync",
      status: this.status,
      currentRound: this.currentRound,
      
      totalRounds: this.totalRounds,
      roundTimeLimit: this.roundTimeLimit,
      firstGuessTimerEnabled: this.firstGuessTimerEnabled,
      firstGuessTimerDuration: this.firstGuessTimerDuration,
      countdownActive: this.countdownActive,
      
      timeRemaining: this.timeRemaining,
      targetLocation: this.targetLocation ? {
        lat: this.targetLocation.lat,
        lng: this.targetLocation.lng,
        name: (this.status === "ROUND_RESULTS" || this.status === "GAME_OVER") ? this.targetLocation.name : ""
      } : null,
      players: Array.from(this.players.values())
    };
    this.room.broadcast(JSON.stringify(state));
  }
}
