const express = require("express");
const router = express.Router();
const path = require("path");
const fs = require("fs");
const ParallelStreamingEngine = require('./streamingEngine');

// WebTorrent will be loaded dynamically
let WebTorrent = null;
let torrentClient = null;

// Initialize WebTorrent client asynchronously
async function initWebTorrent() {
  try {
    if (!WebTorrent) {
      const WebTorrentModule = await import('webtorrent');
      WebTorrent = WebTorrentModule.default;
      torrentClient = new WebTorrent();
      console.log('✅ WebTorrent initialized successfully for parallel tracker');
    }
    return torrentClient;
  } catch (error) {
    console.error('❌ Failed to initialize WebTorrent for parallel tracker:', error.message);
    return null;
  }
}

// Enhanced data structures for parallel streaming
const chunkRegistry = {}; // { movie: { chunkIndex: [peerId, ...] } }
const movieChunkInfo = {}; // { movie: { totalChunks: number, chunkSize: number } }
const activeTorrents = new Map(); // { movie: torrent }
const magnetLinks = new Map(); // { movie: magnetLink }
const peerConnections = new Map(); // peerId -> connection info
const streamingEngines = new Map(); // movieId -> streaming engine instance

// Concurrency control for chunk extraction
const chunkExtractionQueue = new Map(); // { movie_chunkIndex: Promise }
const activeExtractions = new Map(); // { movie: Set of chunkIndexes being extracted }
const maxConcurrentExtractions = 3; // Limit concurrent extractions per movie

/**
 * Enhanced torrent download function for parallel tracker
 */
async function downloadTorrent(movie, magnetLink) {
  console.log(`🚀 Starting torrent download for parallel tracker: ${movie}`);
  
  // Check if torrent already exists
  if (activeTorrents.has(movie)) {
    const existingTorrent = activeTorrents.get(movie);
    if (existingTorrent.ready) {
      console.log(`✅ Torrent already ready for parallel tracker: ${movie}`);
      return existingTorrent;
    }
  }
  
  // Initialize WebTorrent client if needed
  let client = torrentClient;
  if (!client) {
    client = await initWebTorrent();
    torrentClient = client;
  }
  
  if (!client) {
    throw new Error('Failed to initialize WebTorrent client for parallel tracker');
  }
  
  return new Promise((resolve, reject) => {
    
    const torrent = client.add(magnetLink, {
      path: path.join(__dirname, 'torrents'),
      destroyStoreOnDestroy: false
    });
    
    activeTorrents.set(movie, torrent);
    
    torrent.on('ready', () => {
      console.log(`✅ Parallel tracker torrent ready for ${movie}: ${torrent.name}`);
      console.log(`📁 Files in torrent:`, torrent.files.map(f => ({ name: f.name, length: f.length })));
      resolve(torrent);
    });
    
    torrent.on('error', (err) => {
      console.error(`❌ Parallel tracker torrent error for ${movie}:`, err.message);
      activeTorrents.delete(movie);
      reject(err);
    });
    
    torrent.on('download', (bytes) => {
      const progress = (torrent.downloaded / torrent.length * 100).toFixed(1);
      if (torrent.downloaded % (10 * 1024 * 1024) === 0) { // Log every 10MB
        console.log(`📊 Parallel tracker download progress for ${movie}: ${progress}% (${formatBytes(torrent.downloaded)}/${formatBytes(torrent.length)})`);
      }
    });
    
    // Set timeout for torrent readiness
    setTimeout(() => {
      if (!torrent.ready) {
        console.log(`⏰ Parallel tracker torrent not ready after 60s for ${movie}, but continuing...`);
        resolve(torrent);
      }
    }, 60000);
  });
}

/**
 * Extract a specific chunk from a torrent file for parallel tracker
 */
async function extractChunkFromTorrent(torrent, movie, chunkIndex, res) {
  return new Promise((resolve, reject) => {
    try {
      // Find the main video file
      const videoFile = torrent.files.find(file => 
        file.name.match(/\.(mp4|mkv|avi|mov|wmv|flv|webm|m4v)$/i)
      ) || torrent.files[0];
      
      if (!videoFile) {
        throw new Error('No video file found in torrent');
      }
      
      const chunkSize = 2 * 1024 * 1024; // 2MB chunks
      const offset = chunkIndex * chunkSize;
      const length = Math.min(chunkSize, videoFile.length - offset);
      
      if (offset >= videoFile.length) {
        throw new Error(`Chunk index ${chunkIndex} out of bounds (file size: ${videoFile.length})`);
      }
      
      console.log(`📥 Parallel tracker extracting chunk ${chunkIndex}: offset=${offset}, length=${length} from ${videoFile.name}`);
      
      // Create a stream for the specific chunk with retry mechanism
      let retryCount = 0;
      const maxRetries = 3;
      
      const attemptExtraction = () => {
        const chunkStream = videoFile.createReadStream({ start: offset, end: offset + length - 1 });
        const chunks = [];
        let bytesReceived = 0;
        
        const streamTimeout = setTimeout(() => {
          chunkStream.destroy();
          if (retryCount < maxRetries) {
            retryCount++;
            console.log(`⚠️ Parallel tracker chunk ${chunkIndex} extraction timeout, retrying (${retryCount}/${maxRetries})`);
            setTimeout(attemptExtraction, 1000 * retryCount);
          } else {
            const error = new Error(`Parallel tracker chunk ${chunkIndex} extraction timeout after ${maxRetries} retries`);
            if (!res.headersSent) {
              res.status(500).json({ 
                error: error.message,
                movie,
                chunkIndex,
                retry: true
              });
            }
            reject(error);
          }
        }, 15000); // 15 second timeout per attempt
        
        chunkStream.on('data', (data) => {
          chunks.push(data);
          bytesReceived += data.length;
        });
        
        chunkStream.on('end', () => {
          clearTimeout(streamTimeout);
          
          if (bytesReceived === 0) {
            if (retryCount < maxRetries) {
              retryCount++;
              console.log(`⚠️ Parallel tracker chunk ${chunkIndex} no data received, retrying (${retryCount}/${maxRetries})`);
              setTimeout(attemptExtraction, 1000 * retryCount);
              return;
            } else {
              const error = new Error(`Parallel tracker chunk ${chunkIndex} no data received after ${maxRetries} retries`);
              if (!res.headersSent) {
                res.status(500).json({ 
                  error: error.message,
                  movie,
                  chunkIndex,
                  retry: true
                });
              }
              reject(error);
              return;
            }
          }
          
          const chunkData = Buffer.concat(chunks);
          
          // Save chunk to disk for future use
          const sanitizedMovie = movie.replace(/[^a-zA-Z0-9\-_]/g, '_');
          const chunkPath = path.join(__dirname, "chunks", `${sanitizedMovie}.chunk${chunkIndex}`);
          
          try {
            fs.writeFileSync(chunkPath, chunkData);
            console.log(`✅ Parallel tracker chunk ${chunkIndex} extracted and saved for ${movie} (${chunkData.length} bytes)`);
          } catch (saveError) {
            console.warn(`⚠️ Parallel tracker failed to save chunk ${chunkIndex} to disk:`, saveError.message);
            // Continue serving even if save fails
          }
          
          // Send the chunk
          if (!res.headersSent) {
            res.setHeader('Content-Type', 'application/octet-stream');
            res.setHeader('Content-Disposition', `attachment; filename="${sanitizedMovie}.chunk${chunkIndex}"`);
            res.setHeader('Cache-Control', 'public, max-age=3600');
            res.setHeader('X-Chunk-Source', 'torrent-parallel');
            res.send(chunkData);
          }
          
          resolve();
        });
          
        chunkStream.on('error', (err) => {
          clearTimeout(streamTimeout);
          console.error(`❌ Parallel tracker stream error reading chunk ${chunkIndex}:`, err.message);
          if (retryCount < maxRetries) {
            retryCount++;
            console.log(`⚠️ Parallel tracker chunk ${chunkIndex} stream error, retrying (${retryCount}/${maxRetries})`);
            setTimeout(attemptExtraction, 1000 * retryCount);
          } else {
            if (!res.headersSent) {
              res.status(500).json({ 
                error: `Parallel tracker failed to read chunk ${chunkIndex} after ${maxRetries} retries`,
                details: err.message,
                movie,
                chunkIndex,
                retry: true
              });
            }
            reject(err);
          }
        });
      };
      
      // Start extraction
      attemptExtraction();
      
    } catch (error) {
      console.error(`❌ Parallel tracker error setting up chunk ${chunkIndex} extraction:`, error.message);
      if (!res.headersSent) {
        res.status(500).json({ 
          error: `Parallel tracker failed to extract chunk ${chunkIndex}`,
          details: error.message,
          movie,
          chunkIndex,
          retry: true
        });
      }
      reject(error);
    }
  });
}

/**
 * Enhanced chunk extraction with concurrency control for parallel tracker
 */
async function extractChunkWithConcurrencyControl(torrent, movie, chunkIndex, res) {
  const chunkKey = `${movie}_${chunkIndex}`;
  
  // Check if chunk is already being extracted
  if (chunkExtractionQueue.has(chunkKey)) {
    console.log(`⏳ Parallel tracker waiting for existing extraction of chunk ${chunkIndex} for ${movie}`);
    try {
      await chunkExtractionQueue.get(chunkKey);
      // After extraction completes, serve the file
      const sanitizedMovie = movie.replace(/[^a-zA-Z0-9\-_]/g, '_');
      const chunkPath = path.join(__dirname, "chunks", `${sanitizedMovie}.chunk${chunkIndex}`);
      if (fs.existsSync(chunkPath)) {
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${sanitizedMovie}.chunk${chunkIndex}"`);
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.setHeader('X-Chunk-Source', 'cached-parallel');
        return res.sendFile(chunkPath);
      }
    } catch (error) {
      throw error;
    }
  }
  
  // Initialize active extractions set for this movie
  if (!activeExtractions.has(movie)) {
    activeExtractions.set(movie, new Set());
  }
  
  const movieExtractions = activeExtractions.get(movie);
  
  // Wait if too many concurrent extractions
  while (movieExtractions.size >= maxConcurrentExtractions) {
    console.log(`⏳ Parallel tracker too many concurrent extractions for ${movie}, waiting...`);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  
  // Add to active extractions
  movieExtractions.add(chunkIndex);
  
  // Create extraction promise
  const extractionPromise = extractChunkFromTorrent(torrent, movie, chunkIndex, res);
  chunkExtractionQueue.set(chunkKey, extractionPromise);
  
  try {
    await extractionPromise;
  } finally {
    // Clean up
    movieExtractions.delete(chunkIndex);
    chunkExtractionQueue.delete(chunkKey);
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Initialize streaming engine pool
const maxConcurrentStreams = 5;
const availableEngines = [];

// Create engine pool
for (let i = 0; i < maxConcurrentStreams; i++) {
    const engine = new ParallelStreamingEngine({
        maxWorkers: Math.max(2, Math.floor(require('os').cpus().length / 2))
    });
    availableEngines.push(engine);
}

/**
 * Store magnet link for a movie in parallel tracker
 * Endpoint: POST /store_magnet
 */
router.post("/store_magnet", async (req, res) => {
  const { movie, magnetLink } = req.body;
  
  if (!movie || !magnetLink) {
    return res.status(400).json({ error: 'Movie and magnetLink are required' });
  }
  
  console.log(`💾 Storing magnet link for parallel tracker: ${movie}`);
  magnetLinks.set(movie, magnetLink);
  
  // Start downloading torrent immediately
  try {
    await downloadTorrent(movie, magnetLink);
    res.json({ success: true, message: 'Magnet link stored and torrent started for parallel tracker' });
  } catch (error) {
    console.error(`❌ Error starting torrent for parallel tracker ${movie}:`, error.message);
    res.json({ success: true, message: 'Magnet link stored for parallel tracker, torrent will start when needed' });
  }
});

/**
 * Get movie information including chunk count for parallel tracker
 * Endpoint: GET /get_movie_info
 */
router.get("/get_movie_info", async (req, res) => {
  const { movie } = req.query;
  
  if (!movie) {
    return res.status(400).json({ error: 'Movie parameter is required' });
  }
  
  try {
    let torrent = activeTorrents.get(movie);
    
    // If no torrent exists, try to start it with stored magnet link
    if (!torrent && magnetLinks.has(movie)) {
      const magnetLink = magnetLinks.get(movie);
      torrent = await downloadTorrent(movie, magnetLink);
    }
    
    if (!torrent) {
      // Return default values if no torrent is available
      const defaultInfo = {
        totalChunks: 250, // Default for ~500MB file
        chunkSize: 2 * 1024 * 1024, // 2MB chunks
        fileSize: 500 * 1024 * 1024, // 500MB estimated
        mimeType: 'video/mp4'
      };
      
      movieChunkInfo[movie] = defaultInfo;
      return res.json(defaultInfo);
    }
    
    // Calculate real chunk info from torrent
    const videoFile = torrent.files.find(file => 
      file.name.match(/\.(mp4|mkv|avi|mov|wmv|flv|webm|m4v)$/i)
    ) || torrent.files[0];
    
    if (videoFile) {
      const chunkSize = 2 * 1024 * 1024; // 2MB chunks
      const totalChunks = Math.ceil(videoFile.length / chunkSize);
      
      const movieInfo = {
        totalChunks,
        chunkSize,
        fileSize: videoFile.length,
        mimeType: 'video/mp4',
        fileName: videoFile.name
      };
      
      movieChunkInfo[movie] = movieInfo;
      console.log(`📊 Parallel tracker movie info for ${movie}: ${totalChunks} chunks (${formatBytes(videoFile.length)})`);
      
      res.json(movieInfo);
    } else {
      throw new Error('No video file found in torrent');
    }
    
  } catch (error) {
    console.error(`❌ Error getting movie info for parallel tracker ${movie}:`, error.message);
    res.status(500).json({ error: 'Failed to get movie info from parallel tracker', details: error.message });
  }
});

/**
 * Register a peer's chunk with parallel processing support
 * Endpoint: POST /register_chunk
 */
router.post("/register_chunk", (req, res) => {
    const { movie, chunkIndex, peerId } = req.body;

    if (!chunkRegistry[movie]) {
        chunkRegistry[movie] = {};
    }
    if (!chunkRegistry[movie][chunkIndex]) {
        chunkRegistry[movie][chunkIndex] = [];
    }

    // Add peer to the chunk registry if not already present
    if (!chunkRegistry[movie][chunkIndex].includes(peerId)) {
        chunkRegistry[movie][chunkIndex].push(peerId);
        console.log(`📝 Registered chunk ${chunkIndex} of '${movie}' for peer ${peerId}`);
        
        // Update peer connection info
        updatePeerChunkInfo(peerId, movie, chunkIndex);
    }

    res.json({ success: true, message: "Chunk registered successfully" });
});

/**
 * Start parallel streaming for a movie
 * Endpoint: POST /start_parallel_stream
 */
router.post("/start_parallel_stream", async (req, res) => {
    const { movie, peerId } = req.body;
    
    try {
        console.log(`🚀 Starting parallel stream for ${movie} requested by ${peerId}`);
        
        // Get movie info
        const movieInfo = await getMovieInfo(movie);
        if (!movieInfo) {
            return res.status(404).json({ error: 'Movie not found' });
        }

        // Get available streaming engine
        const engine = getAvailableStreamingEngine();
        if (!engine) {
            return res.status(503).json({ error: 'No streaming engines available' });
        }

        // Get peer connections for this movie
        const peerConnections = getPeerConnectionsForMovie(movie);
        
        // Start parallel streaming
        const streamResult = await engine.startParallelStream(
            movie, 
            movieInfo.totalChunks, 
            peerConnections
        );

        // Store engine reference
        streamingEngines.set(`${movie}_${peerId}`, engine);

        // Set up real-time events
        setupStreamingEvents(engine, movie, peerId, res);

        res.json({
            success: true,
            streamId: `${movie}_${peerId}`,
            stats: streamResult.stats,
            message: 'Parallel streaming started'
        });

    } catch (error) {
        console.error(`❌ Error starting parallel stream:`, error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Get streaming progress
 * Endpoint: GET /stream_progress
 */
router.get("/stream_progress", (req, res) => {
    const { streamId } = req.query;
    
    const engine = streamingEngines.get(streamId);
    if (!engine) {
        return res.status(404).json({ error: 'Stream not found' });
    }

    const [movie] = streamId.split('_');
    const stats = engine.getStreamingStats(movie);
    
    res.json({
        streamId,
        stats,
        timestamp: Date.now()
    });
});

/**
 * Stream movie chunks with parallel processing
 * Endpoint: GET /stream_movie
 */
router.get("/stream_movie", async (req, res) => {
    const { movie, peerId } = req.query;
    const streamId = `${movie}_${peerId}`;
    
    try {
        const engine = streamingEngines.get(streamId);
        if (!engine) {
            return res.status(404).json({ error: 'Stream not found. Start streaming first.' });
        }

        const [movieName] = streamId.split('_');
        const streamResult = engine.createStreamResponse(movieName);
        
        // Set headers for video streaming
        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        
        // Pipe the parallel-processed stream
        streamResult.stream.pipe(res);
        
        // Handle stream events
        streamResult.stream.on('error', (error) => {
            console.error(`❌ Stream error for ${streamId}:`, error);
            res.status(500).end();
        });

        streamResult.stream.on('end', () => {
            console.log(`✅ Stream completed for ${streamId}`);
            // Clean up engine
            setTimeout(() => {
                streamingEngines.delete(streamId);
                availableEngines.push(engine);
            }, 5000);
        });

    } catch (error) {
        console.error(`❌ Error streaming movie:`, error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Get chunk with parallel processing
 * Endpoint: GET /download_chunk_parallel
 */
router.get("/download_chunk_parallel", async (req, res) => {
    const { movie, chunkIndex, peerId } = req.query;
    const chunkIdx = parseInt(chunkIndex);
    
    try {
        console.log(`⚡ Parallel chunk request: ${movie} chunk ${chunkIdx} for peer ${peerId}`);
        
        // Get available peers for this chunk
        const availablePeers = chunkRegistry[movie]?.[chunkIdx] || [];
        
        if (availablePeers.length > 0) {
            // Use parallel processing to get chunk from peers
            const chunkData = await getChunkFromPeersParallel(movie, chunkIdx, availablePeers, peerId);
            
            if (chunkData) {
                res.setHeader('Content-Type', 'application/octet-stream');
                res.setHeader('X-Chunk-Source', 'p2p-parallel');
                res.setHeader('X-Source-Peers', availablePeers.length.toString());
                return res.send(chunkData);
            }
        }
          // Fallback to real torrent extraction for parallel processing
        let torrent = activeTorrents.get(movie);
        
        // If no torrent exists, try to start it with stored magnet link
        if (!torrent && magnetLinks.has(movie)) {
            const magnetLink = magnetLinks.get(movie);
            console.log(`🚀 Starting torrent for parallel chunk extraction: ${movie}`);
            torrent = await downloadTorrent(movie, magnetLink);
        }
        
        if (!torrent) {
            console.error(`❌ No torrent available for parallel tracker ${movie}`);
            return res.status(404).json({ 
                error: 'No torrent available for this movie in parallel tracker',
                movie,
                chunkIndex: chunkIdx,
                suggestion: 'Please provide a magnet link first'
            });
        }
        
        // Extract real chunk from torrent with concurrency control
        await extractChunkWithConcurrencyControl(torrent, movie, chunkIdx, res);
        
    } catch (error) {
        console.error(`❌ Error downloading chunk ${chunkIdx}:`, error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Get real-time streaming statistics
 * Endpoint: GET /streaming_stats
 */
router.get("/streaming_stats", (req, res) => {
    const stats = {
        activeStreams: streamingEngines.size,
        availableEngines: availableEngines.length,
        totalEngines: maxConcurrentStreams,
        systemInfo: {
            cpuCount: require('os').cpus().length,
            freeMemory: Math.round(require('os').freemem() / 1024 / 1024),
            totalMemory: Math.round(require('os').totalmem() / 1024 / 1024)
        },
        activeMovies: Object.keys(chunkRegistry).length,
        totalRegisteredChunks: getTotalRegisteredChunks()
    };
    
    res.json(stats);
});

/**
 * Batch register multiple chunks for efficient processing
 * Endpoint: POST /register_chunks_batch
 */
router.post("/register_chunks_batch", (req, res) => {
    const { movie, chunks, peerId } = req.body; // chunks = [chunkIndex1, chunkIndex2, ...]
    
    if (!Array.isArray(chunks)) {
        return res.status(400).json({ error: 'Chunks must be an array' });
    }

    let registered = 0;
    
    chunks.forEach(chunkIndex => {
        if (!chunkRegistry[movie]) {
            chunkRegistry[movie] = {};
        }
        if (!chunkRegistry[movie][chunkIndex]) {
            chunkRegistry[movie][chunkIndex] = [];
        }
        
        if (!chunkRegistry[movie][chunkIndex].includes(peerId)) {
            chunkRegistry[movie][chunkIndex].push(peerId);
            registered++;
        }
    });
    
    console.log(`📝 Batch registered ${registered} chunks for ${movie} by peer ${peerId}`);
    
    res.json({ 
        success: true, 
        registered,
        total: chunks.length,
        message: `Registered ${registered} chunks` 
    });
});

// Helper functions

function getAvailableStreamingEngine() {
    return availableEngines.pop() || null;
}

function updatePeerChunkInfo(peerId, movie, chunkIndex) {
    if (!peerConnections.has(peerId)) {
        peerConnections.set(peerId, {
            id: peerId,
            connectedAt: Date.now(),
            availableChunks: new Set(),
            movies: new Set()
        });
    }
    
    const peerInfo = peerConnections.get(peerId);
    peerInfo.availableChunks.add(chunkIndex);
    peerInfo.movies.add(movie);
    peerInfo.lastSeen = Date.now();
}

function getPeerConnectionsForMovie(movie) {
    const connections = [];
    
    for (const [peerId, peerInfo] of peerConnections) {
        if (peerInfo.movies.has(movie)) {
            connections.push({
                id: peerId,
                availableChunks: Array.from(peerInfo.availableChunks),
                connectedAt: peerInfo.connectedAt,
                lastSeen: peerInfo.lastSeen
            });
        }
    }
    
    return connections;
}

async function getMovieInfo(movie) {
    // Return cached info or calculate dynamically from file system
    if (!movieChunkInfo[movie]) {
        try {
            // Try to get actual file size from chunks directory
            const fs = require('fs');
            const path = require('path');
            const chunksDir = path.join(__dirname, 'chunks');
            
            // Look for chunk files for this movie
            const chunkFiles = fs.readdirSync(chunksDir)
                .filter(file => file.startsWith(movie.replace(/[^a-zA-Z0-9]/g, '_')))
                .sort();
            
            if (chunkFiles.length > 0) {
                // Calculate total chunks from existing files
                const totalChunks = chunkFiles.length;
                const chunkSize = 2 * 1024 * 1024; // 2MB standard chunk size
                const fileSize = totalChunks * chunkSize;
                
                movieChunkInfo[movie] = {
                    totalChunks,
                    chunkSize,
                    fileSize,
                    mimeType: 'video/mp4'
                };
            } else {
                // Fallback: estimate based on average movie size (500MB)
                const estimatedSize = 500 * 1024 * 1024; // 500MB
                const chunkSize = 2 * 1024 * 1024; // 2MB chunks
                const totalChunks = Math.ceil(estimatedSize / chunkSize);
                
                movieChunkInfo[movie] = {
                    totalChunks,
                    chunkSize,
                    fileSize: estimatedSize,
                    mimeType: 'video/mp4'
                };
            }
        } catch (err) {
            console.error(`❌ Error calculating movie info for ${movie}:`, err.message);
            // Ultimate fallback
            const estimatedSize = 500 * 1024 * 1024; // 500MB
            const chunkSize = 2 * 1024 * 1024; // 2MB chunks
            movieChunkInfo[movie] = {
                totalChunks: Math.ceil(estimatedSize / chunkSize),
                chunkSize,
                fileSize: estimatedSize,
                mimeType: 'video/mp4'
            };
        }
    }
    
    return movieChunkInfo[movie];
}

async function getChunkFromPeersParallel(movie, chunkIndex, availablePeers, requestingPeer) {
    // For now, return null to force fallback to real torrent extraction
    // In a full P2P implementation, this would use WebRTC to get chunks from peers
    console.log(`🔄 P2P chunk request from ${availablePeers.length} peers for ${movie} chunk ${chunkIndex} - falling back to torrent`);
    return null;
}

// Helper functions for parallel tracker operations

function setupStreamingEvents(engine, movie, peerId, res) {
    const streamId = `${movie}_${peerId}`;
    
    engine.on('chunkReady', (data) => {
        console.log(`📦 Chunk ${data.chunkIndex} ready for ${data.movieId}`);
    });
    
    engine.on('streamReady', (data) => {
        console.log(`🎬 Stream ready for ${data.movieId} with ${data.readyChunks} chunks`);
    });
    
    engine.on('chunkProgress', (data) => {
        // Could emit progress via WebSocket for real-time updates
    });
}

function getTotalRegisteredChunks() {
    let total = 0;
    Object.values(chunkRegistry).forEach(movie => {
        Object.values(movie).forEach(chunkPeers => {
            total += chunkPeers.length;
        });
    });
    return total;
}

// Cleanup old peer connections periodically
setInterval(() => {
    const staleThreshold = 5 * 60 * 1000; // 5 minutes
    const now = Date.now();
    
    for (const [peerId, peerInfo] of peerConnections) {
        if (now - peerInfo.lastSeen > staleThreshold) {
            peerConnections.delete(peerId);
            
            // Remove from chunk registry
            Object.keys(chunkRegistry).forEach(movie => {
                Object.keys(chunkRegistry[movie]).forEach(chunkIndex => {
                    const peerIndex = chunkRegistry[movie][chunkIndex].indexOf(peerId);
                    if (peerIndex > -1) {
                        chunkRegistry[movie][chunkIndex].splice(peerIndex, 1);
                    }
                });
            });
            
            console.log(`🧹 Cleaned up stale peer: ${peerId}`);
        }
    }
}, 60000); // Run every minute

module.exports = router;
