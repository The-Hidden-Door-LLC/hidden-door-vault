'use strict';
const table = Array.from({ length: 256 }, (_, i) => {
  let c = i;
  for (let k = 0; k < 8; k++) c = (c >>> 1) ^ ((c & 1) ? 0x82f63b78 : 0);
  return c >>> 0;
});
module.exports = function crc32c(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) crc = table[(crc ^ b) & 255] ^ (crc >>> 8);
  return ((crc ^ 0xffffffff) >>> 0).toString(10);
};
