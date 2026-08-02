const DocumentChunk = require("../models/DocumentChunk");

// In-memory cache of { filename, chunkIndex, text, embedding } for fast search.
// Fine at small/medium scale (thousands of chunks). Rebuilt from Mongo on boot.
let cache = [];

async function loadCacheFromDB() {
  const all = await DocumentChunk.find({}, "filename chunkIndex text embedding").lean();
  cache = all;
  console.log(`📚 RAG cache loaded: ${cache.length} chunks in memory`);
}

function addToCache(chunkDoc) {
  cache.push(chunkDoc);
}

function removeFromCache(filename) {
  cache = cache.filter((c) => c.filename !== filename);
}

function cosineSimilarity(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  // embeddings from embedService are already normalized, so dot product == cosine similarity
  return dot;
}

/**
 * Return the top-k most relevant chunks for a query embedding.
 * @param {number[]} queryEmbedding
 * @param {number} k
 * @param {number} minScore  ignore chunks below this similarity
 */
function search(queryEmbedding, k = 4, minScore = 0.35) {
  if (cache.length === 0) return [];

  const scored = cache.map((c) => ({
    ...c,
    score: cosineSimilarity(queryEmbedding, c.embedding),
  }));

  scored.sort((a, b) => b.score - a.score);

  return scored.filter((c) => c.score >= minScore).slice(0, k);
}

function listDocuments() {
  const byFile = {};
  for (const c of cache) {
    byFile[c.filename] = (byFile[c.filename] || 0) + 1;
  }
  return Object.entries(byFile).map(([filename, chunkCount]) => ({ filename, chunkCount }));
}

module.exports = {
  loadCacheFromDB,
  addToCache,
  removeFromCache,
  search,
  listDocuments,
};
