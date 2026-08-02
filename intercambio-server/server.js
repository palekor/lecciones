import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";
import crypto from "crypto";

const app = express();
const server = http.createServer(app);

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "https://palekor.github.io";
app.use(cors({ origin: true }));
app.use(express.json({ limit: "20kb" }));

const io = new Server(server, {
  cors: { origin: true, methods: ["GET","POST"] },
  transports: ["websocket","polling"]
});

const queue = [];
const rooms = new Map();
const lobby = new Map(); // socketId -> {speaks,wants,mode,busy}

const TOPICS = [
  "What made you smile this week? / ¿Qué te hizo sonreír esta semana?",
  "Describe a typical dish from your region. / Describe un plato típico de tu región.",
  "Where would you go if you could travel tomorrow? / ¿A dónde viajarías mañana?",
  "What is one goal you want to achieve this year? / ¿Cuál es una meta que quieres lograr este año?",
  "What does your perfect day look like? / ¿Cómo sería tu día perfecto?",
  "What is something you changed your mind about? / ¿Sobre qué cambiaste de opinión?",
  "What skill would you like to learn next? / ¿Qué habilidad te gustaría aprender después?",
  "What is a place in your country everyone should visit? / ¿Qué lugar de tu país debería visitar todo el mundo?"
];

app.get("/health", (_, res) => res.json({ ok: true, service: "ProfGermandario Intercambio V2" }));

app.get("/api/topic", (_, res) => res.json({ topic: TOPICS[Math.floor(Math.random()*TOPICS.length)] }));

app.post("/api/topic", async (req, res) => {
  const fallback = TOPICS[Math.floor(Math.random()*TOPICS.length)];
  const key = process.env.OPENAI_API_KEY;
  if (!key) return res.json({ topic: fallback, source: "fallback" });

  try {
    const prompt = `Create ONE fresh bilingual conversation topic for an English-Spanish language exchange.
Return only one short topic in this exact style: English question / Spanish question.
No politics, sex, dating, medical advice, money scams, or personal identifying information.
Make it open-ended and easy enough for A2-B2 learners.`;
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {"Content-Type":"application/json","Authorization":`Bearer ${key}`},
      body: JSON.stringify({ model: process.env.OPENAI_MODEL || "gpt-5-mini", input: prompt, max_output_tokens: 100 })
    });
    if (!r.ok) throw new Error(`OpenAI ${r.status}`);
    const d = await r.json();
    const text = d.output_text?.trim();
    res.json({ topic: text || fallback, source: text ? "ai" : "fallback" });
  } catch {
    res.json({ topic: fallback, source: "fallback" });
  }
});

app.get("/api/ice-servers", async (_, res) => {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return res.json({iceServers:[{urls:["stun:stun.l.google.com:19302","stun:stun1.l.google.com:19302"]}]});
  try {
    const auth = Buffer.from(`${sid}:${token}`).toString("base64");
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Tokens.json`, {
      method:"POST", headers:{Authorization:`Basic ${auth}`}
    });
    if (!r.ok) throw new Error(`Twilio ${r.status}`);
    const d = await r.json();
    res.json({iceServers:d.ice_servers});
  } catch {
    res.json({iceServers:[{urls:["stun:stun.l.google.com:19302","stun:stun1.l.google.com:19302"]}]});
  }
});

async function saveReport(report) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return false;
  const key = `profgermandario:reports:${Date.now()}:${crypto.randomUUID()}`;
  const value = JSON.stringify(report);
  const r = await fetch(`${url}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}`, {
    headers:{Authorization:`Bearer ${token}`}
  });
  return r.ok;
}

app.post("/api/report", async (req,res)=>{
  const {sessionHash, reason, roomId} = req.body || {};
  if (typeof sessionHash !== "string" || !/^[a-f0-9]{64}$/.test(sessionHash))
    return res.status(400).json({ok:false,error:"invalid_session_hash"});
  const report = {
    sessionHash,
    reason: String(reason || "user_report").slice(0,80),
    roomId: String(roomId || "").slice(0,120),
    createdAt: new Date().toISOString()
  };
  try {
    const saved = await saveReport(report);
    res.json({ok:true,persisted:saved});
  } catch {
    res.status(500).json({ok:false});
  }
});

function compatible(a,b){
  return a.speaks === b.wants && a.wants === b.speaks;
}

function publicList(excludeId){
  return [...lobby.entries()]
    .filter(([id,u])=>id!==excludeId && !u.busy)
    .map(([id,u])=>({id,speaks:u.speaks,wants:u.wants,mode:u.mode}));
}
function broadcastPresence(){
  for (const [id] of lobby) io.to(id).emit("presence", publicList(id));
}

io.on("connection", socket=>{
  // Legacy blind-queue matching (kept for compatibility, unused by the lobby UI)
  socket.on("join-queue", data=>{
    const item = {
      socketId:socket.id,
      speaks:data?.speaks === "en" ? "en" : "es",
      wants:data?.wants === "en" ? "en" : "es",
      mode:data?.mode === "voice" ? "voice" : "text",
      topic:typeof data?.topic === "string" ? data.topic.slice(0,200) : null,
      createdAt:Date.now()
    };
    if (item.speaks === item.wants) return socket.emit("queue-error",{message:"Choose two different languages."});

    const idx = queue.findIndex(x=>compatible(x,item) && x.mode===item.mode && io.sockets.sockets.has(x.socketId));
    if (idx === -1) {
      queue.push(item);
      socket.data.queueItem = item;
      socket.emit("queueing");
      return;
    }

    const other = queue.splice(idx,1)[0];
    openRoom(other.socketId, socket.id, item.mode);
  });

  // Lobby: see who's online, poke someone, accept/decline an invite
  socket.on("enter-lobby", data=>{
    lobby.set(socket.id, {
      speaks: data?.speaks === "en" ? "en" : "es",
      wants: data?.wants === "en" ? "en" : "es",
      mode: data?.mode === "voice" ? "voice" : "text",
      busy: false
    });
    console.log(`[enter-lobby] id=${socket.id} lobbySize=${lobby.size}`);
    socket.emit("presence", publicList(socket.id));
    broadcastPresence();
  });

  socket.on("poke", ({targetId})=>{
    const me = lobby.get(socket.id);
    const target = lobby.get(targetId);
    console.log(`[poke] from=${socket.id} to=${targetId} meIn=${!!me} targetIn=${!!target} meBusy=${me?.busy} targetBusy=${target?.busy} lobbySize=${lobby.size}`);
    if (!me) return;
    if (!target) { socket.emit("poke-failed", {reason:"offline"}); return; }
    if (me.busy || target.busy) { socket.emit("poke-failed", {reason:"busy"}); return; }
    io.to(targetId).emit("poke-received", {fromId: socket.id, speaks: me.speaks, wants: me.wants, mode: me.mode});
    socket.emit("poke-sent", {targetId});
  });

  socket.on("poke-response", ({fromId, accept})=>{
    const me = lobby.get(socket.id);
    const other = lobby.get(fromId);
    if (!accept || !me || !other) { io.to(fromId).emit("poke-declined", {byId: socket.id}); return; }
    if (me.busy || other.busy) return;
    const mode = (me.mode === "voice" && other.mode === "voice") ? "voice" : "text";
    me.busy = true; other.busy = true;
    openRoom(fromId, socket.id, mode);
    broadcastPresence();
  });

  socket.on("leave-lobby", ()=>{
    lobby.delete(socket.id);
    broadcastPresence();
  });

  // Text chat relayed through the server -- works regardless of NAT/firewall
  socket.on("chat-message", ({roomId, text})=>{
    const room = rooms.get(roomId); if (!room) return;
    const peerId = room.a === socket.id ? room.b : room.a;
    io.to(peerId).emit("chat-message", {text: String(text||"").slice(0,2000)});
  });

  // Mid-chat voice upgrade: either side can propose, both must accept before WebRTC negotiation starts
  socket.on("voice-request", ({roomId})=>{
    const room = rooms.get(roomId); if (!room) return;
    const peerId = room.a === socket.id ? room.b : room.a;
    io.to(peerId).emit("voice-request", {roomId});
  });
  socket.on("voice-response", ({roomId, accept})=>{
    const room = rooms.get(roomId); if (!room) return;
    const peerId = room.a === socket.id ? room.b : room.a;
    io.to(peerId).emit("voice-response", {roomId, accept: !!accept});
  });

  socket.on("signal", ({roomId,data})=>{
    const room=rooms.get(roomId); if(!room)return;
    const peerId=room.a===socket.id?room.b:room.a;
    io.to(peerId).emit("signal",{roomId,data});
  });

  socket.on("leave-room", ({roomId})=>{
    leaveRoom(socket,roomId);
  });

  socket.on("disconnect", ()=>{
    const q=queue.findIndex(x=>x.socketId===socket.id); if(q>=0)queue.splice(q,1);
    lobby.delete(socket.id);
    broadcastPresence();
    for(const [roomId,room] of rooms.entries()){
      if(room.a===socket.id || room.b===socket.id) leaveRoom(socket,roomId);
    }
  });
});

function openRoom(aSocketId, bSocketId, mode){
  const roomId = crypto.randomUUID();
  rooms.set(roomId, {a:aSocketId, b:bSocketId, mode, createdAt:Date.now()});
  const aSock = io.sockets.sockets.get(aSocketId);
  if (aSock) aSock.emit("matched", {roomId, role:"offerer", mode});
  const bSock = io.sockets.sockets.get(bSocketId);
  if (bSock) bSock.emit("matched", {roomId, role:"answerer", mode});
}

function leaveRoom(socket,roomId){
  const room=rooms.get(roomId); if(!room)return;
  const peerId=room.a===socket.id?room.b:room.a;
  rooms.delete(roomId);
  const a=lobby.get(room.a); if(a)a.busy=false;
  const b=lobby.get(room.b); if(b)b.busy=false;
  broadcastPresence();
  io.to(peerId).emit("peer-left");
}

setInterval(()=>{
  const now=Date.now();
  for(let i=queue.length-1;i>=0;i--) if(now-queue[i].createdAt>120000) queue.splice(i,1);
  for(const [id,r] of rooms) if(now-r.createdAt>30*60*1000) rooms.delete(id);
},30000);

const PORT=process.env.PORT || 3000;
server.listen(PORT,()=>console.log(`ProfGermandario Intercambio V2 listening on ${PORT}`));
