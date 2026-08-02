/**
 * Splits text into overlapping chunks, breaking on sentence/paragraph
 * boundaries where possible so chunks stay semantically coherent.
 *
 * @param {string} text
 * @param {number} chunkSize   target characters per chunk
 * @param {number} overlap     characters of overlap between chunks
 * @returns {string[]}
 */
function chunkText(text, chunkSize = 800, overlap = 120) {
  const clean = text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  if (!clean) return [];

  // Split into sentences/paragraphs first for cleaner boundaries.
  const sentences = clean.split(/(?<=[.!?])\s+|\n{2,}/);

  const chunks = [];
  let current = "";

  for (const sentence of sentences) {
    if ((current + " " + sentence).length > chunkSize && current.length > 0) {
      chunks.push(current.trim());
      // start next chunk with overlap from the end of the previous one
      const overlapText = current.slice(Math.max(0, current.length - overlap));
      current = overlapText + " " + sentence;
    } else {
      current = current ? current + " " + sentence : sentence;
    }
  }
  if (current.trim()) chunks.push(current.trim());

  return chunks;
}

module.exports = { chunkText };
