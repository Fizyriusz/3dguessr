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
  heading?: number;
};

type GameStatus = "LOBBY" | "ROUND_ACTIVE" | "ROUND_RESULTS" | "GAME_OVER";

type Location = {
  lat: number;
  lng: number;
  name: string;
  modes: ("2D" | "3D")[];
};

const LOCATIONS: Location[] = [
  { lat: 52.2304, lng: 21.0044, name: "Pałac Kultury i Nauki (ul. Emilii Plater), Warszawa", modes: ["2D", "3D"] },
  { lat: 50.0626, lng: 19.9388, name: "Rynek Główny (przy Sukiennicach), Kraków", modes: ["2D", "3D"] },
  { lat: 51.1098, lng: 17.0315, name: "Rynek we Wrocławiu, Wrocław", modes: ["2D", "3D"] },
  { lat: 54.3486, lng: 18.6533, name: "Długi Targ (przy Fontannie Neptuna), Gdańsk", modes: ["2D", "3D"] },
  { lat: 52.4082, lng: 16.9348, name: "Stary Rynek (przy Ratuszu), Poznań", modes: ["2D", "3D"] },
  { lat: 49.2958, lng: 19.9519, name: "Krupówki (deptak), Zakopane", modes: ["2D"] },
  { lat: 53.0103, lng: 18.6046, name: "Rynek Staromiejski (przy Pomniku Kopernika), Toruń", modes: ["2D"] },
  { lat: 51.1143, lng: 17.0462, name: "Ostrów Tumski (przy Katedrze), Wrocław", modes: ["2D", "3D"] },
  { lat: 54.0405, lng: 19.0238, name: "Zamek w Malborku (most pieszy), Malbork", modes: ["2D"] },
  { lat: 54.4443, lng: 18.5645, name: "Deptak Bohaterów Monte Cassino, Sopot", modes: ["2D", "3D"] },
  
  // New 3D and 2D verified locations:
  { lat: 52.2299, lng: 20.9841, name: "Warsaw Spire (Rondo Daszyńskiego), Warszawa", modes: ["2D", "3D"] },
  { lat: 52.2473, lng: 21.0136, name: "Plac Zamkowy (przy Kolumnie Zygmunta), Warszawa", modes: ["2D", "3D"] },
  { lat: 52.2158, lng: 21.0353, name: "Pałac na Wyspie (Łazienki Królewskie), Warszawa", modes: ["2D", "3D"] },
  { lat: 50.0541, lng: 19.9367, name: "Wawel (Zamek Królewski - dziedziniec), Kraków", modes: ["2D", "3D"] },
  { lat: 50.0652, lng: 19.9416, name: "Barbakan krakowski, Kraków", modes: ["2D", "3D"] },
  { lat: 51.1070, lng: 17.0772, name: "Hala Stulecia (przed Iglicą), Wrocław", modes: ["2D", "3D"] },
  { lat: 54.3484, lng: 18.6558, name: "Zielona Brama (ul. Długa), Gdańsk", modes: ["2D", "3D"] },
  { lat: 54.3562, lng: 18.6607, name: "Muzeum II Wojny Światowej, Gdańsk", modes: ["2D", "3D"] },
  { lat: 51.7796, lng: 19.4478, name: "Rynek Manufaktury, Łódź", modes: ["2D", "3D"] },
  { lat: 51.7686, lng: 19.4563, name: "Ulica Piotrkowska, Łódź", modes: ["2D", "3D"] },
  { lat: 52.4080, lng: 16.9298, name: "Plac Wolności, Poznań", modes: ["2D", "3D"] },
  { lat: 51.2476, lng: 22.5683, name: "Brama Krakowska, Lublin", modes: ["2D", "3D"] },
  { lat: 51.2505, lng: 22.5719, name: "Zamek w Lublinie (dziedziniec), Lublin", modes: ["2D", "3D"] },
  { lat: 53.4302, lng: 14.5654, name: "Wały Chrobrego, Szczecin", modes: ["2D", "3D"] },
  { lat: 50.0374, lng: 22.0049, name: "Rynek (przy Ratuszu), Rzeszów", modes: ["2D", "3D"] }
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
  gameMode: "2D" | "3D" = "2D";
  
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
            lng: 21.0044,
            heading: 0
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
          if (data.heading !== undefined) {
            player.heading = Number(data.heading);
          }
          break;

        case "configure":
          // Settings updates (Host only, in LOBBY state)
          if (player.isHost && this.status === "LOBBY") {
            this.totalRounds = Math.max(1, Math.min(20, Number(data.totalRounds)));
            this.roundTimeLimit = Math.max(0, Math.min(600, Number(data.roundTimeLimit)));
            this.firstGuessTimerEnabled = Boolean(data.firstGuessTimerEnabled);
            this.firstGuessTimerDuration = Math.max(5, Math.min(120, Number(data.firstGuessTimerDuration)));
            if (data.gameMode === "2D" || data.gameMode === "3D") {
              this.gameMode = data.gameMode;
            }
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

    // Pick a random location supporting the current gameMode
    let availableIndices = LOCATIONS
      .map((_, i) => i)
      .filter(i => LOCATIONS[i].modes.includes(this.gameMode) && !this.usedLocationIndices.has(i));

    if (availableIndices.length === 0) {
      this.usedLocationIndices.clear();
      availableIndices = LOCATIONS
        .map((_, i) => i)
        .filter(i => LOCATIONS[i].modes.includes(this.gameMode));
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
      p.heading = 0;
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
      p.heading = 0;
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
      gameMode: this.gameMode,
      
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
