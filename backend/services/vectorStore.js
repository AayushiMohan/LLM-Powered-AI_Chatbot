const DocumentChunk = require("../models/DocumentChunk");

// In-memory cache of { userId, filename, chunkIndex, text, embedding } for fast search.
// Every lookup is scoped to a userId so users only ever see their own documents.
let cache = [];

async function loadCacheFromDB() {
  const all = await DocumentChunk.find({}, "userId filename chunkIndex text embedding").lean();
  cache = all;
  console.log(`📚 RAG cache loaded: ${cache.length} chunks in memory`);
}

function addToCache(chunkDoc) {
  cache.push(chunkDoc);
}

function removeFromCache(userId, filename) {
  cache = cache.filter((c) => !(c.userId === userId && c.filename === filename));
}

function hasDocuments(userId) {
  return cache.some((c) => c.userId === userId);
}

function cosineSimilarity(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  // embeddings are already normalized, so dot product == cosine similarity
  return dot;
}

/**
 * Return the most relevant chunks for this user's documents.
 * Small knowledge bases are returned in full so broad questions
 * ("summarize this paper") still work; larger ones use top-k similarity.
 */
function search(userId, queryEmbedding, k = 6, minScore = 0.15) {
  const mine = cache.filter((c) => c.userId === userId);
  if (mine.length === 0) return [];

  const SMALL_KB_THRESHOLD = 12;
  if (mine.length <= SMALL_KB_THRESHOLD || !queryEmbedding) {
    return [...mine].sort((a, b) =>
      a.filename === b.filename ? a.chunkIndex - b.chunkIndex : a.filename.localeCompare(b.filename)
    );
  }

  const scored = mine.map((c) => ({
    ...c,
    score: cosineSimilarity(queryEmbedding, c.embedding),
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.filter((c) => c.score >= minScore).slice(0, k);
}

function listDocuments(userId) {
  const byFile = {};
  for (const c of cache) {
    if (c.userId !== userId) continue;
    byFile[c.filename] = (byFile[c.filename] || 0) + 1;
  }
  return Object.entries(byFile).map(([filename, chunkCount]) => ({ filename, chunkCount }));
}

module.exports = {
  loadCacheFromDB,
  addToCache,
  removeFromCache,
  hasDocuments,
  search,
  listDocuments,
};
