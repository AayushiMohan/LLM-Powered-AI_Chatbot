const mongoose = require("mongoose");

const DocumentChunkSchema = new mongoose.Schema({
  filename: { type: String, required: true, index: true },
  chunkIndex: { type: Number, required: true },
  text: { type: String, required: true },
  embedding: { type: [Number], required: true },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("DocumentChunk", DocumentChunkSchema);
