import { useEffect, useState } from "react";
import usePartySocket from "partysocket/react";
import { StreetViewPlay } from "./components/StreetViewPlay";
import { RoadMap } from "./components/RoadMap";
import { GuessMap } from "./components/GuessMap";
import { Canvas } from "@react-three/fiber";
import { World3D } from "./components/World3D";
import { DronePlayer } from "./components/DronePlayer";
import "./index.css";

type Player = {
  id: string;
  nickname: string;
  score: number;
  hasGuessed: boolean;
  guess: { lat: number; lng: number } | null;
  roundPoints: number;
  distance: number | null;
  isHost: boolean;
  
  // Geographical coordinates
  lat: number;
  lng: number;
};

type GameState = {
  status: "LOBBY" | "ROUND_ACTIVE" | "ROUND_RESULTS" | "GAME_OVER";
  currentRound: number;
  totalRounds: number;
  roundTimeLimit: number;
  firstGuessTimerEnabled: boolean;
  firstGuessTimerDuration: number;
  countdownActive: boolean;
  timeRemaining: number;
  targetLocation: { lat: number; lng: number; name: string } | null;
  players: Player[];
  gameMode: "2D" | "3D";
};

function App() {
  // Read room from URL query parameters, default to "default-room"
  const roomId = new URLSearchParams(window.location.search).get("room") || "default-room";

  const socket = usePartySocket({
    host: import.meta.env.VITE_PARTYKIT_HOST || "localhost:1999",
    room: roomId,
  });

  const [gameState, setGameState] = useState<GameState>({
    status: "LOBBY",
    currentRound: 0,
    totalRounds: 5,
    roundTimeLimit: 60,
    firstGuessTimerEnabled: false,
    firstGuessTimerDuration: 20,
    countdownActive: false,
    timeRemaining: 60,
    targetLocation: null,
    players: [],
    gameMode: "2D",
  });

  // Client visual states
  const [nickname, setNickname] = useState(() => {
    return localStorage.getItem("poland_guessr_nickname") || "";
  });
  const [roomInput, setRoomInput] = useState(roomId);
  const [hasJoined, setHasJoined] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    return (localStorage.getItem("poland_guessr_theme") as "light" | "dark") || "dark";
  });
  const [copyFeedback, setCopyFeedback] = useState(false);

  // Sync theme class with body element
  useEffect(() => {
    const body = document.body;
    if (theme === "light") {
      body.classList.add("theme-light");
      body.classList.remove("theme-dark");
    } else {
      body.classList.add("theme-dark");
      body.classList.remove("theme-light");
    }
    localStorage.setItem("poland_guessr_theme", theme);
  }, [theme]);

  // Sync state from PartyKit
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === "sync") {
          setGameState(data);
        }
      } catch (err) {
        console.error("Error reading socket message:", err);
      }
    };

    socket.addEventListener("message", handleMessage);
    return () => socket.removeEventListener("message", handleMessage);
  }, [socket]);

  // Handle lobby Keyboard movement (W/S/A/D) directly on the Leaflet grid map
  useEffect(() => {
    const handleLobbyKeyDown = (e: KeyboardEvent) => {
      if (gameState.status !== "LOBBY" || !hasJoined) return;

      const key = e.key.toLowerCase();
      const localP = gameState.players.find(p => p.id === socket.id);
      if (!localP) return;

      const step = 0.00015; // movement step in degrees (~15 meters)
      let nextLat = localP.lat;
      let nextLng = localP.lng;

      if (key === "w" || e.key === "ArrowUp") nextLat += step;
      else if (key === "s" || e.key === "ArrowDown") nextLat -= step;
      else if (key === "a" || e.key === "ArrowLeft") nextLng -= step;
      else if (key === "d" || e.key === "ArrowRight") nextLng += step;
      else return; // Ignore other keys

      // Send position update
      socket.send(JSON.stringify({
        type: "update",
        lat: nextLat,
        lng: nextLng
      }));
    };

    window.addEventListener("keydown", handleLobbyKeyDown);
    return () => window.removeEventListener("keydown", handleLobbyKeyDown);
  }, [gameState.status, gameState.players, hasJoined, socket]);

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nickname.trim()) return;
    
    // Save nickname
    localStorage.setItem("poland_guessr_nickname", nickname);

    // If the room input in main menu differs from the current active socket room, redirect to it
    const targetRoom = roomInput.trim() || "default-room";
    if (targetRoom !== roomId) {
      window.location.search = `?room=${encodeURIComponent(targetRoom)}`;
      return;
    }

    socket.send(JSON.stringify({ type: "join", nickname }));
    setHasJoined(true);
  };

  const handleCreateRandomRoom = () => {
    const randomCode = Math.random().toString(36).substring(2, 7).toUpperCase();
    window.location.search = `?room=${randomCode}`;
  };

  const handleStartGame = () => {
    socket.send(JSON.stringify({ type: "start" }));
  };

  const handleResetGame = () => {
    if (confirm("Czy na pewno chcesz zresetować rozgrywkę i wrócić do poczekalni? Wszystkie punkty zostaną wyzerowane.")) {
      socket.send(JSON.stringify({ type: "reset_game" }));
    }
  };

  const handleLeave = () => {
    if (gameState.status !== "LOBBY" && !confirm("Czy na pewno chcesz opuścić aktywną grę i wrócić do menu?")) {
      return;
    }
    socket.send(JSON.stringify({ type: "leave" }));
    setHasJoined(false);
  };

  const handleConfigChange = (settings: Partial<GameState>) => {
    socket.send(JSON.stringify({
      type: "configure",
      totalRounds: settings.totalRounds ?? gameState.totalRounds,
      roundTimeLimit: settings.roundTimeLimit ?? gameState.roundTimeLimit,
      firstGuessTimerEnabled: settings.firstGuessTimerEnabled ?? gameState.firstGuessTimerEnabled,
      firstGuessTimerDuration: settings.firstGuessTimerDuration ?? gameState.firstGuessTimerDuration,
      gameMode: settings.gameMode ?? gameState.gameMode
    }));
  };

  const handleCopyLink = () => {
    const shareUrl = window.location.href;
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    });
  };

  // Handle movements triggered inside StreetView
  const handleLocationChange = (lat: number, lng: number) => {
    if (gameState.status === "ROUND_ACTIVE") {
      socket.send(JSON.stringify({
        type: "update",
        lat,
        lng
      }));
    }
  };

  const handleGuessSubmit = (lat: number, lng: number) => {
    socket.send(JSON.stringify({ type: "guess", lat, lng }));
  };

  const handleNextRound = () => {
    socket.send(JSON.stringify({ type: "next" }));
  };

  const localPlayer = gameState.players.find((p) => p.id === socket.id);
  const isHost = localPlayer?.isHost || false;
  const hasGuessed = localPlayer?.hasGuessed || false;

  const sortedPlayers = [...gameState.players].sort((a, b) => b.score - a.score);

  // Show Main Menu instead of login modal
  const showMainMenu = !hasJoined;

  return (
    <div style={{ width: "100vw", height: "100vh", position: "relative", overflow: "hidden", backgroundColor: "var(--bg-color)" }}>
      
      {/* Floating Theme Toggle */}
      <button 
        className="glass-panel"
        style={{
          position: "absolute",
          top: "20px",
          right: "20px",
          zIndex: 40,
          width: "44px",
          height: "44px",
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          fontSize: "18px",
          color: "var(--text-color)",
          background: "var(--glass-bg)"
        }}
        onClick={() => setTheme(prev => prev === "light" ? "dark" : "light")}
        title={theme === "light" ? "Tryb ciemny" : "Tryb jasny"}
      >
        {theme === "light" ? "🌙" : "☀️"}
      </button>

      {/* 1. Main Menu / Nickname & Room Select */}
      {showMainMenu && (
        <div 
          style={{
            position: "absolute",
            width: "100%",
            height: "100%",
            backgroundColor: "rgba(13, 12, 29, 0.75)",
            backdropFilter: "blur(12px)",
            zIndex: 30,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            padding: "20px",
            boxSizing: "border-box"
          }}
        >
          <div 
            className="glass-panel animate-zoom-in"
            style={{
              width: "100%",
              maxWidth: "440px",
              padding: "40px",
              textAlign: "center",
              display: "flex",
              flexDirection: "column",
              gap: "24px"
            }}
          >
            <div>
              <h1 style={{ 
                fontSize: "36px", 
                margin: "0 0 8px 0", 
                fontWeight: 900,
                background: "linear-gradient(135deg, #6366f1 0%, #a78bfa 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent"
              }}>
                POLAND GUESSR
              </h1>
              <p style={{ color: "var(--text-secondary)", fontSize: "14px", margin: 0, fontWeight: 500 }}>
                Spaceruj po polskich ulicach w Street View na żywo z innymi graczami!
              </p>
            </div>

            <form onSubmit={handleJoin} style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              <div style={{ textAlign: "left", display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-secondary)" }}>Wpisz swój pseudonim</label>
                <input
                  type="text"
                  placeholder="np. FasolowyMistrz"
                  className="custom-input"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  maxLength={16}
                  required
                  autoFocus
                />
              </div>

              <div style={{ textAlign: "left", display: "flex", flexDirection: "column", gap: "6px" }}>
                <label style={{ fontSize: "12px", fontWeight: 700, color: "var(--text-secondary)" }}>Nazwa/Kod pokoju</label>
                <input
                  type="text"
                  placeholder="default-room"
                  className="custom-input"
                  value={roomInput}
                  onChange={(e) => setRoomInput(e.target.value.trim().substring(0, 20))}
                  maxLength={20}
                  required
                />
              </div>
              
              <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "8px" }}>
                <button type="submit" className="btn-primary" style={{ padding: "12px 24px", fontSize: "15px" }}>
                  Wejdź do pokoju
                </button>
                
                <button 
                  type="button" 
                  className="btn-secondary" 
                  style={{ padding: "10px 20px", fontSize: "13px" }}
                  onClick={handleCreateRandomRoom}
                >
                  🎲 Stwórz losowy pokój
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 2. HUD: Timer, Round Info & Post-guess countdown (ROUND_ACTIVE & LOBBY) */}
      {hasJoined && (gameState.status === "ROUND_ACTIVE" || gameState.status === "LOBBY") && (
        <div 
          className="glass-panel"
          style={{
            position: "absolute",
            top: "20px",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 20,
            padding: "10px 24px",
            display: "flex",
            alignItems: "center",
            gap: "24px",
            pointerEvents: "none"
          }}
        >
          {gameState.status === "ROUND_ACTIVE" ? (
            <>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: "11px", color: "var(--text-secondary)", fontWeight: 700, textTransform: "uppercase" }}>Runda</div>
                <div style={{ fontSize: "18px", fontWeight: 900 }}>
                  {gameState.currentRound} / {gameState.totalRounds}
                </div>
              </div>
              <div style={{ width: "1px", height: "24px", background: "var(--glass-border)" }} />
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: "11px", color: "var(--text-secondary)", fontWeight: 700, textTransform: "uppercase" }}>
                  {gameState.countdownActive ? "Typowanie końcowe!" : "Pozostały czas"}
                </div>
                <div 
                  className={gameState.countdownActive ? "animate-pulse" : ""}
                  style={{ 
                    fontSize: "20px", 
                    fontWeight: 900, 
                    color: gameState.countdownActive || gameState.timeRemaining <= 10 ? "#ef4444" : "#10b981"
                  }}
                >
                  {gameState.roundTimeLimit === 0 && !gameState.countdownActive ? "∞" : `${gameState.timeRemaining}s`}
                </div>
              </div>
            </>
          ) : (
            <div style={{ fontSize: "15px", fontWeight: 800, color: "#6366f1" }}>
              POCZEKALNIA (Biegaj fasolką [WSAD])
            </div>
          )}
        </div>
      )}

      {/* 3. Players & Settings Sidebar List (ROUND_ACTIVE & LOBBY) */}
      {hasJoined && (gameState.status === "ROUND_ACTIVE" || gameState.status === "LOBBY") && (
        <div 
          className="glass-panel"
          style={{
            position: "absolute",
            top: "20px",
            left: "20px",
            zIndex: 20,
            width: "260px",
            padding: "20px",
            display: "flex",
            flexDirection: "column",
            gap: "16px",
            maxHeight: "calc(100vh - 100px)",
            overflowY: "auto"
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 800, color: "var(--text-color)" }}>Lista Graczy</h3>
              <span style={{ fontSize: "11px", color: "var(--text-secondary)", marginTop: "2px" }}>
                Pokój: <b style={{ color: "#6366f1" }}>{roomId}</b>
              </span>
            </div>
            {isHost && gameState.status !== "LOBBY" && (
              <button 
                onClick={handleResetGame} 
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: "16px", padding: 0 }}
                title="Zresetuj i wróć do lobby"
              >
                🔄
              </button>
            )}
          </div>

          {/* Copy Room Link & Leave Buttons */}
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <button 
              className="btn-secondary" 
              style={{ padding: "6px 12px", fontSize: "12px", width: "100%", fontWeight: 700 }}
              onClick={handleCopyLink}
            >
              {copyFeedback ? "✓ Skopiowano!" : "🔗 Kopiuj link zaproszenia"}
            </button>
            
            {gameState.status === "LOBBY" && (
              <button 
                className="btn-secondary" 
                style={{ padding: "6px 12px", fontSize: "12px", width: "100%", fontWeight: 700, borderColor: "rgba(239, 68, 68, 0.4)", color: "#ef4444" }}
                onClick={handleLeave}
              >
                🚪 Opuść pokój
              </button>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {sortedPlayers.map((player) => (
              <div 
                key={player.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "10px 12px",
                  background: "var(--item-bg)",
                  borderRadius: "10px",
                  border: player.id === socket.id ? "1px solid rgba(99, 102, 241, 0.3)" : "1px solid transparent"
                }}
              >
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: "13px", fontWeight: 700, color: player.id === socket.id ? "#6366f1" : "var(--text-color)" }}>
                    {player.nickname}
                  </span>
                  <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>{player.score} pkt</span>
                </div>
                
                {gameState.status === "ROUND_ACTIVE" ? (
                  player.hasGuessed ? (
                    <span style={{ color: "#10b981", background: "rgba(16, 185, 129, 0.15)", fontSize: "10px", fontWeight: 700, padding: "2px 8px", borderRadius: "20px" }}>Zgadł</span>
                  ) : (
                    <span style={{ color: "#f59e0b", background: "rgba(245, 158, 11, 0.15)", fontSize: "10px", fontWeight: 700, padding: "2px 8px", borderRadius: "20px" }}>Myśli...</span>
                  )
                ) : (
                  player.isHost && <span style={{ color: "#a78bfa", background: "rgba(99, 102, 241, 0.15)", fontSize: "10px", fontWeight: 700, padding: "2px 8px", borderRadius: "20px" }}>HOST</span>
                )}
              </div>
            ))}
          </div>

          {/* Lobby Configuration Panel */}
          {gameState.status === "LOBBY" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "14px", borderTop: "1px solid var(--glass-border)", paddingTop: "14px" }}>
              {isHost ? (
                <>
                  <h4 style={{ margin: 0, fontSize: "13px", color: "var(--text-color)", fontWeight: 800 }}>Ustawienia gry (Host)</h4>
                  
                  <div className="settings-group">
                    <label className="settings-label">Tryb gry</label>
                    <select 
                      className="settings-select"
                      value={gameState.gameMode || "2D"}
                      onChange={(e) => handleConfigChange({ gameMode: e.target.value as "2D" | "3D" })}
                    >
                      <option value="2D">2D (Street View)</option>
                      <option value="3D">3D (Lot drona)</option>
                    </select>
                  </div>

                  <div className="settings-group">
                    <label className="settings-label">Liczba rund</label>
                    <select 
                      className="settings-select"
                      value={gameState.totalRounds}
                      onChange={(e) => handleConfigChange({ totalRounds: Number(e.target.value) })}
                    >
                      <option value={3}>3 rundy</option>
                      <option value={5}>5 rund</option>
                      <option value={7}>7 rund</option>
                      <option value={10}>10 rund</option>
                    </select>
                  </div>

                  <div className="settings-group">
                    <label className="settings-label">Czas na rundę</label>
                    <select 
                      className="settings-select"
                      value={gameState.roundTimeLimit}
                      onChange={(e) => handleConfigChange({ roundTimeLimit: Number(e.target.value) })}
                    >
                      <option value={0}>Brak limitu (∞)</option>
                      <option value={30}>30 sekund</option>
                      <option value={60}>60 sekund (1 min)</option>
                      <option value={120}>120 sekund (2 min)</option>
                      <option value={180}>180 sekund (3 min)</option>
                    </select>
                  </div>

                  <div className="settings-group">
                    <label className="settings-checkbox-container">
                      <input 
                        type="checkbox"
                        checked={gameState.firstGuessTimerEnabled}
                        onChange={(e) => handleConfigChange({ firstGuessTimerEnabled: e.target.checked })}
                      />
                      Czas po pierwszym typie
                    </label>
                    {gameState.firstGuessTimerEnabled && (
                      <select 
                        className="settings-select"
                        value={gameState.firstGuessTimerDuration}
                        onChange={(e) => handleConfigChange({ firstGuessTimerDuration: Number(e.target.value) })}
                      >
                        <option value={15}>15 sekund</option>
                        <option value={20}>20 sekund</option>
                        <option value={30}>30 sekund</option>
                      </select>
                    )}
                  </div>

                  <button className="btn-primary" style={{ width: "100%", padding: "10px 16px", fontSize: "14px", marginTop: "6px" }} onClick={handleStartGame}>
                    Rozpocznij grę
                  </button>
                </>
              ) : (
                <>
                  <h4 style={{ margin: 0, fontSize: "13px", color: "var(--text-color)", fontWeight: 800 }}>Ustawienia gry</h4>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px", fontSize: "12px", color: "var(--text-secondary)" }}>
                    <div>Tryb gry: <b style={{ color: "var(--text-color)" }}>{gameState.gameMode === "3D" ? "3D (Lot drona)" : "2D (Street View)"}</b></div>
                    <div>Liczba rund: <b style={{ color: "var(--text-color)" }}>{gameState.totalRounds}</b></div>
                    <div>Czas na rundę: <b style={{ color: "var(--text-color)" }}>{gameState.roundTimeLimit > 0 ? `${gameState.roundTimeLimit}s` : "Brak limitu (∞)"}</b></div>
                    <div>Czas po pierwszym typie: <b style={{ color: "var(--text-color)" }}>{gameState.firstGuessTimerEnabled ? `${gameState.firstGuessTimerDuration}s` : "Wyłączony"}</b></div>
                  </div>
                  <div style={{ color: "var(--text-secondary)", fontStyle: "italic", fontSize: "11px", textAlign: "center", marginTop: "4px" }}>
                    Oczekiwanie aż host wystartuje...
                  </div>
                </>
              )}
            </div>
          )}

          {/* Leave Button during active games at the bottom of the sidebar */}
          {gameState.status !== "LOBBY" && (
            <button 
              className="btn-secondary" 
              style={{ padding: "8px 12px", fontSize: "12px", width: "100%", fontWeight: 700, borderColor: "rgba(239, 68, 68, 0.4)", color: "#ef4444", marginTop: "auto" }}
              onClick={handleLeave}
            >
              🚪 Opuść grę (Menu)
            </button>
          )}
        </div>
      )}

      {/* 4. Active Game Split Screen (ROUND_ACTIVE) */}
      {hasJoined && gameState.status === "ROUND_ACTIVE" && (
        <div className="split-screen" style={{ zIndex: 5 }}>
          {/* Left panel: Interactive Street View or 3D Drone Flight */}
          <div style={{ position: "relative", width: "100%", height: "100%" }}>
            {gameState.gameMode === "3D" ? (
              <div style={{ width: "100%", height: "100%", background: "#0c0a09" }}>
                <Canvas shadows camera={{ fov: 60, near: 0.1, far: 2000, position: [0, 55, 10] }}>
                  <World3D targetLocation={gameState.targetLocation} />
                  <DronePlayer 
                    targetLocation={gameState.targetLocation} 
                    onLocationChange={handleLocationChange} 
                  />
                </Canvas>
                {/* Guide overlay for 3D Mode */}
                <div 
                  className="glass-panel animate-fade-in"
                  style={{
                    position: "absolute",
                    bottom: "20px",
                    left: "20px",
                    padding: "10px 20px",
                    fontSize: "13px",
                    color: "#818cf8",
                    fontWeight: 600,
                    zIndex: 100,
                    pointerEvents: "none",
                    borderLeft: "4px solid #6366f1"
                  }}
                >
                  🛸 Tryb 3D: Pilotowanie drona | ⌨️ Sterowanie: **[W][A][S][D]** (Ruch w poziomie) | Wysokość zablokowana na 50m
                </div>
              </div>
            ) : (
              <>
                {gameState.targetLocation && (
                  <StreetViewPlay
                    lat={localPlayer ? localPlayer.lat : gameState.targetLocation.lat}
                    lng={localPlayer ? localPlayer.lng : gameState.targetLocation.lng}
                    onLocationChange={handleLocationChange}
                    players={gameState.players}
                    localPlayerId={socket.id}
                  />
                )}
                {/* Guide overlay */}
                <div 
                  className="glass-panel"
                  style={{
                    position: "absolute",
                    bottom: "20px",
                    left: "20px",
                    padding: "10px 20px",
                    fontSize: "13px",
                    color: "#fbbf24",
                    fontWeight: 600,
                    zIndex: 100,
                    pointerEvents: "none"
                  }}
                >
                  ⌨️ Sterowanie: [W]/[S] - Idź przód/tył | [A]/[D] - Obrót kamery
                </div>
              </>
            )}
          </div>

          {/* Right panel: Stylized Road Map showing the beans */}
          <RoadMap players={gameState.players} localPlayerId={socket.id} theme={theme} />
        </div>
      )}

      {/* 5. Lobby Background Map (LOBBY - full screen road grid map) */}
      {hasJoined && gameState.status === "LOBBY" && (
        <div style={{ width: "100%", height: "100%", position: "absolute", top: 0, left: 0, zIndex: 5 }}>
          <RoadMap players={gameState.players} localPlayerId={socket.id} theme={theme} />
          {/* Guide Overlay for Lobby */}
          <div 
            className="glass-panel animate-fade-in"
            style={{
              position: "absolute",
              bottom: "40px",
              left: "50%",
              transform: "translateX(-50%)",
              padding: "16px 28px",
              zIndex: 10,
              textAlign: "center"
            }}
          >
            <h3 style={{ fontSize: "16px", margin: "0 0 6px 0", color: "var(--text-color)" }}>Rozgrzewka przed grą</h3>
            <p style={{ fontSize: "13px", margin: 0, color: "var(--text-secondary)" }}>
              Użyj klawiszy **[W][A][S][D]** lub strzałek na klawiaturze, aby pobiegać swoją fasolką po mapie!
            </p>
          </div>
        </div>
      )}

      {/* 6. Results Screen Sidebar (ROUND_RESULTS) */}
      {hasJoined && gameState.status === "ROUND_RESULTS" && (
        <div 
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "360px",
            height: "100%",
            background: "var(--sidebar-bg)",
            borderRight: "1px solid var(--glass-border)",
            padding: "24px",
            display: "flex",
            flexDirection: "column",
            gap: "24px",
            zIndex: 25,
            overflowY: "auto",
            boxSizing: "border-box"
          }}
        >
          <div>
            <div style={{ fontSize: "12px", color: "var(--text-secondary)", fontWeight: 700, textTransform: "uppercase" }}>
              Wyniki Rundy {gameState.currentRound} / {gameState.totalRounds}
            </div>
            <h2 style={{ fontSize: "20px", fontWeight: 800, margin: "6px 0 0 0", color: "var(--text-color)" }}>
              {gameState.targetLocation?.name}
            </h2>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <h3 style={{ margin: 0, fontSize: "16px", color: "var(--text-color)" }}>Tabela rundy</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {sortedPlayers.map((player) => (
                <div 
                  key={player.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "12px",
                    background: player.id === socket.id ? "rgba(99, 102, 241, 0.08)" : "var(--item-bg)",
                    borderRadius: "12px",
                    border: player.id === socket.id ? "1px solid rgba(99, 102, 241, 0.25)" : "1px solid transparent"
                  }}
                >
                  <div>
                    <div style={{ fontSize: "14px", fontWeight: 700, color: player.id === socket.id ? "#6366f1" : "var(--text-color)" }}>
                      {player.nickname}
                    </div>
                    <div style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
                      {player.guess ? `${player.distance?.toFixed(1)} km` : "Nie zgadł w porę"}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: "14px", fontWeight: 700, color: "#10b981" }}>
                      +{player.roundPoints} pkt
                    </div>
                    <div style={{ fontSize: "11px", color: "var(--text-secondary)" }}>Suma: {player.score}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ marginTop: "auto", paddingTop: "20px", display: "flex", flexDirection: "column", gap: "10px" }}>
            {isHost ? (
              <>
                <button className="btn-primary" style={{ width: "100%" }} onClick={handleNextRound}>
                  {gameState.currentRound >= gameState.totalRounds ? "Podsumowanie gry" : "Następna runda"}
                </button>
                <button className="btn-secondary" style={{ width: "100%" }} onClick={handleResetGame}>
                  Powrót do lobby (Reset)
                </button>
              </>
            ) : (
              <div className="glass-panel" style={{ padding: "12px", textAlign: "center", color: "var(--text-secondary)", fontSize: "13px", fontStyle: "italic" }}>
                Oczekiwanie na decyzję hosta...
              </div>
            )}
            <button className="btn-secondary" style={{ width: "100%", borderColor: "rgba(239, 68, 68, 0.4)", color: "#ef4444" }} onClick={handleLeave}>
              🚪 Wyjdź do menu
            </button>
          </div>
        </div>
      )}

      {/* 7. Game Over Screen Overlay (GAME_OVER) */}
      {hasJoined && gameState.status === "GAME_OVER" && (
        <div 
          style={{
            position: "absolute",
            width: "100%",
            height: "100%",
            backgroundColor: "rgba(13, 12, 29, 0.9)",
            zIndex: 30,
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            padding: "20px",
            boxSizing: "border-box"
          }}
        >
          <div 
            className="glass-panel animate-zoom-in"
            style={{
              width: "100%",
              maxWidth: "540px",
              padding: "40px",
              textAlign: "center",
              display: "flex",
              flexDirection: "column",
              gap: "24px"
            }}
          >
            <div>
              <h1 style={{ 
                fontSize: "32px", 
                margin: "0 0 8px 0", 
                fontWeight: 900,
                background: "linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent"
              }}>
                KONIEC ROZGRYWKI
              </h1>
              <p style={{ color: "#94a3b8", fontSize: "15px", margin: 0, fontWeight: 500 }}>
                Podsumowanie gry ukończonej w {gameState.totalRounds} rundach:
              </p>
            </div>

            {/* Podium */}
            <div style={{ display: "flex", justifyContent: "center", alignItems: "flex-end", gap: "12px", height: "140px", margin: "10px 0" }}>
              {sortedPlayers[1] && (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <span style={{ fontSize: "13px", fontWeight: 700, color: "white" }}>{sortedPlayers[1].nickname}</span>
                  <span style={{ fontSize: "11px", color: "#cbd5e1", marginBottom: "4px" }}>{sortedPlayers[1].score} pkt</span>
                  <div style={{ width: "60px", height: "60px", background: "linear-gradient(180deg, #cbd5e1 0%, #64748b 100%)", borderRadius: "8px 8px 0 0", display: "flex", justifyContent: "center", alignItems: "center", fontSize: "18px", fontWeight: 900, color: "#334155" }}>2</div>
                </div>
              )}
              {sortedPlayers[0] && (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <span style={{ fontSize: "15px", fontWeight: 800, color: "#fbbf24" }}>👑 {sortedPlayers[0].nickname}</span>
                  <span style={{ fontSize: "12px", color: "#fef3c7", marginBottom: "4px" }}>{sortedPlayers[0].score} pkt</span>
                  <div style={{ width: "80px", height: "85px", background: "linear-gradient(180deg, #fbbf24 0%, #d97706 100%)", borderRadius: "8px 8px 0 0", display: "flex", justifyContent: "center", alignItems: "center", fontSize: "28px", fontWeight: 900, color: "#78350f", boxShadow: "0 0 15px rgba(251, 191, 36, 0.3)" }}>1</div>
                </div>
              )}
              {sortedPlayers[2] && (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                  <span style={{ fontSize: "13px", fontWeight: 700, color: "white" }}>{sortedPlayers[2].nickname}</span>
                  <span style={{ fontSize: "11px", color: "#cbd5e1", marginBottom: "4px" }}>{sortedPlayers[2].score} pkt</span>
                  <div style={{ width: "60px", height: "45px", background: "linear-gradient(180deg, #b45309 0%, #78350f 100%)", borderRadius: "8px 8px 0 0", display: "flex", justifyContent: "center", alignItems: "center", fontSize: "16px", fontWeight: 900, color: "#fef3c7" }}>3</div>
                </div>
              )}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {isHost ? (
                <>
                  <button className="btn-primary" style={{ width: "100%" }} onClick={handleNextRound}>
                    Zagraj ponownie
                  </button>
                  <button className="btn-secondary" style={{ width: "100%" }} onClick={handleResetGame}>
                    Powrót do lobby (Reset)
                  </button>
                </>
              ) : (
                <div style={{ color: "#94a3b8", fontStyle: "italic", fontSize: "14px" }}>
                  Oczekiwanie na decyzję hosta o restarcie...
                </div>
              )}
              <button className="btn-secondary" style={{ width: "100%", borderColor: "rgba(239, 68, 68, 0.4)", color: "#ef4444" }} onClick={handleLeave}>
                🚪 Wyjdź do menu
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 8. Guessing Map Layer (ROUND_ACTIVE minimap, ROUND_RESULTS & GAME_OVER full screen map) */}
      {hasJoined && gameState.status !== "LOBBY" && (
        <div 
          style={
            gameState.status === "ROUND_RESULTS" || gameState.status === "GAME_OVER"
              ? { width: "100%", height: "100%", zIndex: 10, position: "absolute", top: 0, left: 0 }
              : { zIndex: 25 }
          }
        >
          <GuessMap
            status={gameState.status}
            players={gameState.players}
            targetLocation={gameState.targetLocation}
            onGuessSubmit={handleGuessSubmit}
            hasGuessed={hasGuessed}
            theme={theme}
          />
        </div>
      )}

    </div>
  );
}

export default App;
