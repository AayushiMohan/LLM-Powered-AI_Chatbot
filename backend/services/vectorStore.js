const DocumentChunk = require("../models/DocumentChunk");
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

  return dot;
}

function search(queryEmbedding, k = 6, minScore = 0.15) {
  if (cache.length === 0) return [];
  
  const SMALL_KB_THRESHOLD = 12;
  if (cache.length <= SMALL_KB_THRESHOLD) {
    return [...cache].sort((a, b) =>
      a.filename === b.filename ? a.chunkIndex - b.chunkIndex : a.filename.localeCompare(b.filename)
    );
  }

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
