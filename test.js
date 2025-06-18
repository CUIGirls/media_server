// Test script to verify P2P functionality
// Run with: node test.js

const axios = require('axios');

const BASE_URL = 'http://localhost:8080';

async function testAPIs() {
  console.log('🧪 Testing P2P Media Platform APIs...\n');

  try {
    // Test 1: Movie Search
    console.log('1️⃣  Testing movie search...');
    const searchResponse = await axios.get(`${BASE_URL}/search?query=inception`);
    console.log(`✅ Found ${searchResponse.data.length} movies`);
    
    // Test 2: Movie Info
    console.log('\n2️⃣  Testing movie info...');
    const movieInfoResponse = await axios.get(`${BASE_URL}/get_movie_info?movie=Inception`);
    console.log(`✅ Movie info: ${movieInfoResponse.data.totalChunks} chunks, ${movieInfoResponse.data.chunkSize} bytes each`);
    
    // Test 3: Chunk Registration
    console.log('\n3️⃣  Testing chunk registration...');
    const registerResponse = await axios.post(`${BASE_URL}/register_chunk`, {
      movie: 'Test Movie',
      chunkIndex: 0,
      peerId: 'test-peer-123'
    });
    console.log(`✅ Chunk registered: ${registerResponse.data.message}`);
    
    // Test 4: Chunk Map
    console.log('\n4️⃣  Testing chunk map...');
    const chunkMapResponse = await axios.get(`${BASE_URL}/get_chunk_map?movie=Test%20Movie`);
    console.log(`✅ Chunk map: ${JSON.stringify(chunkMapResponse.data)}`);
    
    // Test 5: Download Chunk
    console.log('\n5️⃣  Testing chunk download...');
    const chunkResponse = await axios.get(`${BASE_URL}/download_chunk?movie=Test%20Movie&chunkIndex=0`);
    console.log(`✅ Downloaded chunk: ${chunkResponse.data.length || 'binary data'} bytes`);
    
    // Test 6: Cleanup
    console.log('\n6️⃣  Testing peer cleanup...');
    const cleanupResponse = await axios.post(`${BASE_URL}/cleanup_peer`, {
      peerId: 'test-peer-123'
    });
    console.log(`✅ Cleanup: ${cleanupResponse.data.message}`);
    
    console.log('\n🎉 All tests passed! P2P platform is ready.\n');
    
    console.log('📋 Quick Start Instructions:');
    console.log('1. Keep the server running (node backend/main.js)');
    console.log('2. Open frontend/index.html in multiple browser tabs');
    console.log('3. Search for a movie (e.g., "Inception")');
    console.log('4. Click "Download via P2P" in multiple tabs');
    console.log('5. Watch real P2P chunk sharing happen! 🚀');
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.code === 'ECONNREFUSED') {
      console.log('\n💡 Make sure the server is running:');
      console.log('   node backend/main.js');
    }
  }
}

testAPIs();
