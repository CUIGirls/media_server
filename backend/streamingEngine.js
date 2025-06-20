const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const os = require('os');
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');

/**
 * Parallel Streaming Engine for P2P Chunk Processing
 * Uses worker threads for CPU-intensive operations
 */
class ParallelStreamingEngine extends EventEmitter {
    constructor(options = {}) {
        super();
        this.maxWorkers = options.maxWorkers || os.cpus().length;
        this.chunkSize = options.chunkSize || 1024 * 1024; // 1MB
        this.workers = [];
        this.workerQueue = [];
        this.activeChunks = new Map(); // chunkId -> workerInfo
        this.streamBuffer = new Map(); // movieId -> ordered chunk buffer
        this.downloadQueue = new Map(); // movieId -> chunk queue
        
        console.log(`🚀 Initializing Parallel Streaming Engine with ${this.maxWorkers} workers`);
        this.initializeWorkers();
    }

    /**
     * Initialize worker thread pool
     */
    initializeWorkers() {
        for (let i = 0; i < this.maxWorkers; i++) {
            this.createWorker(i);
        }
    }

    /**
     * Create a new worker thread
     */
    createWorker(workerId) {
        const worker = new Worker(__filename, {
            workerData: { isWorker: true, workerId }
        });

        worker.on('message', (message) => {
            this.handleWorkerMessage(workerId, message);
        });

        worker.on('error', (error) => {
            console.error(`❌ Worker ${workerId} error:`, error);
            this.restartWorker(workerId);
        });

        worker.on('exit', (code) => {
            if (code !== 0) {
                console.error(`❌ Worker ${workerId} exited with code ${code}`);
                this.restartWorker(workerId);
            }
        });

        this.workers[workerId] = {
            worker,
            busy: false,
            currentTask: null
        };

        console.log(`✅ Worker ${workerId} initialized`);
    }

    /**
     * Restart a failed worker
     */
    restartWorker(workerId) {
        if (this.workers[workerId]) {
            this.workers[workerId].worker.terminate();
        }
        setTimeout(() => {
            this.createWorker(workerId);
        }, 1000);
    }    /**
     * Start parallel streaming for a movie
     */
    async startParallelStream(movieId, totalChunks, peerConnections = []) {
        console.log(`🎬 Starting parallel stream for ${movieId} (${totalChunks} chunks)`);
        
        // Initialize stream buffer
        this.streamBuffer.set(movieId, new Array(totalChunks).fill(null));
        this.downloadQueue.set(movieId, []);

        // Create download strategy with parallelism
        const downloadStrategy = this.createDownloadStrategy(movieId, totalChunks, peerConnections);
        
        // Start parallel downloads in background (don't wait for all)
        this.executeParallelDownloadsAsync(movieId, downloadStrategy);
        
        // Return immediately with stream response
        return {
            success: true,
            stats: {
                totalChunks,
                workersActive: this.maxWorkers,
                priorityChunks: downloadStrategy.priorityChunks.length,
                backgroundChunks: downloadStrategy.backgroundChunks.length
            }
        };
    }

    /**
     * Create optimized download strategy
     */
    createDownloadStrategy(movieId, totalChunks, peerConnections) {
        const strategy = {
            priorityChunks: [], // For streaming (0, 1, 2...)
            backgroundChunks: [], // For buffering
            peerSources: new Map(), // chunkIndex -> [peerIds]
        };

        // Prioritize first chunks for immediate streaming
        for (let i = 0; i < Math.min(5, totalChunks); i++) {
            strategy.priorityChunks.push(i);
        }

        // Background chunks for parallel download
        for (let i = 5; i < totalChunks; i++) {
            strategy.backgroundChunks.push(i);
        }

        // Map peer sources for each chunk
        peerConnections.forEach(peer => {
            if (peer.availableChunks) {
                peer.availableChunks.forEach(chunkIndex => {
                    if (!strategy.peerSources.has(chunkIndex)) {
                        strategy.peerSources.set(chunkIndex, []);
                    }
                    strategy.peerSources.get(chunkIndex).push(peer.id);
                });
            }
        });

        return strategy;
    }    /**
     * Execute parallel downloads using worker threads (async - non-blocking)
     */
    async executeParallelDownloadsAsync(movieId, strategy) {
        const allChunks = [...strategy.priorityChunks, ...strategy.backgroundChunks];
        
        console.log(`⚡ Starting async parallel downloads for ${allChunks.length} chunks`);
        
        // Process priority chunks first (for streaming)
        strategy.priorityChunks.forEach((chunkIndex, i) => {
            setTimeout(() => {
                this.downloadChunkParallel(movieId, chunkIndex, strategy.peerSources.get(chunkIndex) || [])
                    .then(data => {
                        console.log(`✅ Priority chunk ${chunkIndex} downloaded`);
                        this.emit('chunkReady', { movieId, chunkIndex, priority: true });
                    })
                    .catch(err => {
                        console.error(`❌ Priority chunk ${chunkIndex} failed:`, err.message);
                    });
            }, i * 100); // Stagger downloads
        });
        
        // Process background chunks
        strategy.backgroundChunks.forEach((chunkIndex, i) => {
            setTimeout(() => {
                this.downloadChunkParallel(movieId, chunkIndex, strategy.peerSources.get(chunkIndex) || [])
                    .then(data => {
                        console.log(`📦 Background chunk ${chunkIndex} downloaded`);
                        this.emit('chunkReady', { movieId, chunkIndex, priority: false });
                    })
                    .catch(err => {
                        console.error(`❌ Background chunk ${chunkIndex} failed:`, err.message);
                    });
            }, 2000 + (i * 200)); // Start after priority chunks
        });
        
        // Emit stream ready event after first few chunks
        setTimeout(() => {
            this.emit('streamReady', { 
                movieId, 
                readyChunks: Math.min(5, strategy.priorityChunks.length),
                totalChunks: allChunks.length
            });
        }, 3000);
    }

    /**
     * Execute parallel downloads using worker threads (original - blocking)
     */
    async executeParallelDownloads(movieId, strategy) {
        const allChunks = [...strategy.priorityChunks, ...strategy.backgroundChunks];
        const downloadPromises = [];

        // Process chunks in parallel batches
        for (let i = 0; i < allChunks.length; i += this.maxWorkers) {
            const batch = allChunks.slice(i, i + this.maxWorkers);
            const batchPromises = batch.map(chunkIndex => 
                this.downloadChunkParallel(movieId, chunkIndex, strategy.peerSources.get(chunkIndex) || [])
            );
            
            // Wait for current batch before starting next
            await Promise.allSettled(batchPromises);
            downloadPromises.push(...batchPromises);
        }

        return Promise.allSettled(downloadPromises);
    }

    /**
     * Download a single chunk using available worker
     */
    async downloadChunkParallel(movieId, chunkIndex, peerSources = []) {
        return new Promise((resolve, reject) => {
            const availableWorker = this.getAvailableWorker();
            
            if (!availableWorker) {
                // Queue the task if no workers available
                this.workerQueue.push({ movieId, chunkIndex, peerSources, resolve, reject });
                return;
            }

            this.assignChunkToWorker(availableWorker, movieId, chunkIndex, peerSources, resolve, reject);
        });
    }

    /**
     * Get next available worker
     */
    getAvailableWorker() {
        return this.workers.find(w => w && !w.busy);
    }

    /**
     * Assign chunk download to worker
     */
    assignChunkToWorker(workerInfo, movieId, chunkIndex, peerSources, resolve, reject) {
        workerInfo.busy = true;
        workerInfo.currentTask = { movieId, chunkIndex, resolve, reject };

        const task = {
            type: 'downloadChunk',
            movieId,
            chunkIndex,
            peerSources,
            timestamp: Date.now()
        };

        workerInfo.worker.postMessage(task);
        
        // Set timeout for worker task
        setTimeout(() => {
            if (workerInfo.currentTask && workerInfo.currentTask.chunkIndex === chunkIndex) {
                console.warn(`⏰ Worker timeout for chunk ${chunkIndex}`);
                this.handleWorkerTimeout(workerInfo);
            }
        }, 30000); // 30 second timeout
    }

    /**
     * Handle messages from worker threads
     */
    handleWorkerMessage(workerId, message) {
        const workerInfo = this.workers[workerId];
        if (!workerInfo || !workerInfo.currentTask) return;

        const { type, success, data, error, chunkIndex, movieId } = message;
        const { resolve, reject } = workerInfo.currentTask;

        switch (type) {
            case 'chunkDownloaded':
                if (success) {
                    this.storeChunkData(movieId, chunkIndex, data);
                    resolve(data);
                } else {
                    reject(new Error(error));
                }
                break;

            case 'progress':
                this.emit('chunkProgress', { movieId, chunkIndex, progress: data.progress });
                break;

            case 'error':
                reject(new Error(error));
                break;
        }

        // Free up worker
        workerInfo.busy = false;
        workerInfo.currentTask = null;

        // Process queued tasks
        this.processWorkerQueue();
    }

    /**
     * Process queued worker tasks
     */
    processWorkerQueue() {
        if (this.workerQueue.length === 0) return;

        const availableWorker = this.getAvailableWorker();
        if (!availableWorker) return;

        const task = this.workerQueue.shift();
        this.assignChunkToWorker(
            availableWorker, 
            task.movieId, 
            task.chunkIndex, 
            task.peerSources, 
            task.resolve, 
            task.reject
        );
    }

    /**
     * Store chunk data in stream buffer
     */
    storeChunkData(movieId, chunkIndex, chunkData) {
        const buffer = this.streamBuffer.get(movieId);
        if (buffer) {
            buffer[chunkIndex] = chunkData;
            console.log(`📦 Stored chunk ${chunkIndex} for ${movieId} (${chunkData.length} bytes)`);
        }
    }

    /**
     * Create stream response for movie
     */
    createStreamResponse(movieId) {
        const buffer = this.streamBuffer.get(movieId);
        if (!buffer) {
            throw new Error(`No stream buffer found for ${movieId}`);
        }

        const { Readable } = require('stream');
        
        const stream = new Readable({
            read() {
                // Stream chunks as they become available
                const availableChunks = buffer.filter(chunk => chunk !== null);
                if (availableChunks.length > 0) {
                    availableChunks.forEach(chunk => {
                        this.push(chunk);
                    });
                }
                
                // End stream when all chunks are available or after timeout
                setTimeout(() => {
                    this.push(null);
                }, 5000);
            }
        });

        return { stream, stats: this.getStreamingStats(movieId) };
    }

    /**
     * Get streaming statistics for a movie
     */
    getStreamingStats(movieId) {
        const buffer = this.streamBuffer.get(movieId) || [];
        const totalChunks = buffer.length;
        const availableChunks = buffer.filter(chunk => chunk !== null).length;
        const completedPercentage = totalChunks > 0 ? (availableChunks / totalChunks * 100).toFixed(1) : 0;

        return {
            movieId,
            totalChunks,
            availableChunks,
            completedPercentage,
            workersActive: this.workers.filter(w => w && w.busy).length,
            totalWorkers: this.maxWorkers,
            queueLength: this.workerQueue.length,
            timestamp: Date.now()
        };
    }

    /**
     * Handle worker timeout
     */
    handleWorkerTimeout(workerInfo) {
        if (workerInfo.currentTask) {
            workerInfo.currentTask.reject(new Error('Worker timeout'));
            workerInfo.busy = false;
            workerInfo.currentTask = null;
        }
    }

    /**
     * Clean up resources
     */
    destroy() {
        this.workers.forEach(workerInfo => {
            if (workerInfo && workerInfo.worker) {
                workerInfo.worker.terminate();
            }
        });
        this.workers = [];
        this.streamBuffer.clear();
        this.downloadQueue.clear();
    }
}

// Worker thread code
if (!isMainThread && workerData && workerData.isWorker) {
    const workerId = workerData.workerId;
    
    // Worker thread chunk processing
    parentPort.on('message', async (task) => {
        try {
            const { type, movieId, chunkIndex, peerSources } = task;
            
            if (type === 'downloadChunk') {
                await processChunkDownload(movieId, chunkIndex, peerSources);
            }
        } catch (error) {
            parentPort.postMessage({
                type: 'error',
                error: error.message,
                chunkIndex: task.chunkIndex,
                movieId: task.movieId
            });
        }
    });

    async function processChunkDownload(movieId, chunkIndex, peerSources) {
        // Simulate chunk processing work
        parentPort.postMessage({
            type: 'progress',
            movieId,
            chunkIndex,
            data: { progress: 50 }
        });

        // CPU-intensive chunk processing here
        const chunkData = await downloadAndProcessChunk(movieId, chunkIndex, peerSources);
        
        parentPort.postMessage({
            type: 'chunkDownloaded',
            success: true,
            movieId,
            chunkIndex,
            data: chunkData
        });
    }

    async function downloadAndProcessChunk(movieId, chunkIndex, peerSources) {
        // Simulate download and processing
        await new Promise(resolve => setTimeout(resolve, Math.random() * 1000 + 500));
        
        // Create mock chunk data
        const chunkSize = 1024 * 1024; // 1MB
        const chunkData = Buffer.alloc(chunkSize);
        
        // Fill with pattern for testing
        for (let i = 0; i < chunkSize; i += 4) {
            chunkData.writeUInt32BE(chunkIndex, i);
        }
        
        return chunkData;
    }
}

module.exports = ParallelStreamingEngine;
