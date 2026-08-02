// Free, local embeddings using transformers.js (@xenova/transformers).
// Model runs entirely in Node - downloads once (~90MB) then works offline.

let embedderPromise = null;

async function getEmbedder() {
  if (!embedderPromise) {
    // Dynamic import because @xenova/transformers is an ESM package
    const { pipeline } = await import("@xenova/transformers");
    embedderPromise = pipeline(
      "feature-extraction",
      "Xenova/all-MiniLM-L6-v2" // 384-dim, small + fast, good quality for RAG
    );
  }
  return embedderPromise;
}

/**
 * Embed a single piece of text into a normalized vector.
 * @param {string} text
 * @returns {Promise<number[]>}
 */
async function embedText(text) {
  const embedder = await getEmbedder();
  const output = await embedder(text, { pooling: "mean", normalize: true });
  return Array.from(output.data);
}

/**
 * Embed multiple texts (sequentially - fine for small/medium docs).
 * @param {string[]} texts
 * @returns {Promise<number[][]>}
 */
async function embedBatch(texts) {
  const results = [];
  for (const t of texts) {
    results.push(await embedText(t));
  }
  return results;
}

module.exports = { embedText, embedBatch };
