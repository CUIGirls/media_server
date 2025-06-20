const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const trackerRoutes = require("./tracker"); // Original tracker
const parallelTrackerRoutes = require("./parallelTracker"); // Enhanced parallel tracker

// Define PeerInfo class here since peer.js might not exist
class PeerInfo {
    constructor(peerId, socketId) {
        this.peerId = peerId;
        this.socketId = socketId;
        this.chunks = new Map(); // movie -> Set of chunkIndexes
        this.lastSeen = Date.now();
    }

    addChunk(movie, chunkIndex) {
        if (!this.chunks.has(movie)) {
            this.chunks.set(movie, new Set());
        }
        this.chunks.get(movie).add(chunkIndex);
        this.updateLastSeen();
    }

    removeChunk(movie, chunkIndex) {
        if (this.chunks.has(movie)) {
            this.chunks.get(movie).delete(chunkIndex);
            if (this.chunks.get(movie).size === 0) {
                this.chunks.delete(movie);
            }
        }
        this.updateLastSeen();
    }

    updateLastSeen() {
        this.lastSeen = Date.now();
    }

    isStale(threshold) {
        return (Date.now() - this.lastSeen) > threshold;
    }
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // Allow all origins (for development)
    methods: ["GET", "POST"],
  },
});

// Store active peer information
const activePeers = new Map(); // peerId -> PeerInfo

// Middleware
app.use(cors());
app.use(express.json());

// USE THE TRACKER ROUTES HERE
app.use("/", trackerRoutes); // Original tracker routes
app.use("/parallel", parallelTrackerRoutes); // Enhanced parallel streaming routes

// Movie Search API (replicating Python's /search endpoint)
// ... (existing code)

app.get("/search", async (req, res) => {
    const query = req.query.query;
    try {
        const response = await fetch(`https://yts.mx/api/v2/list_movies.json?query_term=${encodeURIComponent(query)}`);
        
        if (!response.ok) {
            console.error("YTS API response status:", response.status);
            return res.status(response.status).json({
                error: "Failed to fetch movies",
                details: `YTS API returned status ${response.status}`,
                statusCode: response.status,
            });
        }

        const data = await response.json();
        const movies = data.data?.movies || [];
        
        // Create proper magnet links from YTS torrent data
        const moviesWithMagnetLinks = movies.map(movie => {
            let magnetLink = null;
            // Find a suitable torrent (e.g., 1080p, then 720p)
            if (movie.torrents && movie.torrents.length > 0) {
                const quality1080p = movie.torrents.find(t => t.quality === '1080p');
                const quality720p = movie.torrents.find(t => t.quality === '720p');
                let selectedTorrent = null;
                
                if (quality1080p) { 
                    selectedTorrent = quality1080p;
                } else if (quality720p) {
                    selectedTorrent = quality720p;
                } else {
                    selectedTorrent = movie.torrents[0]; // Fallback to first available
                }
                
                // Create proper magnet link from torrent hash
                if (selectedTorrent && selectedTorrent.hash) {
                    const movieName = encodeURIComponent(movie.title.replace(/[^\w\s]/gi, ''));
                    magnetLink = `magnet:?xt=urn:btih:${selectedTorrent.hash}&dn=${movieName}&tr=udp://open.demonii.com:1337/announce&tr=udp://tracker.openbittorrent.com:80&tr=udp://tracker.coppersurfer.tk:6969&tr=udp://glotorrents.pw:6969/announce&tr=udp://tracker.opentrackr.org:1337/announce&tr=udp://torrent.gresille.org:80/announce&tr=udp://p4p.arenabg.com:1337&tr=udp://tracker.leechers-paradise.org:6969`;
                    console.log(`Created magnet link for ${movie.title}:`, magnetLink.substring(0, 100) + '...');
                }
            }            
            
            return {
                title: movie.title,
                year: movie.year,
                medium_cover_image: movie.medium_cover_image,
                summary: movie.summary,
                magnet_link: magnetLink,
                torrents: movie.torrents
            };
        });

        res.json(moviesWithMagnetLinks);
    } catch (error) {
        console.error("Error fetching movies from YTS API:", error.message);
        res.status(500).json({
            error: "Failed to fetch movies",
            details: error.message,
            statusCode: 500,
        });
    }
});

// ... (rest of your main.js code, you would likely remove the /download_chunk from tracker.js or just not use it for YTS downloads)

// // The /download_chunk endpoint is now handled by tracker.js, so you can remove or comment out this block from main.js
// app.get("/download_chunk", (req, res) => {
//   const { movie, chunkIndex } = req.query;
//   const chunkData = `Simulated data for chunk ${chunkIndex} of movie '${movie}'`;
//   res.send(chunkData);
// });

// WebRTC Signaling
io.on("connection", (socket) => {
  console.log("A peer connected:", socket.id);
  
  // Create and store peer information
  const peerInfo = new PeerInfo(socket.id, socket.id);
  activePeers.set(socket.id, peerInfo);
  // Handle chunk registration (delegate to tracker)
  socket.on("registerChunk", async ({ movie, chunkIndex }) => {
    console.log(`Peer ${socket.id} registering chunk ${chunkIndex} for movie: ${movie}`);

    // Update peer info
    peerInfo.addChunk(movie, chunkIndex);
    peerInfo.updateLastSeen();

    // Send registration to tracker (HTTP POST to tracker.js route)
    try {
      const response = await fetch("http://localhost:8080/register_chunk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ movie, chunkIndex, peerId: socket.id }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      console.log(`Registered chunk ${chunkIndex} for movie ${movie}`);
    } catch (err) {
      console.error("Error registering chunk with tracker:", err.message);
    }
  });

  // Handle signaling messages
  socket.on("signal", (data) => {
    const { to, from, signal } = data;
    console.log(`Signal from ${from} to ${to}:`, signal.type || 'ice-candidate');

    // Update sender's last seen
    if (activePeers.has(from)) {
      activePeers.get(from).updateLastSeen();
    }

    // Forward the signal to the target peer
    io.to(to).emit("signal", { from, signal });
  });  // Handle peer discovery requests
  socket.on("findPeers", async ({ movie }) => {
    console.log(`Finding peers for movie: ${movie}`);
    // Get chunk map from tracker (HTTP GET to tracker.js route)
    try {
      const response = await fetch(`http://localhost:8080/get_chunk_map?movie=${encodeURIComponent(movie)}`);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const chunkMap = await response.json();
      const availablePeers = new Set();
      
      for (const chunkIndex in chunkMap) {
        chunkMap[chunkIndex].forEach(peerId => {
          if (peerId !== socket.id) {  // Exclude self
            availablePeers.add(peerId);
          }
        });
      }
      
      console.log(`Found ${availablePeers.size} potential peers for movie ${movie}`);
      socket.emit("peersFound", { 
        movie, 
        peers: Array.from(availablePeers),
        chunkMap // Send the full chunk map so client knows which peer has what
      });
    } catch (err) {
      console.error('Error getting chunk map for findPeers:', err.message);
      socket.emit("peersFound", { movie, peers: [], chunkMap: {} });
    }
  });  // Handle disconnection
  socket.on("disconnect", async (reason) => {
    console.log(`A peer disconnected: ${socket.id}, reason: ${reason}`);

    activePeers.delete(socket.id); // Always remove from activePeers map on disconnect

    try {
      const response = await fetch("http://localhost:8080/cleanup_peer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ peerId: socket.id }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      console.log(`Cleaned up peer ${socket.id} from tracker.`);
    } catch (err) {
      console.error("Error cleaning up peer from tracker:", err.message);
    }
  });

  // PARALLEL STREAMING EVENTS
  
  // Handle parallel streaming start request
  socket.on("startParallelStream", async ({ movie, magnetLink }) => {
    console.log(`🚀 Starting parallel stream for movie: ${movie}`);
    
    try {
      const response = await fetch("http://localhost:8080/parallel/start_parallel_stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          movie, 
          magnetLink, 
          peerId: socket.id,
          socketId: socket.id 
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();
      socket.emit("parallelStreamStarted", { movie, ...result });
      
      // Start sending real-time progress updates
      startStreamingProgressUpdates(socket, movie);
      
    } catch (err) {
      console.error("Error starting parallel stream:", err.message);
      socket.emit("parallelStreamError", { movie, error: err.message });
    }
  });

  // Handle stream movie request with parallel processing  
  socket.on("streamMovie", async ({ movie, startChunk = 0 }) => {
    console.log(`🎬 Streaming movie ${movie} starting from chunk ${startChunk}`);
    
    try {
      const response = await fetch(`http://localhost:8080/parallel/stream_movie?movie=${encodeURIComponent(movie)}&startChunk=${startChunk}&peerId=${socket.id}`);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // Set up streaming response
      const reader = response.body.getReader();
      const stream = new ReadableStream({
        start(controller) {
          function pump() {
            return reader.read().then(({ done, value }) => {
              if (done) {
                controller.close();
                return;
              }
              // Forward chunk data to client
              socket.emit("streamChunk", { 
                movie, 
                chunk: value,
                timestamp: Date.now()
              });
              controller.enqueue(value);
              return pump();
            });
          }
          return pump();
        }
      });

    } catch (err) {
      console.error("Error streaming movie:", err.message);
      socket.emit("streamError", { movie, error: err.message });
    }
  });

  // Handle request for streaming statistics
  socket.on("getStreamingStats", async ({ movie }) => {
    try {
      const response = await fetch(`http://localhost:8080/parallel/streaming_stats?movie=${encodeURIComponent(movie)}`);
      
      if (response.ok) {
        const stats = await response.json();
        socket.emit("streamingStats", { movie, stats });
      }
    } catch (err) {
      console.error("Error getting streaming stats:", err.message);
    }
  });
});

// Streaming progress update intervals
const streamingIntervals = new Map(); // socketId -> intervalId

/**
 * Start sending real-time streaming progress updates
 */
function startStreamingProgressUpdates(socket, movie) {
  // Clear any existing interval for this socket
  if (streamingIntervals.has(socket.id)) {
    clearInterval(streamingIntervals.get(socket.id));
  }

  const intervalId = setInterval(async () => {
    try {
      const response = await fetch(`http://localhost:8080/parallel/streaming_stats?movie=${encodeURIComponent(movie)}`);
      
      if (response.ok) {
        const stats = await response.json();
        socket.emit("streamingProgressUpdate", { movie, stats });
      }
    } catch (err) {
      console.error("Error sending streaming progress:", err.message);
    }
  }, 1000); // Update every second

  streamingIntervals.set(socket.id, intervalId);

  // Clean up interval when socket disconnects
  socket.on('disconnect', () => {
    if (streamingIntervals.has(socket.id)) {
      clearInterval(streamingIntervals.get(socket.id));
      streamingIntervals.delete(socket.id);
    }
  });
}

// Periodic cleanup of stale peers
setInterval(() => {
  const staleThreshold = 5 * 60 * 1000; // 5 minutes
  const peersToRemove = [];

  for (const [peerId, peerInfo] of activePeers) {
    if (peerInfo.isStale(staleThreshold)) {
      console.log(`Marking stale peer for removal: ${peerId}`);
      peersToRemove.push(peerId);
    }
  }

  peersToRemove.forEach(peerId => {
      activePeers.delete(peerId);
      console.log(`Removed stale peer ${peerId} from activePeers map.`);
      // Also clean up from tracker if needed (though already done on disconnect normally)
      fetch('http://localhost:8080/cleanup_peer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ peerId })
      }).catch(err => {
          console.error('Error cleaning up stale peer from tracker during interval:', err.message);
      });
  });

}, 60 * 1000); // Run every 1 minute

// Start the server
const PORT = 8080;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});