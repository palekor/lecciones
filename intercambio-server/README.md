# ProfGermandario Intercambio V2

## What changed
- Removes Firebase Auth/Firestore from the exchange flow.
- Socket.IO handles the waiting queue and WebRTC signaling.
- No account, email, or registration.
- WebRTC carries text/voice directly between browsers after signaling.
- 10-minute soft conversation timer.
- AI topic endpoint with safe fallback bank.
- Report endpoint stores only a SHA-256 session hash + minimal metadata.
- Optional Twilio TURN credentials are generated server-side.
- ProfGermandario / embudo.html visual direction: purple, violet, pink, orange, gold; rounded cards and CTA.

## Files
- `intercambio-v2.html` -> upload this to GitHub Pages.
- `server.js` -> deploy as a Node.js service.
- `.env.example` -> environment variables.
- `package.json` -> dependencies.

## 1. Deploy the backend
Use any Node 20+ host that supports long-lived WebSocket connections (Render, Railway, Fly.io, a VPS, etc.).

Commands:
npm install
npm start

The backend exposes:
GET /health
GET /api/ice-servers
POST /api/topic
POST /api/report

Socket.IO namespace is the default root.

## 2. Configure the frontend
Open `intercambio-v2.html` and replace:
const SIGNALING_URL = "https://YOUR-SIGNALING-SERVER.example.com";

with your real backend URL.

Then upload `intercambio-v2.html` to:
https://palekor.github.io/lecciones/intercambio.html

If you keep the filename `intercambio-v2.html`, use that URL instead.

## 3. TURN
STUN is enough for many connections, but voice can fail behind restrictive NAT/firewalls.
Add Twilio credentials to the backend. The backend requests short-lived ICE credentials; the secret never reaches the browser.

Important: Twilio STUN is free, but TURN is usage-based. The current Twilio pricing page lists TURN at $0.40/GB in several regions and higher in some regions. A trial is time-limited; do not treat it as permanently free.

## 4. AI topics
Without OPENAI_API_KEY, the app still works using a local safe topic bank.
With the key set, `/api/topic` asks the model for a fresh A2-B2 bilingual topic.
The API key stays on the backend.

## 5. Reports
For production, configure Upstash Redis:
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN

The browser sends only a SHA-256 hash of the anonymous session ID, not an email or account identity.

## 6. Security / moderation
This is peer-to-peer and not live moderated. Keep the 18+ gate and safety language.
The server should never log message contents. The current server does not relay chat text; it relays only WebRTC signaling.

## 7. Testing
Open the page in two separate browsers/devices:
A: Spanish -> English
B: English -> Spanish
Choose the same mode.
Both should match within seconds.
For voice, allow microphone access on both browsers.

## Architecture
GitHub Pages
   |
   | Socket.IO
   v
Node signaling server
   |                |              \ /api/topic -> OpenAI (optional)
   |               \ /api/report -> Upstash Redis (optional)
   |
   +---- WebRTC offer/answer/ICE ----+
                                    |
                               Browser A <----P2P----> Browser B
                                    |
                                  TURN
                             (optional fallback)

The signaling server is not the chat server. Once WebRTC is connected, text/voice travels peer-to-peer.
