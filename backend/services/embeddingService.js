let embedderPromise = null;

async function getEmbedder() {
  if (!embedderPromise) {
    
    const { pipeline } = await import("@xenova/transformers");
    embedderPromise = pipeline(
      "feature-extraction",
      "Xenova/all-MiniLM-L6-v2" 
    );
  }
  return embedderPromise;
}

async function embedText(text) {
  const embedder = await getEmbedder();
  const output = await embedder(text, { pooling: "mean", normalize: true });
  return Array.from(output.data);
}

async function embedBatch(texts) {
  if (texts.length === 0) return [];
  const embedder = await getEmbedder();
  const output = await embedder(texts, { pooling: "mean", normalize: true });

  const dims = output.dims; // [batchSize, hiddenSize]
  const hiddenSize = dims[dims.length - 1];
  const batchSize = dims[0];
  const flat = Array.from(output.data);

  const results = [];
  for (let i = 0; i < batchSize; i++) {
    results.push(flat.slice(i * hiddenSize, (i + 1) * hiddenSize));
  }
  return results;
}

module.exports = { embedText, embedBatch };
