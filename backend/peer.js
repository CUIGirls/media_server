// Peer management utilities for the P2P system
// Note: WebRTC connections are handled on the frontend
// This module provides server-side peer management

/**
 * Represents peer information in the tracker system
 */
class PeerInfo {
  constructor(peerId, socketId) {
    this.peerId = peerId;
    this.socketId = socketId;
    this.connectedAt = Date.now();
    this.lastSeen = Date.now();
    this.chunks = new Set(); // Set of chunk identifiers this peer has
  }

  /**
   * Update the last seen timestamp
   */
  updateLastSeen() {
    this.lastSeen = Date.now();
  }

  /**
   * Add a chunk to this peer's collection
   * @param {string} movieTitle - The movie title
   * @param {number} chunkIndex - The chunk index
   */
  addChunk(movieTitle, chunkIndex) {
    this.chunks.add(`${movieTitle}_${chunkIndex}`);
  }

  /**
   * Remove a chunk from this peer's collection
   * @param {string} movieTitle - The movie title
   * @param {number} chunkIndex - The chunk index
   */
  removeChunk(movieTitle, chunkIndex) {
    this.chunks.delete(`${movieTitle}_${chunkIndex}`);
  }

  /**
   * Check if this peer has a specific chunk
   * @param {string} movieTitle - The movie title
   * @param {number} chunkIndex - The chunk index
   * @returns {boolean}
   */
  hasChunk(movieTitle, chunkIndex) {
    return this.chunks.has(`${movieTitle}_${chunkIndex}`);
  }

  /**
   * Get all chunks for a specific movie
   * @param {string} movieTitle - The movie title
   * @returns {Array<number>} Array of chunk indices
   */
  getChunksForMovie(movieTitle) {
    const movieChunks = [];
    for (const chunkId of this.chunks) {
      if (chunkId.startsWith(`${movieTitle}_`)) {
        const chunkIndex = parseInt(chunkId.split('_')[1]);
        movieChunks.push(chunkIndex);
      }
    }
    return movieChunks.sort((a, b) => a - b);
  }

  /**
   * Get connection duration in milliseconds
   * @returns {number}
   */
  getConnectionDuration() {
    return Date.now() - this.connectedAt;
  }

  /**
   * Check if peer is considered stale (hasn't been seen recently)
   * @param {number} staleThreshold - Threshold in milliseconds (default: 5 minutes)
   * @returns {boolean}
   */
  isStale(staleThreshold = 5 * 60 * 1000) {
    return (Date.now() - this.lastSeen) > staleThreshold;
  }
}

module.exports = { PeerInfo };
