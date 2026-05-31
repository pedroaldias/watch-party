const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
  pingInterval: 5000,
  pingTimeout: 10000,
});

// rooms: { roomId: { host, users: Map<socketId, {name, joined}>, state: {playing, currentTime, updatedAt, videoUrl, subtitleUrl} } }
const rooms = new Map();

function getRoomPublicData(room) {
  return {
    host: room.host,
    users: Array.from(room.users.values()),
    state: room.state,
    videoUrl: room.videoUrl || null,
    subtitleUrl: room.subtitleUrl || null,
  };
}

function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Health check
app.get('/', (req, res) => res.json({ status: 'ok', rooms: rooms.size }));

app.post('/create-room', (req, res) => {
  const roomId = generateRoomId();
  rooms.set(roomId, {
    host: null,
    users: new Map(),
    state: {
      playing: false,
      currentTime: 0,
      updatedAt: Date.now(),
    },
    videoUrl: null,
    subtitleUrl: null,
    hostDisconnectTimer: null,
  });
  res.json({ roomId });
});

app.get('/room/:roomId', (req, res) => {
  const room = rooms.get(req.params.roomId.toUpperCase());
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json(getRoomPublicData(room));
});

io.on('connection', (socket) => {
  let currentRoom = null;
  let currentUser = null;

  // ─── JOIN ROOM ────────────────────────────────────────────────────────────
  socket.on('join-room', ({ roomId, name }, ack) => {
    roomId = roomId.toUpperCase();
    const room = rooms.get(roomId);
    if (!room) return ack?.({ error: 'Room not found' });

    currentRoom = roomId;
    currentUser = { socketId: socket.id, name, joined: Date.now() };

    // First user becomes host
    const isFirstUser = room.users.size === 0;
    if (isFirstUser) {
      room.host = socket.id;
      // Clear any pending host timeout
      if (room.hostDisconnectTimer) {
        clearTimeout(room.hostDisconnectTimer);
        room.hostDisconnectTimer = null;
      }
    }

    room.users.set(socket.id, currentUser);
    socket.join(roomId);

    const isHost = room.host === socket.id;

    // Send room state to the joining user
    ack?.({
      ok: true,
      isHost,
      state: room.state,
      videoUrl: room.videoUrl,
      subtitleUrl: room.subtitleUrl,
      host: room.host,
      users: Array.from(room.users.values()),
    });

    // Notify others
    socket.to(roomId).emit('user-joined', {
      user: currentUser,
      users: Array.from(room.users.values()),
    });
  });

  // ─── HOST: SET VIDEO ──────────────────────────────────────────────────────
  socket.on('set-video', ({ videoUrl, subtitleUrl }) => {
    const room = rooms.get(currentRoom);
    if (!room || room.host !== socket.id) return;

    room.videoUrl = videoUrl;
    room.subtitleUrl = subtitleUrl || null;
    room.state.currentTime = 0;
    room.state.playing = false;
    room.state.updatedAt = Date.now();

    io.to(currentRoom).emit('video-changed', {
      videoUrl,
      subtitleUrl: subtitleUrl || null,
      state: room.state,
    });
  });

  // ─── HOST: PLAYBACK CONTROL ───────────────────────────────────────────────
  socket.on('play', ({ currentTime, clientTime }) => {
    const room = rooms.get(currentRoom);
    if (!room || room.host !== socket.id) return;

    const rtt = Date.now() - (clientTime || Date.now());
    const compensated = currentTime + rtt / 2000; // advance by half RTT in seconds

    room.state.playing = true;
    room.state.currentTime = compensated;
    room.state.updatedAt = Date.now();

    socket.to(currentRoom).emit('play', {
      currentTime: compensated,
      serverTime: Date.now(),
    });
  });

  socket.on('pause', ({ currentTime }) => {
    const room = rooms.get(currentRoom);
    if (!room || room.host !== socket.id) return;

    room.state.playing = false;
    room.state.currentTime = currentTime;
    room.state.updatedAt = Date.now();

    socket.to(currentRoom).emit('pause', { currentTime });
  });

  socket.on('seek', ({ currentTime }) => {
    const room = rooms.get(currentRoom);
    if (!room || room.host !== socket.id) return;

    room.state.currentTime = currentTime;
    room.state.updatedAt = Date.now();

    socket.to(currentRoom).emit('seek', { currentTime });
  });

  // ─── BUFFERING ────────────────────────────────────────────────────────────
  socket.on('buffer-start', () => {
    const room = rooms.get(currentRoom);
    if (!room) return;

    // Any user can trigger a pause for buffering
    const user = room.users.get(socket.id);
    io.to(currentRoom).emit('buffer-pause', {
      byUser: user?.name || 'Someone',
      socketId: socket.id,
    });
  });

  socket.on('buffer-end', ({ currentTime }) => {
    const room = rooms.get(currentRoom);
    if (!room) return;

    const user = room.users.get(socket.id);
    io.to(currentRoom).emit('buffer-ready', {
      byUser: user?.name || 'Someone',
      socketId: socket.id,
    });
  });

  // ─── HEARTBEAT ────────────────────────────────────────────────────────────
  socket.on('heartbeat', ({ currentTime, clientTime }) => {
    const room = rooms.get(currentRoom);
    if (!room) return;

    if (room.host === socket.id) {
      room.state.currentTime = currentTime;
      room.state.updatedAt = Date.now();
      // Broadcast host's heartbeat so guests can self-check
      socket.to(currentRoom).emit('host-heartbeat', {
        currentTime,
        serverTime: Date.now(),
      });
    } else {
      // Guest heartbeat: server checks drift and may request resync
      const hostTime = room.state.currentTime;
      const elapsed = (Date.now() - room.state.updatedAt) / 1000;
      const expectedTime = room.state.playing ? hostTime + elapsed : hostTime;
      const drift = Math.abs(currentTime - expectedTime);

      if (drift > 1.5) {
        socket.emit('resync', {
          currentTime: expectedTime,
          playing: room.state.playing,
          serverTime: Date.now(),
        });
      }
    }

    // Pong back for RTT measurement
    socket.emit('heartbeat-ack', { clientTime, serverTime: Date.now() });
  });

  // ─── CHAT ─────────────────────────────────────────────────────────────────
  socket.on('chat', ({ message }) => {
    const room = rooms.get(currentRoom);
    if (!room || !message?.trim()) return;
    const user = room.users.get(socket.id);
    io.to(currentRoom).emit('chat', {
      name: user?.name || 'Unknown',
      message: message.trim().substring(0, 500),
      time: Date.now(),
    });
  });

  // ─── REQUEST CONTROL ──────────────────────────────────────────────────────
  socket.on('request-control', () => {
    const room = rooms.get(currentRoom);
    if (!room || room.host === socket.id) return;
    const user = room.users.get(socket.id);
    socket.to(room.host).emit('control-requested', {
      socketId: socket.id,
      name: user?.name,
    });
  });

  socket.on('grant-control', ({ toSocketId }) => {
    const room = rooms.get(currentRoom);
    if (!room || room.host !== socket.id) return;
    room.host = toSocketId;
    io.to(currentRoom).emit('host-changed', {
      newHost: toSocketId,
      users: Array.from(room.users.values()),
    });
  });

  // ─── DISCONNECT ───────────────────────────────────────────────────────────
  socket.on('disconnect', () => {
    const room = rooms.get(currentRoom);
    if (!room) return;

    room.users.delete(socket.id);

    if (room.users.size === 0) {
      // Last user left — clean up after a delay
      setTimeout(() => {
        if (rooms.has(currentRoom) && rooms.get(currentRoom).users.size === 0) {
          rooms.delete(currentRoom);
        }
      }, 30 * 60 * 1000); // 30 min
      return;
    }

    // Notify remaining users
    io.to(currentRoom).emit('user-left', {
      socketId: socket.id,
      users: Array.from(room.users.values()),
    });

    // If host disconnected, start a 10s timer to promote next user
    if (room.host === socket.id) {
      room.hostDisconnectTimer = setTimeout(() => {
        const nextUser = room.users.keys().next().value;
        if (nextUser) {
          room.host = nextUser;
          io.to(currentRoom).emit('host-changed', {
            newHost: nextUser,
            users: Array.from(room.users.values()),
          });
        }
      }, 10000);
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`WatchParty server running on port ${PORT}`));
