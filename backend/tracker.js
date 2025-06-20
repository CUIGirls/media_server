const express = require("express");
const router = express.Router();
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

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
      console.log('✅ WebTorrent initialized successfully');
    }
    return torrentClient;
  } catch (error) {
    console.error('❌ Failed to initialize WebTorrent:', error.message);
    return null;
  }
}

// Enhanced data structures for better concurrency handling
const chunkRegistry = {}; // { movie: { chunkIndex: [peerId, ...] } }
const movieChunkInfo = {}; // { movie: { totalChunks: number, chunkSize: number } }
const activeTorrents = new Map(); // { movie: torrent }
const magnetLinks = new Map(); // { movie: magnetLink }

// Concurrency control for chunk extraction
const chunkExtractionQueue = new Map(); // { movie_chunkIndex: Promise }
const activeExtractions = new Map(); // { movie: Set of chunkIndexes being extracted }
const maxConcurrentExtractions = 3; // Limit concurrent extractions per movie

// Create chunks directory if it doesn't exist
const chunksDir = path.join(__dirname, "chunks");
if (!fs.existsSync(chunksDir)) {
  fs.mkdirSync(chunksDir, { recursive: true });
}

/**
 * Register a peer's chunk.
 * Endpoint: POST /register_chunk
 * Body: { movie: string, chunkIndex: number, peerId: string }
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
    console.log(`Registered chunk ${chunkIndex} of '${movie}' for peer ${peerId}`);
  }

  res.json({ success: true, message: "Chunk registered successfully" });
});

/**
 * Get the chunk map for a specific movie.
 * Endpoint: GET /get_chunk_map
 * Query: ?movie=movieName
 */
router.get("/get_chunk_map", (req, res) => {
  const { movie } = req.query;
  const chunkMap = chunkRegistry[movie] || {};
  
  console.log(`Chunk map requested for ${movie}:`, Object.keys(chunkMap).length, 'chunks available');
  res.json(chunkMap);
});

/**
 * Store magnet link for a movie
 * Endpoint: POST /store_magnet
 * Body: { movie: string, magnetLink: string }
 */
router.post("/store_magnet", async (req, res) => {
  const { movie, magnetLink } = req.body;
  
  if (!movie || !magnetLink) {
    return res.status(400).json({ error: 'Movie and magnetLink are required' });
  }
  
  console.log(`💾 Storing magnet link for ${movie}`);
  magnetLinks.set(movie, magnetLink);
  
  // Start downloading torrent immediately
  try {
    await downloadTorrent(movie, magnetLink);
    res.json({ success: true, message: 'Magnet link stored and torrent started' });
  } catch (error) {
    console.error(`❌ Error starting torrent for ${movie}:`, error.message);
    res.json({ success: true, message: 'Magnet link stored, torrent will start when needed' });
  }
});

/**
 * Get movie information including chunk count
 * Endpoint: GET /get_movie_info
 * Query: ?movie=movieName
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
      return res.status(404).json({ error: 'Movie torrent not found - no real torrent available' });
    }
    
    // Find the main video file (largest file)
    const videoFile = torrent.files.find(file => 
      file.name.toLowerCase().includes('.mp4') || 
      file.name.toLowerCase().includes('.mkv') ||
      file.name.toLowerCase().includes('.avi')
    ) || torrent.files.reduce((largest, file) => 
      file.length > largest.length ? file : largest
    );
    
    const chunkSize = 2 * 1024 * 1024; // 2MB chunks
    const totalChunks = Math.ceil(videoFile.length / chunkSize);
    
    const movieInfo = {
      totalChunks,
      chunkSize,
      fileSize: videoFile.length,
      mimeType: 'video/mp4',
      fileName: videoFile.name,
      torrentName: torrent.name,
      ready: torrent.ready
    };
    
    console.log(`📊 Movie info for ${movie}:`, movieInfo);
    res.json(movieInfo);
    
  } catch (error) {
    console.error(`❌ Error getting movie info for ${movie}:`, error.message);
    res.status(500).json({ error: 'Failed to get movie info', details: error.message });
  }
});

/**
 * Enhanced torrent download function
 */
async function downloadTorrent(movie, magnetLink) {
  console.log(`🚀 Starting torrent download for ${movie}`);
  
  // Check if torrent already exists
  if (activeTorrents.has(movie)) {
    const existingTorrent = activeTorrents.get(movie);
    if (existingTorrent.ready) {
      console.log(`✅ Torrent already ready for ${movie}`);
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
    throw new Error('Failed to initialize WebTorrent client');
  }
  
  return new Promise((resolve, reject) => {
    
    const torrent = client.add(magnetLink, {
      path: path.join(__dirname, 'torrents'),
      destroyStoreOnDestroy: false
    });
    
    activeTorrents.set(movie, torrent);
    
    torrent.on('ready', () => {
      console.log(`✅ Torrent ready for ${movie}: ${torrent.name}`);
      console.log(`📁 Files in torrent:`, torrent.files.map(f => ({ name: f.name, length: f.length })));
      resolve(torrent);
    });
    
    torrent.on('error', (err) => {
      console.error(`❌ Torrent error for ${movie}:`, err.message);
      activeTorrents.delete(movie);
      reject(err);
    });
    
    torrent.on('download', (bytes) => {
      const progress = (torrent.downloaded / torrent.length * 100).toFixed(1);
      if (torrent.downloaded % (10 * 1024 * 1024) === 0) { // Log every 10MB
        console.log(`📊 Download progress for ${movie}: ${progress}% (${formatBytes(torrent.downloaded)}/${formatBytes(torrent.length)})`);
      }
    });
    
    // Set timeout for torrent readiness
    setTimeout(() => {
      if (!torrent.ready) {
        console.log(`⏰ Torrent not ready after 60s for ${movie}, but continuing...`);
        resolve(torrent);
      }
    }, 60000);
  });
}

/**
 * Enhanced chunk extraction with concurrency control
 */
async function extractChunkWithConcurrencyControl(torrent, movie, chunkIndex, res) {
  const chunkKey = `${movie}_${chunkIndex}`;
  
  // Check if chunk is already being extracted
  if (chunkExtractionQueue.has(chunkKey)) {
    console.log(`⏳ Waiting for existing extraction of chunk ${chunkIndex} for ${movie}`);
    try {
      await chunkExtractionQueue.get(chunkKey);
      // After extraction completes, serve the file
      const sanitizedMovie = movie.replace(/[^a-zA-Z0-9\-_]/g, '_');
      const chunkPath = path.join(__dirname, "chunks", `${sanitizedMovie}.chunk${chunkIndex}`);
      if (fs.existsSync(chunkPath)) {
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${sanitizedMovie}.chunk${chunkIndex}"`);
        res.setHeader('Cache-Control', 'public, max-age=3600');
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
    console.log(`⏳ Too many concurrent extractions for ${movie}, waiting...`);
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

/**
 * Extract a specific chunk from a torrent file - IMPROVED
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
      
      console.log(`📥 Extracting chunk ${chunkIndex}: offset=${offset}, length=${length} from ${videoFile.name}`);
      
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
            console.log(`⚠️ Chunk ${chunkIndex} extraction timeout, retrying (${retryCount}/${maxRetries})`);
            setTimeout(attemptExtraction, 1000 * retryCount);
          } else {
            const error = new Error(`Chunk ${chunkIndex} extraction timeout after ${maxRetries} retries`);
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
              console.log(`⚠️ Chunk ${chunkIndex} no data received, retrying (${retryCount}/${maxRetries})`);
              setTimeout(attemptExtraction, 1000 * retryCount);
              return;
            } else {
              const error = new Error(`Chunk ${chunkIndex} no data received after ${maxRetries} retries`);
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
            console.log(`✅ Chunk ${chunkIndex} extracted and saved for ${movie} (${chunkData.length} bytes)`);
          } catch (saveError) {
            console.warn(`⚠️ Failed to save chunk ${chunkIndex} to disk:`, saveError.message);
            // Continue serving even if save fails
          }
          
          // Send the chunk
          if (!res.headersSent) {
            res.setHeader('Content-Type', 'application/octet-stream');
            res.setHeader('Content-Disposition', `attachment; filename="${sanitizedMovie}.chunk${chunkIndex}"`);
            res.setHeader('Cache-Control', 'public, max-age=3600');
            res.send(chunkData);
          }
          
          resolve();
        });
          
        chunkStream.on('error', (err) => {
          clearTimeout(streamTimeout);
          console.error(`❌ Stream error reading chunk ${chunkIndex}:`, err.message);
          
          if (retryCount < maxRetries) {
            retryCount++;
            console.log(`⚠️ Chunk ${chunkIndex} stream error, retrying (${retryCount}/${maxRetries})`);
            setTimeout(attemptExtraction, 1000 * retryCount);
          } else {
            if (!res.headersSent) {
              res.status(500).json({ 
                error: `Failed to read chunk ${chunkIndex} after ${maxRetries} retries`,
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
      console.error(`❌ Error setting up chunk ${chunkIndex} extraction:`, error.message);
      if (!res.headersSent) {
        res.status(500).json({ 
          error: `Failed to extract chunk ${chunkIndex}`,
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
 * Serve a specific chunk to a peer - ENHANCED with concurrency control
 * Endpoint: GET /download_chunk
 * Query: ?movie=movieName&chunkIndex=chunkIndex
 */
router.get("/download_chunk", async (req, res) => {
  const { movie, chunkIndex } = req.query;
  const chunkIdx = parseInt(chunkIndex);
  const sanitizedMovie = movie.replace(/[^a-zA-Z0-9\-_]/g, '_');
  const chunkPath = path.join(__dirname, "chunks", `${sanitizedMovie}.chunk${chunkIndex}`);
  
  console.log(`🔄 Server requested to serve chunk ${chunkIndex} for ${movie}`);
  
  try {
    // PRIORITY 1: Check if chunk already exists (from previous download)
    if (fs.existsSync(chunkPath)) {
      console.log(`✅ Serving cached chunk ${chunkIndex} for ${movie}`);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', `attachment; filename="${sanitizedMovie}.chunk${chunkIndex}"`);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      return res.sendFile(chunkPath);
    }

    // PRIORITY 2: Extract from torrent with concurrency control
    console.log(`📥 No cached chunk ${chunkIndex} for ${movie}, downloading from torrent`);
    
    const torrent = activeTorrents.get(movie);
    const magnetLink = magnetLinks.get(movie);
    
    if (torrent && torrent.ready) {
      // Torrent exists and is ready - extract chunk with concurrency control
      console.log(`⚡ Extracting chunk ${chunkIndex} from ready torrent for ${movie}`);
      await extractChunkWithConcurrencyControl(torrent, movie, chunkIdx, res);
    } else if (torrent && !torrent.ready) {
      // Torrent exists but not ready yet - wait for it
      console.log(`⏳ Torrent exists but not ready for ${movie}, waiting for chunk ${chunkIndex}`);
      
      const timeout = setTimeout(() => {
        if (!res.headersSent) {
          console.log(`⏰ Torrent timeout for ${movie}, chunk ${chunkIndex}`);
          res.status(504).json({ 
            error: "Torrent timeout - chunk not available",
            movie,
            chunkIndex,
            retry: true 
          });
        }
      }, 30000);
      
      const readyHandler = async () => {
        clearTimeout(timeout);
        if (!res.headersSent) {
          console.log(`✅ Torrent now ready for ${movie}, extracting chunk ${chunkIndex}`);
          try {
            await extractChunkWithConcurrencyControl(torrent, movie, chunkIdx, res);
          } catch (error) {
            console.error(`❌ Error extracting chunk ${chunkIndex} after torrent ready:`, error.message);
            if (!res.headersSent) {
              res.status(500).json({ 
                error: "Chunk extraction failed",
                details: error.message,
                movie,
                chunkIndex,
                retry: true 
              });
            }
          }
        }
      };
      
      const errorHandler = (err) => {
        clearTimeout(timeout);
        console.error(`❌ Torrent error for ${movie}:`, err.message);
        if (!res.headersSent) {
          res.status(500).json({ 
            error: "Torrent failed to load",
            details: err.message,
            movie,
            chunkIndex,
            retry: true 
          });
        }
      };
      
      torrent.once('ready', readyHandler);
      torrent.once('error', errorHandler);
      
      // Clean up listeners if response is sent early
      res.on('finish', () => {
        torrent.removeListener('ready', readyHandler);
        torrent.removeListener('error', errorHandler);
      });
      
    } else if (!torrent && magnetLink) {
      // No torrent exists but we have magnet link - start torrent
      console.log(`🚀 Starting torrent download for ${movie} to extract chunk ${chunkIndex}`);
      
      const client = await initWebTorrent();
      if (client) {
        const newTorrent = client.add(magnetLink, { path: path.join(__dirname, 'torrents') });
        activeTorrents.set(movie, newTorrent);
        
        const timeout = setTimeout(() => {
          if (!res.headersSent) {
            console.log(`⏰ New torrent timeout for ${movie}, chunk ${chunkIndex}`);
            res.status(504).json({ 
              error: "Torrent startup timeout - chunk not available",
              movie,
              chunkIndex,
              retry: true 
            });
          }
        }, 45000); // Longer timeout for new torrents
        
        const readyHandler = async () => {
          clearTimeout(timeout);
          if (!res.headersSent) {
            console.log(`✅ New torrent ready for ${movie}, extracting chunk ${chunkIndex}`);
            try {
              await extractChunkWithConcurrencyControl(newTorrent, movie, chunkIdx, res);
            } catch (error) {
              console.error(`❌ Error extracting chunk ${chunkIndex} from new torrent:`, error.message);
              if (!res.headersSent) {
                res.status(500).json({ 
                  error: "Chunk extraction failed",
                  details: error.message,
                  movie,
                  chunkIndex,
                  retry: true 
                });
              }
            }
          }
        };
        
        const errorHandler = (err) => {
          clearTimeout(timeout);
          console.error(`❌ New torrent error for ${movie}:`, err.message);
          if (!res.headersSent) {
            res.status(500).json({ 
              error: "Failed to start torrent",
              details: err.message,
              movie,
              chunkIndex,
              retry: true 
            });
          }
        };
        
        newTorrent.once('ready', readyHandler);
        newTorrent.once('error', errorHandler);
        
        // Clean up listeners if response is sent early
        res.on('finish', () => {
          newTorrent.removeListener('ready', readyHandler);
          newTorrent.removeListener('error', errorHandler);
        });
        
      } else {
        console.error(`❌ Failed to initialize WebTorrent for ${movie}`);
        res.status(500).json({ 
          error: "WebTorrent initialization failed",
          movie,
          chunkIndex,
          retry: false 
        });
      }    } else {
      // No torrent and no magnet link - cannot serve chunk
      console.error(`❌ No torrent or magnet link available for ${movie}, chunk ${chunkIndex} not available`);
      res.status(404).json({ 
        error: "Chunk not available - no torrent source configured",
        movie,
        chunkIndex,
        retry: false      });
    }
    
  } catch (error) {
    console.error(`❌ Error serving chunk ${chunkIndex} for ${movie}:`, error.message);
    if (!res.headersSent) {
      res.status(500).json({ 
        error: "Failed to serve chunk",
        details: error.message,
        movie,
        chunkIndex,
        retry: true 
      });
    }
  }
});

/**
 * Get peers that have specific chunks
 * Endpoint: GET /get_peers_for_chunks
 * Query: ?movie=movieName&chunks=1,2,3
 */
router.get("/get_peers_for_chunks", (req, res) => {
  const { movie, chunks } = req.query;
  const requestedChunks = chunks ? chunks.split(',').map(c => parseInt(c)) : [];
  const result = {};
  
  if (chunkRegistry[movie]) {
    for (const chunkIndex of requestedChunks) {
      if (chunkRegistry[movie][chunkIndex]) {
        result[chunkIndex] = chunkRegistry[movie][chunkIndex];
      }
    }
  }
  
  res.json(result);
});

/**
 * Upload a chunk from a peer
 * Endpoint: POST /upload_chunk
 */
router.post("/upload_chunk", (req, res) => {
  const { movie, chunkIndex, data } = req.body;
  const sanitizedMovie = movie.replace(/[^a-zA-Z0-9\-_]/g, '_');
  const chunkPath = path.join(__dirname, "chunks", `${sanitizedMovie}.chunk${chunkIndex}`);
  
  try {
    // Convert base64 data back to buffer if needed
    const chunkData = Buffer.isBuffer(data) ? data : Buffer.from(data, 'base64');
    fs.writeFileSync(chunkPath, chunkData);
    
    console.log(`Received and saved chunk ${chunkIndex} for movie ${movie}`);
    res.json({ success: true, message: `Chunk ${chunkIndex} uploaded successfully` });
  } catch (error) {
    console.error(`Error saving chunk ${chunkIndex} for movie ${movie}:`, error);
    res.status(500).json({ error: "Failed to save chunk" });
  }
});

/**
 * Clean up chunks for a disconnected peer
 * Endpoint: POST /cleanup_peer
 */
router.post("/cleanup_peer", (req, res) => {
  const { peerId } = req.body;
  console.log(`Cleaning up chunks for peer: ${peerId}`);

  try {
    // Remove peer from all chunk registries
    for (const movie in chunkRegistry) {
      for (const chunkIndex in chunkRegistry[movie]) {
        const peerIndex = chunkRegistry[movie][chunkIndex].indexOf(peerId);
        if (peerIndex > -1) {
          chunkRegistry[movie][chunkIndex].splice(peerIndex, 1);
          console.log(`Removed peer ${peerId} from chunk ${chunkIndex} of movie ${movie}`);
        }

        // Clean up empty chunk entries
        if (chunkRegistry[movie][chunkIndex].length === 0) {
          delete chunkRegistry[movie][chunkIndex];
        }
      }

      // Clean up empty movie entries
      if (Object.keys(chunkRegistry[movie]).length === 0) {
        delete chunkRegistry[movie];
      }
    }

    res.json({ success: true, message: `Peer ${peerId} cleaned up successfully` });
  } catch (error) {
    console.error(`Error cleaning up peer ${peerId}:`, error);
    res.status(500).json({ error: "Failed to cleanup peer" });
  }
});

// Utility function to format bytes
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

module.exports = router;
