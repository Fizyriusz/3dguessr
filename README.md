# Poland Guessr

Multiplayerowa gra geograficzna osadzona w Polsce — wariant GeoGuessr, w którym gracze
lądują w losowej polskiej lokalizacji i zgadują, gdzie są. Wszyscy w pokoju widzą się
nawzajem w czasie rzeczywistym.

Dwa tryby rozgrywki:

- **2D (Street View)** — chodzisz po panoramach Google, inni gracze widoczni jako kolorowe „fasolki"
- **3D (lot dronem)** — swobodny lot nad fotorealistyczną mapą 3D Google z modelem drona

## Wymagania

- Node.js 20+
- Klucz Google Maps Platform z włączonymi API:
  - **Maps JavaScript API** (Street View + biblioteka `maps3d`, kanał `v=alpha`)
  - **Elevation API** (używane do wyznaczenia wysokości terenu w trybie 3D)

> Klucz trafia do bundla przeglądarki — inaczej się nie da. Ustaw mu w Google Cloud
> Console **restrykcję HTTP referrer** na swoje domeny (oraz `localhost` do dewelopmentu)
> i włącz wyłącznie te dwa API.

## Konfiguracja

```bash
npm install
cp .env.example .env
```

Uzupełnij `.env`:

| Zmienna | Opis |
| --- | --- |
| `VITE_GOOGLE_MAPS_API_KEY` | Klucz Google Maps Platform. Bez niego mapy się nie załadują. |
| `VITE_PARTYKIT_HOST` | Adres serwera PartyKit. Lokalnie pomiń — domyślnie `localhost:1999`. |

## Uruchomienie

Gra potrzebuje **dwóch procesów** — frontendu i serwera stanu:

```bash
npm run party
```

```bash
npm run dev
```

Frontend wstaje na `http://localhost:5173`, serwer PartyKit na `localhost:1999`.

Pokój wybiera się parametrem w URL: `http://localhost:5173/?room=MOJPOKOJ`.
Bez parametru wszyscy lądują w `default-room`. Żeby przetestować multiplayer lokalnie,
otwórz kilka kart z tym samym `?room=`.

### Skrypty

| Skrypt | Działanie |
| --- | --- |
| `npm run dev` | Vite dev server (frontend) |
| `npm run party` | PartyKit dev server (stan gry, WebSocket) |
| `npm run build` | `tsc -b` + build produkcyjny |
| `npm run preview` | Podgląd builda produkcyjnego |
| `npm run lint` | ESLint |

## Architektura

```
przeglądarka                          PartyKit (Durable Object)
┌────────────────────────┐            ┌──────────────────────────┐
│ App.tsx                │            │ server/server.ts         │
│  ├─ StreetViewPlay 2D  │  WebSocket │  GameServer              │
│  ├─ GoogleMap3D    3D  │ ←────────→ │   - stan pokoju          │
│  ├─ RoadMap  (lobby)   │            │   - maszyna stanów rundy │
│  └─ GuessMap (typy)    │            │   - punktacja            │
└────────────────────────┘            └──────────────────────────┘
```

**Serwer jest autorytatywny.** Klient nie prowadzi predykcji — wysyła swoją pozycję,
a `GameServer` rozsyła pełny snapshot stanu do wszystkich **20 razy na sekundę**.
Jeden `GameServer` = jeden pokój, izolowany, z własnym stanem.

### Maszyna stanów

```
LOBBY ──start──► ROUND_ACTIVE ──koniec rundy──► ROUND_RESULTS ──┐
  ▲                                                  │          │
  │                                            next  │          │
  └──────────── reset_game ◄─── GAME_OVER ◄──────────┘◄─────────┘
```

Rundę kończy wyczerpanie czasu **albo** oddanie typu przez wszystkich graczy.

### Protokół WebSocket

Klient → serwer:

| Wiadomość | Kto | Opis |
| --- | --- | --- |
| `join` | każdy | rejestracja z nickiem |
| `leave` | każdy | wyjście z pokoju |
| `update` | każdy | pozycja: `lat`, `lng`, `heading`, `altitude` |
| `guess` | każdy | oddanie typu na mapie |
| `configure` | host | ustawienia gry (tylko w `LOBBY`) |
| `start` | host | start rozgrywki |
| `next` | host | następna runda / podsumowanie |
| `reset_game` | host | powrót do lobby, zerowanie punktów |

Serwer → klient: jeden typ, `sync` — pełny stan gry.

**Hostem** zostaje pierwsza osoba w pokoju. Po jej wyjściu rola przechodzi
automatycznie na kolejnego gracza.

### Punktacja

`5000 · e^(−0.008 · dystans_km)`, z pełnym wynikiem 5000 poniżej 25 metrów
([`server.ts`](server/server.ts)).

Dystans liczony jest od **rzeczywistego punktu spawnu**, nie od współrzędnych z listy
lokalizacji. Street View przyciąga gracza do najbliższej dostępnej panoramy, która
potrafi leżeć kilkadziesiąt metrów od zadanego punktu — bez tej korekty perfekcyjny
wynik byłby nieosiągalny (pola `spawnLat` / `spawnLng` / `hasSnapped`).

### Anty-spoiler

W trakcie rundy serwer **wycina z broadcastu** cudze typy, punkty, dystanse oraz nazwę
lokalizacji — nie da się ich podejrzeć w DevTools. Odsłaniane są dopiero w `ROUND_RESULTS`.

Uwaga: własne współrzędne gracza muszą trafić do przeglądarki, żeby Street View w ogóle
zadziałał, więc odpowiedź zawsze da się odczytać z zakładki Network. To ograniczenie
wynika z architektury i dotyczy każdej gry tego typu.

### Lokalizacje

Zahardkodowana lista w [`server/server.ts`](server/server.ts). Każdy wpis deklaruje
wspierane tryby:

```ts
{ lat: 52.2304, lng: 21.0044, name: "Pałac Kultury i Nauki, Warszawa", modes: ["2D", "3D"] }
```

Nie każde miejsce nadaje się na tryb 3D (potrzebne pokrycie fotorealistycznymi kaflami),
dlatego część ma tylko `["2D"]`. W obrębie jednej gry lokalizacje się nie powtarzają.

## Deployment

- **Frontend** — Vercel (build `npm run build`, katalog `dist`). Ustaw
  `VITE_GOOGLE_MAPS_API_KEY` i `VITE_PARTYKIT_HOST` w zmiennych środowiskowych projektu.
- **Serwer** — `npx partykit deploy`. Otrzymany host wpisz w `VITE_PARTYKIT_HOST`.

## Znane ograniczenia

- **Model drona jest statyczny.** Element `<gmp-model-3d>` renderuje glTF jako nieruchomą
  bryłę — nie ma API do odtwarzania animacji. Ruch (przechyły, obrót, pochylenie) jest
  symulowany przez interpolację `orientation` w [`GoogleMap3D.tsx`](src/components/GoogleMap3D.tsx).
  Pełne animacje wymagałyby nakładki Three.js renderowanej nad mapą.
- **Biblioteka `maps3d` działa na kanale `v=alpha`** — API Google może się zmienić bez zapowiedzi.
- **Brak obsługi dotyku.** Sterowanie opiera się na klawiaturze (WSAD), więc na telefonie
  gra jest praktycznie bezużyteczna.
- **Rozłączenie kosztuje postęp.** Reconnect dostaje nowe ID połączenia, a serwer traktuje
  gracza jak nowego — punkty przepadają.

## Struktura katalogów

```
server/           serwer PartyKit — cała logika gry
src/
  App.tsx         root: socket, HUD, routing stanów gry
  components/     StreetViewPlay (2D) · GoogleMap3D (3D) · RoadMap · GuessMap
  index.css       style globalne, motywy jasny/ciemny
public/models/    sample.glb — model drona
scratch/          jednorazowe skrypty deweloperskie (nieużywane w buildzie)
```
