const fs = require("fs");
const path = require("path");

/**
 * Simulates dividing a movie into chunks.
 * @param {string} moviePath - Path to the movie file.
 * @param {number} chunkSize - Size of each chunk in bytes.
 * @returns {Array} - Array of chunk metadata.
 */
function divideIntoChunks(moviePath, chunkSize) {
  const movieName = path.basename(moviePath);
  const stats = fs.statSync(moviePath);
  const totalSize = stats.size;
  const chunks = [];

  let offset = 0;
  let chunkIndex = 0;

  while (offset < totalSize) {
    const size = Math.min(chunkSize, totalSize - offset);
    chunks.push({
      movie: movieName,
      chunkIndex,
      offset,
      size,
    });
    offset += size;
    chunkIndex++;
  }

  return chunks;
}

/**
 * Simulates fetching a chunk's data.
 * @param {string} moviePath - Path to the movie file.
 * @param {number} offset - Offset of the chunk.
 * @param {number} size - Size of the chunk.
 * @returns {Buffer} - Chunk data.
 */
function getChunkData(moviePath, offset, size) {
  const buffer = Buffer.alloc(size);
  const fd = fs.openSync(moviePath, "r");
  fs.readSync(fd, buffer, 0, size, offset);
  fs.closeSync(fd);
  return buffer;
}

/**
 * Physically splits a movie file into chunks and saves them to disk.
 * @param {string} moviePath - Path to the movie file.
 * @param {number} chunkSize - Size of each chunk in bytes.
 * @param {string} outputDir - Directory to save the chunks.
 */
function splitMovieIntoChunks(moviePath, chunkSize, outputDir) {
  const movieName = path.basename(moviePath);
  const stats = fs.statSync(moviePath);
  const totalSize = stats.size;

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  let offset = 0;
  let chunkIndex = 0;

  while (offset < totalSize) {
    const size = Math.min(chunkSize, totalSize - offset);
    const buffer = Buffer.alloc(size);

    const fd = fs.openSync(moviePath, "r");
    fs.readSync(fd, buffer, 0, size, offset);
    fs.closeSync(fd);

    const chunkPath = path.join(outputDir, `${movieName}.chunk${chunkIndex}`);
    fs.writeFileSync(chunkPath, buffer);

    console.log(`Chunk ${chunkIndex} saved to ${chunkPath}`);

    offset += size;
    chunkIndex++;
  }
}

module.exports = { divideIntoChunks, getChunkData, splitMovieIntoChunks };
