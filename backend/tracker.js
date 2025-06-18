const express = require("express");
const router = express.Router();
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

// Chunk registry to track which peers have which chunks
const chunkRegistry = {}; // { movie: { chunkIndex: [peerId, ...] } }
const movieChunkInfo = {}; // { movie: { totalChunks: number, chunkSize: number } }

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
  if (!chunkRegistry[movie][chunkIndex].includes(peerId)) {
    chunkRegistry[movie][chunkIndex].push(peerId);
  }

  console.log(`Registered chunk ${chunkIndex} of '${movie}' for peer ${peerId}`);
  res.json({ message: `Chunk ${chunkIndex} of '${movie}' registered for peer ${peerId}` });
});

/**
 * Get the chunk map for a movie.
 * Endpoint: GET /get_chunk_map
 * Query: ?movie=movieName
 */
router.get("/get_chunk_map", (req, res) => {
  const { movie } = req.query;
  console.log(`Fetching chunk map for movie: ${movie}`);

  if (!chunkRegistry[movie]) {
    return res.json({});
  }

  res.json(chunkRegistry[movie]);
});

/**
 * Get movie chunk info (total chunks, etc.)
 * Endpoint: GET /get_movie_info
 * Query: ?movie=movieName
 */
router.get("/get_movie_info", (req, res) => {
  const { movie } = req.query;
  
  if (!movieChunkInfo[movie]) {
    movieChunkInfo[movie] = {
      totalChunks: 10,
      chunkSize: 1024 * 1024, // 1MB per chunk
      fileSize: 10 * 1024 * 1024, // 10MB total
      mimeType: 'video/mp4'
    };
  }
  
  res.json(movieChunkInfo[movie]);
});

/**
 * Get peers that have specific chunks for a movie
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
 * Serve a specific chunk to a peer.
 * Endpoint: GET /download_chunk
 * Query: ?movie=movieName&chunkIndex=chunkIndex
 */
router.get("/download_chunk", (req, res) => {
  const { movie, chunkIndex } = req.query;
  const sanitizedMovie = movie.replace(/[^a-zA-Z0-9\-_]/g, '_');
  const chunkPath = path.join(__dirname, "chunks", `${sanitizedMovie}.chunk${chunkIndex}`);

  // If chunk doesn't exist, create it with more realistic video-like data
  if (!fs.existsSync(chunkPath)) {
    console.log(`Creating video-like chunk ${chunkIndex} for movie ${movie}`);
    
    // Create more realistic video chunk data
    const chunkSize = 1024 * 1024; // 1MB
    const chunkData = Buffer.alloc(chunkSize);
    
    // Create a pattern that resembles video data
    // Video files typically have headers, metadata, and encoded frames
    
    // Add a fake video header (first 1KB) for chunk 0
    if (chunkIndex == 0) {
      // MP4 file signature and header-like data
      const header = Buffer.from([
        0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, // ftyp box
        0x69, 0x73, 0x6F, 0x6D, 0x00, 0x00, 0x02, 0x00, // isom brand
        0x69, 0x73, 0x6F, 0x6D, 0x69, 0x73, 0x6F, 0x32, // compatible brands
        0x61, 0x76, 0x63, 0x31, 0x6D, 0x70, 0x34, 0x31, // avc1, mp41
      ]);
      header.copy(chunkData, 0);
      
      // Add movie title and chunk info as metadata
      const metaInfo = `${movie}_chunk_${chunkIndex}_${Date.now()}`;
      Buffer.from(metaInfo).copy(chunkData, header.length);
    }
    
    // Fill the rest with pseudo-random video-like data
    for (let i = 1024; i < chunkSize; i += 4) {
      // Create patterns that simulate compressed video frames
      const framePattern = (i + parseInt(chunkIndex) * 1000) % 65536;
      chunkData.writeUInt16BE(framePattern, i);
      if (i + 2 < chunkSize) {
        chunkData.writeUInt16BE(~framePattern, i + 2);
      }
    }
    
    // Add chunk boundary markers
    const boundary = Buffer.from(`CHUNK_${chunkIndex}_END_${movie}`);
    if (boundary.length < chunkSize) {
      boundary.copy(chunkData, chunkSize - boundary.length);
    }
    
    // Ensure chunks directory exists
    const chunksDir = path.dirname(chunkPath);
    if (!fs.existsSync(chunksDir)) {
      fs.mkdirSync(chunksDir, { recursive: true });
    }
    
    // Save the chunk
    fs.writeFileSync(chunkPath, chunkData);
  }

  // Set appropriate headers for video content
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${sanitizedMovie}.chunk${chunkIndex}"`);
  res.setHeader('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
  
  res.sendFile(chunkPath);
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

module.exports = router;
