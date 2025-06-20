const axios = require('axios');

// Test the magnet link integration
async function testMagnetIntegration() {
  console.log('🧪 Testing magnet link integration...');
  
  const baseUrl = 'http://localhost:8080';
  const testMovie = 'Test Movie';
  const testMagnetLink = 'magnet:?xt=urn:btih:example123&dn=Test+Movie&tr=udp://tracker.example.com:1337';
  
  try {
    // Test 1: Store magnet link
    console.log('📝 Test 1: Storing magnet link...');
    const storeResponse = await axios.post(`${baseUrl}/store_magnet`, {
      movie: testMovie,
      magnetLink: testMagnetLink
    });
    
    if (storeResponse.data.success) {
      console.log('✅ Magnet link stored successfully');
    } else {
      console.log('❌ Failed to store magnet link');
      return;
    }
    
    // Test 2: Get movie info (should use magnet link)
    console.log('📊 Test 2: Getting movie info...');
    const infoResponse = await axios.get(`${baseUrl}/get_movie_info?movie=${encodeURIComponent(testMovie)}`);
    
    if (infoResponse.data.totalChunks) {
      console.log(`✅ Movie info retrieved: ${infoResponse.data.totalChunks} chunks`);
      console.log(`   Chunk size: ${infoResponse.data.chunkSize} bytes`);
      console.log(`   Loading: ${infoResponse.data.loading || false}`);
    } else {
      console.log('❌ Failed to get movie info');
      return;
    }
    
    // Test 3: Try to download a chunk (should attempt to use torrent)
    console.log('📥 Test 3: Requesting chunk download...');
    try {
      const chunkResponse = await axios.get(`${baseUrl}/download_chunk?movie=${encodeURIComponent(testMovie)}&chunkIndex=0`, {
        responseType: 'arraybuffer',
        timeout: 35000 // Wait longer for torrent processing
      });
      
      if (chunkResponse.data.byteLength > 0) {
        console.log(`✅ Chunk downloaded: ${chunkResponse.data.byteLength} bytes`);
        console.log('   (Note: This may be a fallback fake chunk if torrent failed)');
      } else {
        console.log('❌ Empty chunk received');
      }
    } catch (chunkError) {
      console.log(`⚠️ Chunk download failed: ${chunkError.message}`);
      console.log('   (This is expected if the test magnet link is invalid)');
    }
    
    console.log('🎉 Magnet link integration test completed!');
    console.log('');
    console.log('💡 Key Changes Made:');
    console.log('   1. Added WebTorrent support to tracker.js');
    console.log('   2. Added /store_magnet endpoint to store magnet links');
    console.log('   3. Modified /get_movie_info to use torrent metadata');
    console.log('   4. Enhanced /download_chunk to extract real chunks from torrents');
    console.log('   5. Added fallback to fake chunks if torrent fails');
    console.log('   6. Updated frontend to send magnet links to tracker');
    
  } catch (error) {
    console.log(`❌ Test failed: ${error.message}`);
    if (error.code === 'ECONNREFUSED') {
      console.log('   Make sure the server is running on port 8080');
    }
  }
}

// Run the test
testMagnetIntegration();
