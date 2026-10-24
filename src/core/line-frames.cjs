'use strict';
// Keep UTF-8 as bytes until a whole line arrives. Each incoming byte is scanned
// once; concatenating and recounting a growing string is quadratic for big files.
class LineFrames {
  constructor(maxBytes) { this.maxBytes = maxBytes; this.parts = []; this.size = 0; }
  push(chunk, onLine) {
    let start = 0;
    while (start < chunk.length) {
      const newline = chunk.indexOf(10, start);
      const end = newline === -1 ? chunk.length : newline + 1;
      const part = chunk.subarray(start, end);
      if (this.size + part.length > this.maxBytes) {
        this.parts = []; this.size = 0;
        throw new RangeError('Bridge frame exceeds the transport limit.');
      }
      this.parts.push(part); this.size += part.length;
      if (newline !== -1) {
        const line = Buffer.concat(this.parts, this.size).toString('utf8').trim();
        this.parts = []; this.size = 0;
        if (onLine(line) === false) return;
      }
      start = end;
    }
  }
}
module.exports = { LineFrames };
