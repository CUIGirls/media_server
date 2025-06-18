const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const axios = require("axios"); // For making HTTP requests
const trackerRoutes = require("./tracker"); // ADD THIS LINE
const { PeerInfo } = require("./peer"); // Import PeerInfo class

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
app.use("/", trackerRoutes); // ADD THIS LINE: This mounts all routes from tracker.js at the root path

// Movie Search API (replicating Python's /search endpoint)
// ... (existing code)

app.get("/search", async (req, res) => {
    const query = req.query.query;
    try {
        const response = await axios.get("https://yts.mx/api/v2/list_movies.json", {
            params: { query_term: query },
        });

        const movies = response.data.data?.movies || [];

        // --- NEW LOGIC: Extract magnet links ---
        const moviesWithMagnetLinks = movies.map(movie => {
            let magnetLink = null;
            // Find a suitable torrent (e.g., 1080p, then 720p)
            if (movie.torrents && movie.torrents.length > 0) {
                const quality1080p = movie.torrents.find(t => t.quality === '1080p');
                const quality720p = movie.torrents.find(t => t.quality === '720p');
                if (quality1080p) { 
                    magnetLink = quality1080p.url;
                    console.log(magnetLink);
                } else if (quality720p) {
                    magnetLink = quality720p.url;
                    console.log(magnetLink);
                } else {
                    magnetLink = movie.torrents[0].url; // Fallback to first available
                    console.log(magnetLink);
                }
            }
            return {
                title: movie.title,
                year: movie.year,
                medium_cover_image: movie.medium_cover_image,
                summary: movie.summary,
                magnet_link: magnetLink // Add the magnet link here
            };
        });

        res.json(moviesWithMagnetLinks); // Send the movies with magnet links
    } catch (error) {
        console.error("Error fetching movies from YTS API:", error);
        res.status(500).json({
            error: "Failed to fetch movies",
            details: error.message,
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
  socket.on("registerChunk", ({ movie, chunkIndex }) => {
    console.log(`Peer ${socket.id} registering chunk ${chunkIndex} for movie: ${movie}`);
    
    // Update peer info
    peerInfo.addChunk(movie, chunkIndex);
    peerInfo.updateLastSeen();
    
    // Send registration to tracker
    axios.post('http://localhost:8080/register_chunk', { 
      movie, 
      chunkIndex, 
      peerId: socket.id 
    }).catch(err => {
      console.error('Error registering chunk with tracker:', err.message);
    });
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
  });
  // Handle peer discovery requests
  socket.on("findPeers", ({ movie }) => {
    console.log(`Finding peers for movie: ${movie}`);
    // Get chunk map from tracker and send available peers
    const axios = require('axios');
    axios.get(`http://localhost:8080/get_chunk_map?movie=${encodeURIComponent(movie)}`)
      .then(response => {
        const chunkMap = response.data;
        const availablePeers = new Set();
        
        for (const chunkIndex in chunkMap) {
          chunkMap[chunkIndex].forEach(peerId => {
            if (peerId !== socket.id) {  
              availablePeers.add(peerId);
            }
          });
        }
        
        console.log(`Found ${availablePeers.size} peers for movie ${movie}`);
        socket.emit("peersFound", { 
          movie, 
          peers: Array.from(availablePeers),
          chunkMap 
        });
      })
      .catch(err => {
        console.error('Error getting chunk map:', err.message);
        socket.emit("peersFound", { movie, peers: [], chunkMap: {} });
      });
  });  // Handle disconnection
  socket.on("disconnect", () => {
    console.log("A peer disconnected:", socket.id);
    
    // Remove peer from active peers
    activePeers.delete(socket.id);
    
    // Clean up peer from tracker registry
    axios.post('http://localhost:8080/cleanup_peer', { 
      peerId: socket.id 
    }).catch(err => {
      console.error('Error cleaning up peer from tracker:', err.message);
    });
  });
});

// Periodic cleanup of stale peers
setInterval(() => {
  const currentTime = Date.now();
  const staleThreshold = 5 * 60 * 1000; // 5 minutes
  
  for (const [peerId, peerInfo] of activePeers) {
    if (peerInfo.isStale(staleThreshold)) {
      console.log(`Removing stale peer: ${peerId}`);
      activePeers.delete(peerId);
      
      // Clean up from tracker
      axios.post('http://localhost:8080/cleanup_peer', { 
        peerId 
      }).catch(err => {
        console.error('Error cleaning up stale peer from tracker:', err.message);
      });
    }
  }
}, 60 * 1000); 

// Start the server
const PORT = 8080;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});