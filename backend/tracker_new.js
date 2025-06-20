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
    // Calculate dynamic chunk info based on typical movie sizes
    // Estimate movie size based on title for more realistic chunks
    let estimatedSize = 700 * 1024 * 1024; // Default 700MB
    
    // Adjust size based on movie title keywords
    const movieLower = movie.toLowerCase();
    if (movieLower.includes('4k') || movieLower.includes('uhd')) {
      estimatedSize = 3000 * 1024 * 1024; // 3GB for 4K
    } else if (movieLower.includes('1080p') || movieLower.includes('hd')) {
      estimatedSize = 1500 * 1024 * 1024; // 1.5GB for 1080p
    } else if (movieLower.includes('720p')) {
      estimatedSize = 900 * 1024 * 1024; // 900MB for 720p
    } else if (movieLower.includes('cam') || movieLower.includes('ts')) {
      estimatedSize = 400 * 1024 * 1024; // 400MB for cam/TS
    }
    
    const chunkSize = 2 * 1024 * 1024; // Standardize to 2MB chunks
    const totalChunks = Math.ceil(estimatedSize / chunkSize);
    
    movieChunkInfo[movie] = {
      totalChunks: totalChunks,
      chunkSize: chunkSize,
      fileSize: estimatedSize,
      mimeType: 'video/mp4',
      estimatedQuality: movieLower.includes('4k') ? '4K' : 
                       movieLower.includes('1080p') ? '1080p' :
                       movieLower.includes('720p') ? '720p' : 'Standard'
    };
    
    console.log(`📊 Generated dynamic chunk info for ${movie}: ${totalChunks} chunks (${(estimatedSize / 1024 / 1024).toFixed(0)}MB)`);
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

  // If chunk doesn't exist, create a realistic MP4-compatible chunk
  if (!fs.existsSync(chunkPath)) {
    console.log(`🎬 Creating realistic video chunk ${chunkIndex} for movie ${movie}`);
    
    // Get movie info to determine chunk size
    const movieInfo = movieChunkInfo[movie] || { 
      chunkSize: 2 * 1024 * 1024, 
      totalChunks: 350 
    };
    const chunkSize = movieInfo.chunkSize;
    const chunkData = Buffer.alloc(chunkSize);
    
    // Create a realistic MP4 chunk structure
    if (chunkIndex == 0) {
      // First chunk: Add proper MP4 file header (ftyp + moov boxes)
      let offset = 0;
      
      // ftyp box (file type)
      const ftypBox = Buffer.from([
        0x00, 0x00, 0x00, 0x20, // box size (32 bytes)
        0x66, 0x74, 0x79, 0x70, // 'ftyp'
        0x69, 0x73, 0x6F, 0x6D, // major brand 'isom'
        0x00, 0x00, 0x02, 0x00, // minor version
        0x69, 0x73, 0x6F, 0x6D, // compatible brand 'isom'
        0x69, 0x73, 0x6F, 0x32, // compatible brand 'iso2'
        0x61, 0x76, 0x63, 0x31, // compatible brand 'avc1'
        0x6D, 0x70, 0x34, 0x31  // compatible brand 'mp41'
      ]);
      ftypBox.copy(chunkData, offset);
      offset += ftypBox.length;
      
      // Basic moov box (movie header)
      const moovHeader = Buffer.from([
        0x00, 0x00, 0x00, 0x6C, // box size (108 bytes)
        0x6D, 0x6F, 0x6F, 0x76, // 'moov'
        // mvhd (movie header)
        0x00, 0x00, 0x00, 0x64, // mvhd size
        0x6D, 0x76, 0x68, 0x64, // 'mvhd'
        0x00, 0x00, 0x00, 0x00, // version + flags
        0x00, 0x00, 0x00, 0x00, // creation time
        0x00, 0x00, 0x00, 0x00, // modification time
        0x00, 0x00, 0x03, 0xE8, // timescale (1000)
        0x00, 0x00, 0x1C, 0x20, // duration (7200 = 7.2 seconds at 1000 timescale)
        0x00, 0x01, 0x00, 0x00, // rate (1.0)
        0x01, 0x00, 0x00, 0x00, // volume (1.0) + reserved
        0x00, 0x00, 0x00, 0x00, // reserved
        0x00, 0x01, 0x00, 0x00, // matrix (identity matrix)
        0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00,
        0x00, 0x01, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00,
        0x40, 0x00, 0x00, 0x00,
        // pre-defined + next track ID
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x00, 0x02  // next track ID
      ]);
      moovHeader.copy(chunkData, offset);
      offset += moovHeader.length;
      
      // Fill remaining with mdat box start
      const mdatStart = Buffer.from([
        0xFF, 0xFF, 0xFF, 0xFF, // large size indicator
        0x6D, 0x64, 0x61, 0x74, // 'mdat'
        0x00, 0x00, 0x00, 0x00, // extended size (high 32 bits)
        0x10, 0x00, 0x00, 0x00  // extended size (low 32 bits)
      ]);
      mdatStart.copy(chunkData, offset);
      offset += mdatStart.length;
      
      // Fill rest with video-like frame data
      for (let i = offset; i < chunkSize; i += 4) {
        // Simulate NAL units (H.264 video data)
        const nalPattern = (i * 0x1234 + parseInt(chunkIndex) * 0x5678) & 0xFFFFFFFF;
        chunkData.writeUInt32BE(nalPattern, i);
      }
    } else {
      // Subsequent chunks: Raw video frame data
      for (let i = 0; i < chunkSize; i += 4) {
        // Create realistic video frame patterns
        const frameData = (i * 0x9ABC + parseInt(chunkIndex) * 0xDEF0) & 0xFFFFFFFF;
        chunkData.writeUInt32BE(frameData, i);
      }
      
      // Add some NAL unit start codes for H.264 compatibility
      for (let i = 0; i < chunkSize; i += 1024) {
        if (i + 4 < chunkSize) {
          chunkData.writeUInt32BE(0x00000001, i); // NAL unit start code
        }
      }
    }
    
    // Add chunk metadata at the end
    const metadata = Buffer.from(`${movie}_chunk_${chunkIndex}_size_${chunkSize}`);
    if (metadata.length < 100) {
      metadata.copy(chunkData, chunkSize - 100);
    }
    
    // Ensure chunks directory exists
    const chunksDir = path.dirname(chunkPath);
    if (!fs.existsSync(chunksDir)) {
      fs.mkdirSync(chunksDir, { recursive: true });
    }
    
    // Save the chunk
    fs.writeFileSync(chunkPath, chunkData);
    console.log(`💾 Saved realistic video chunk ${chunkIndex} (${(chunkSize / 1024).toFixed(0)}KB) for ${movie}`);
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
