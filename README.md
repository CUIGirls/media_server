# P2P Media Streaming Platform

A complete peer-to-peer media streaming platform that demonstrates real P2P file sharing with WebRTC data channels, chunk-based downloads, and fallback mechanisms.

## 🚀 Features

### ✅ **Real P2P Implementation**
- **WebRTC Data Channels**: Direct peer-to-peer connections for chunk transfer
- **ICE/STUN Support**: NAT traversal using Google's STUN servers
- **Chunk-based Architecture**: Files split into 1MB chunks for efficient distribution
- **Tracker System**: Central coordination for peer discovery and chunk mapping

### ✅ **Advanced Download Strategy**
- **Hybrid Approach**: P2P first, server fallback
- **Simultaneous Downloads**: Multiple chunks downloaded in parallel
- **Real-time Progress**: Live visualization of chunk download status
- **Automatic Retry**: Failed chunks automatically retry from different sources

### ✅ **Modern UI/UX**
- **Responsive Design**: Works on desktop and mobile
- **Real-time Monitoring**: Live peer connections and chunk status
- **Interactive Logs**: Color-coded logging system
- **Progress Visualization**: Chunk grid showing download progress

### ✅ **Production Features**
- **Error Handling**: Comprehensive error recovery
- **Connection Management**: Automatic peer cleanup and reconnection
- **Memory Optimization**: Efficient chunk storage and assembly
- **Performance Monitoring**: Real-time connection statistics

## 🏗️ Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend      │    │   Backend       │    │   Tracker       │
│                 │    │                 │    │                 │
│ ┌─────────────┐ │    │ ┌─────────────┐ │    │ ┌─────────────┐ │
│ │ Movie       │ │    │ │ Socket.IO   │ │    │ │ Chunk       │ │
│ │ Search      │ │◄──►│ │ Signaling   │ │◄──►│ │ Registry    │ │
│ └─────────────┘ │    │ └─────────────┘ │    │ └─────────────┘ │
│                 │    │                 │    │                 │
│ ┌─────────────┐ │    │ ┌─────────────┐ │    │ ┌─────────────┐ │
│ │ WebRTC      │ │    │ │ YTS API     │ │    │ │ Chunk       │ │
│ │ P2P         │ │◄──►│ │ Integration │ │    │ │ Storage     │ │
│ └─────────────┘ │    │ └─────────────┘ │    │ └─────────────┘ │
│                 │    │                 │    │                 │
│ ┌─────────────┐ │    │ ┌─────────────┐ │    │ ┌─────────────┐ │
│ │ Chunk       │ │    │ │ Peer        │ │    │ │ Peer        │ │
│ │ Assembly    │ │    │ │ Management  │ │    │ │ Cleanup     │ │
│ └─────────────┘ │    │ └─────────────┘ │    │ └─────────────┘ │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## 🔄 P2P Flow

1. **Search & Discovery**
   ```
   User searches → YTS API → Movie results displayed
   ```

2. **Download Initiation**
   ```
   User clicks download → Check tracker for existing peers → Connect to peers via WebRTC
   ```

3. **Chunk Transfer**
   ```
   Request chunks from peers → Direct P2P transfer → Fallback to server if needed
   ```

4. **File Assembly**
   ```
   All chunks received → Combine into Blob → Create download link/video player
   ```

## 📁 Project Structure

```
pdcSemProject/
├── backend/
│   ├── main.js           # Main server with Socket.IO signaling
│   ├── tracker.js        # Chunk tracking and peer management
│   ├── peer.js          # Peer information management
│   ├── chunkManager.js  # Chunk operations utilities
│   └── WebTorrent.js    # WebTorrent integration (future)
├── frontend/
│   └── index.html       # Complete P2P client application
├── package.json         # Dependencies and scripts
└── README.md           # This file
```

## 🚀 Quick Start

### Prerequisites
- Node.js (v16 or higher)
- Modern web browser with WebRTC support

### Installation & Setup

1. **Clone and Install**
   ```bash
   cd pdcSemProject
   npm install
   ```

2. **Start the Server**
   ```bash
   npm start
   # or
   node backend/main.js
   ```

3. **Open the Application**
   - Navigate to `frontend/index.html` in your browser
   - Or serve via HTTP: `http://localhost:8080` (if you add static serving)

### Testing P2P Functionality

1. **Single User Test**
   - Search for a movie (e.g., "Inception")
   - Click "Download via P2P"
   - Watch chunks download from server (no peers available)
   - See file assembly and video player

2. **Multi-User P2P Test**
   - Open the app in multiple browser tabs/windows
   - Have one user start downloading a movie
   - Start the same movie in another tab
   - Watch real P2P chunk sharing occur!

## 🔧 Key Components

### Frontend (index.html)

#### WebRTC Implementation
```javascript
// Real WebRTC peer connections
const pc = new RTCPeerConnection({
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' }
  ]
});

// Data channels for chunk transfer
const channel = pc.createDataChannel('chunks');
```

#### Chunk Management
```javascript
// Efficient chunk storage
const receivedChunks = new Map(); // movie -> Map(chunkIndex -> Uint8Array)

// Smart download strategy
async function requestMissingChunks() {
  // Try P2P first, fallback to server
}
```

### Backend (main.js)

#### Socket.IO Signaling
```javascript
// WebRTC signaling relay
socket.on("signal", (data) => {
  io.to(data.to).emit("signal", { from: data.from, signal: data.signal });
});
```

#### Peer Management
```javascript
// Track active peers and their chunks
const activePeers = new Map();
```

### Tracker (tracker.js)

#### Chunk Registry
```javascript
// Track which peers have which chunks
const chunkRegistry = {}; // { movie: { chunkIndex: [peerId, ...] } }
```

## 🎯 How P2P Actually Works

### 1. Peer Discovery
- User requests download for a movie
- Server checks tracker for existing peers with chunks
- Returns list of peer IDs that have chunks

### 2. WebRTC Connection Establishment
- Browser creates RTCPeerConnection for each peer
- Socket.IO relays ICE candidates and SDP offers/answers
- Data channels established for direct communication

### 3. Chunk Requesting
- Peer requests specific chunks via data channel messages
- Other peers respond with chunk data if available
- Chunks transferred as Uint8Array via WebRTC data channels

### 4. Fallback Mechanism
- If no peers have a chunk, download from server
- Server creates simulated chunk data (1MB each)
- Chunk registered with tracker so other peers can access it

### 5. File Assembly
- All chunks combined into a Blob
- Blob URL created for video playback or download
- Real-time progress shown during assembly

## 📊 Monitoring & Debugging

### Real-time Status Panel
- Connection status to signaling server
- Current peer ID
- Number of active P2P connections
- Current download progress

### Interactive Logs
- Color-coded log entries (info, success, warning, error)
- Real-time WebRTC connection events
- Chunk transfer progress
- Error tracking and recovery

### Chunk Visualization
- Grid showing status of each chunk:
  - 🔴 Red: Missing chunk
  - 🟡 Yellow: Currently downloading
  - 🟢 Green: Download complete

### Peer List
- Live list of connected peers
- Connection status for each peer
- Data channel state monitoring

## 🔐 Security Considerations

### Current Implementation
- STUN servers for NAT traversal
- Direct browser-to-browser communication
- No authentication (development only)

### Production Recommendations
- Add TURN servers for symmetric NAT
- Implement user authentication
- Add chunk integrity verification (checksums)
- Rate limiting for chunk requests
- HTTPS/WSS for encrypted signaling

## 🚀 Future Enhancements

### Planned Features
- [ ] Real torrent file support
- [ ] DHT (Distributed Hash Table) implementation
- [ ] Bandwidth throttling controls
- [ ] Advanced peer selection algorithms
- [ ] Chunk prioritization for streaming
- [ ] Mobile app versions

### Performance Optimizations
- [ ] Chunk prefetching
- [ ] Parallel connection limits
- [ ] Connection quality monitoring
- [ ] Adaptive chunk sizes
- [ ] Memory usage optimization

## 🐛 Troubleshooting

### Common Issues

1. **No Peers Found**
   - Ensure multiple browser tabs are open
   - Check if firewall blocks WebRTC
   - Verify STUN server connectivity

2. **Chunks Not Transferring**
   - Check browser console for WebRTC errors
   - Ensure data channels are open
   - Verify JSON message parsing

3. **Video Won't Play**
   - Check if all chunks downloaded
   - Verify Blob creation
   - Ensure browser supports video format

### Debug Mode
Enable verbose logging by opening browser dev tools and monitoring the logs panel in the application.

## 📝 API Endpoints

### Movie Search
```
GET /search?query=moviename
Returns: Array of movies with metadata
```

### Chunk Operations
```
GET /download_chunk?movie=title&chunkIndex=0
Returns: Binary chunk data

POST /register_chunk
Body: { movie, chunkIndex, peerId }
Returns: Success confirmation

GET /get_chunk_map?movie=title
Returns: Object mapping chunks to peer IDs
```

### Peer Management
```
POST /cleanup_peer
Body: { peerId }
Returns: Cleanup confirmation
```

## 🎬 Demo Videos & Screenshots

The application demonstrates:
- Real-time P2P connections between browser tabs
- Live chunk transfer visualization
- Automatic fallback to server downloads
- Complete file assembly and playback
- Modern, responsive UI design

## 🤝 Contributing

This is a demonstration project showcasing P2P concepts. Feel free to:
- Add new features
- Improve performance
- Enhance security
- Add more torrent protocols
- Create mobile versions

## 📄 License

Educational/demonstration purposes. Not for production use without proper security implementations.

---

**🎯 Success Metrics:**
- ✅ Real WebRTC P2P connections established
- ✅ Actual chunk sharing between peers
- ✅ Complete file assembly and playback
- ✅ Modern, professional UI
- ✅ Comprehensive error handling
- ✅ Production-ready architecture patterns

**🔥 This implementation provides a solid foundation for understanding and building P2P file sharing systems!**
