'use strict';
// Platform wording. The preload exposes process.platform; the main process also reports it in status().
const PLATFORM = window.vaultAPI?.platform || 'darwin', IS_MAC = PLATFORM === 'darwin';
const DEVICE = IS_MAC ? 'this Mac' : 'this computer', OS_NAME = IS_MAC ? 'macOS' : 'the system';
document.body.classList.add(`platform-${PLATFORM}`);
const bioLabel = () => state?.status?.biometric?.label || 'Touch ID';
const $ = selector => document.querySelector(selector);
const SVG_NS = 'http://www.w3.org/2000/svg';
const FA_ICONS = {
  all: { vb: '0 0 448 512', d: 'M32 64l0 128 128 0 0-128-128 0zM0 32l192 0 0 192-192 0 0-192zM32 320l0 128 128 0 0-128-128 0zM0 288l192 0 0 192-192 0 0-192zM416 64l-128 0 0 128 128 0 0-128zM288 32l160 0 0 192-192 0 0-192 32 0zm0 288l0 128 128 0 0-128-128 0zm-32-32l192 0 0 192-192 0 0-192z' },
  login: { vb: '0 0 512 512', d: 'M192 176c0-79.5 64.5-144 144-144s144 64.5 144 144-64.5 144-144 144c-11.1 0-22-1.3-32.4-3.6l-8.6-2-6.3 6.3-31.4 31.4-65.4 0 0 64-64 0 0 64-96 0 0-81.4 162.8-162.8 6.9-6.9-2.9-9.3c-4.4-13.8-6.7-28.4-6.7-43.7zM336 0c-97.2 0-176 78.8-176 176 0 15.1 1.9 29.8 5.5 43.9l-160.8 160.8-4.7 4.7 0 126.6 160 0 0-64 64 0 0-64 46.6 0 4.7-4.7 30-30c10 1.8 20.2 2.7 30.7 2.7 97.2 0 176-78.8 176-176S433.2 0 336 0zm32 168a24 24 0 1 0 0-48 24 24 0 1 0 0 48z' },
  card: { vb: '0 0 512 512', d: 'M480 96l0 96-448 0 0-96 448 0zm0 128l0 192-448 0 0-192 448 0zM32 64l-32 0 0 384 512 0 0-384-480 0zM96 320l0 32 64 0 0-32-64 0zm96 0l0 32 64 0 0-32-64 0z' },
  ssh: { vb: '0 0 512 512', d: 'M4.8 91.3L-6.5 80 16.1 57.4 27.4 68.7 203.4 244.7 214.8 256 203.4 267.3 27.4 443.3 16.1 454.6-6.5 432 4.8 420.7 169.5 256 4.8 91.3zM208.1 416l304 0 0 32-320 0 0-32 16 0z' },
  api: { vb: '0 0 576 512', d: 'M64 32l160 0 0 32-128 0 0 134.6-4.7 4.7-52.7 52.7 52.7 52.7 4.7 4.7 0 134.6 128 0 0 32-160 0 0-153.4-59.3-59.3-4.7-4.7 0-13.3 4.7-4.7 59.3-59.3 0-153.4zm448 0l0 153.4 59.3 59.3 4.7 4.7 0 13.3-4.7 4.7-59.3 59.3 0 153.4-160 0 0-32 128 0 0-134.6 4.7-4.7 52.7-52.7-52.7-52.7-4.7-4.7 0-134.6-128 0 0-32 160 0z' },
  recovery: { vb: '0 0 512 512', d: 'M256 0L32 93.3 32 154c0 107.6 46.1 285.1 213.6 363.2L256 522l10.4-4.8C433.9 439.1 480 261.6 480 154l0-60.7L256 0zm0 35.2l192 80 0 38.8c0 92.2-39.4 251-192 322.1-152.6-71.1-192-229.9-192-322.1l0-38.8 192-80zM256 144a64 64 0 0 0-32 119.4L224 352l64 0 0-88.6A64 64 0 0 0 256 144z' },
  note: { vb: '0 0 384 512', d: 'M32 32l160 0 0 160 160 0 0 288-320 0 0-448zM224 45.3L338.7 160 224 160 224 45.3zM224 0L0 0 0 512 384 512 384 160 224 0zM112 256l-16 0 0 32 192 0 0-32-176 0zm0 96l-16 0 0 32 192 0 0-32-176 0z' },
  favorites: { vb: '0 0 576 512', d: 'M359.6 157.6l-7.4-14.5-64.1-125.5-64.1 125.5-7.4 14.5-16.1 2.6-139.2 22.1 99.6 99.7 11.5 11.5-2.5 16.1-22 139.2 125.6-63.9 14.5-7.4 14.5 7.4 125.6 63.9-22-139.2-2.5-16.1 11.5-11.5 99.6-99.7-139.2-22.1-16.1-2.6zm183.2-3.3l39 6.2c-3.9 3.9-51.9 52-143.9 144.1 20.3 128.6 30.9 195.6 31.7 201.2-5-2.5-65.5-33.3-181.5-92.3-116 59-176.5 89.8-181.5 92.3 .9-5.5 11.4-72.6 31.7-201.2-92-92.1-140-140.1-143.9-144.1 5.5-.9 72.6-11.5 201.1-32 59.2-116 90-176.4 92.6-181.4 2.5 5 33.4 65.4 92.6 181.4l162.1 25.8z' },
  starSolid: { vb: '0 0 576 512', d: 'M288.2-52.8l-92.6 181.4-201.1 32 143.9 144.1-31.7 201.2 181.5-92.3 181.5 92.3-31.7-201.2 143.9-144.1-201.1-32-92.6-181.4z' },
  archive: { vb: '0 0 512 512', d: 'M480 64l0 64-448 0 0-64 448 0zM0 160l32 0 0 320 448 0 0-320 32 0 0-128-512 0 0 128zm64 0l384 0 0 288-384 0 0-288zm112 64l-16 0 0 32 192 0 0-32-176 0z' },
  generator: { vb: '0 0 640 512', d: 'M528-16l-32 0 0 64-64 0 0 32 64 0 0 64 32 0 0-64 64 0 0-32-64 0 0-64zM288 320c80.6-35.8 128.6-57.2 144-64-15.4-6.8-63.4-28.2-144-64-35.8-80.6-57.2-128.6-64-144-6.8 15.4-28.2 63.4-64 144-80.6 35.8-128.6 57.2-144 64 15.4 6.8 63.4 28.2 144 64 35.8 80.6 57.2 128.6 64 144 6.8-15.4 28.2-63.4 64-144zm-64 65.2l-34.8-78.2-5-11.2-11.2-5-78.2-34.8 78.2-34.8 11.2-5 5-11.2 34.8-78.2 34.8 78.2 5 11.2 11.2 5 78.2 34.8-78.2 34.8-11.2 5-5 11.2-34.8 78.2zM496 384l0-16-32 0 0 64-64 0 0 32 64 0 0 64 32 0 0-64 64 0 0-32-64 0 0-48z' },
  settings: { vb: '0 0 512 512', d: 'M0 400l80 0 0-64 160 0 0 64 272 0 0 32-272 0 0 64-160 0 0-64-80 0 0-32zm208 32l0-64-96 0 0 96 96 0 0-32zM0 240l272 0 0-64 160 0 0 64 80 0 0 32-80 0 0 64-160 0 0-64-272 0 0-32zM112 112l-112 0 0-32 112 0 0-64 160 0 0 64 240 0 0 32-240 0 0 64-160 0 0-64zm32 0l0 32 96 0 0-96-96 0 0 64zM400 240l0-32-96 0 0 96 96 0 0-64z' },
  config: { vb: '0 0 512 512', d: 'M64 80l122.7 0 53.3 53.3 9.4 9.4 198.6 0 0 289.3-384 0 0-352zM200 48l-168 0 0 416 448 0 0-352-216 0-54.6-54.6-9.4-9.4zM144 224l-16 0 0 32 256 0 0-32-240 0zm0 96l-16 0 0 32 176 0 0-32-160 0z' },
  host: { vb: '0 0 512 512', d: 'M32 64l448 0 0 128-448 0 0-128zM0 32l0 192 512 0 0-192-512 0zM32 320l448 0 0 128-448 0 0-128zM0 288l0 192 512 0 0-192-512 0zM120 128a24 24 0 1 0 -48 0 24 24 0 1 0 48 0zm56-16l0 32 160 0 0-32-160 0zM120 384a24 24 0 1 0 -48 0 24 24 0 1 0 48 0zm56-16l0 32 160 0 0-32-160 0z' },
  shieldCheck: { vb: '0 0 512 512', d: 'M256 35.2l192 80 0 38.8c0 92.2-39.4 251-192 322.1-152.6-71.1-192-229.9-192-322.1l0-38.8 192-80zM256 0L32 93.3 32 154c0 107.6 46.1 285.1 213.6 363.2L256 522l10.4-4.8C433.9 439.1 480 261.6 480 154l0-60.7L256 0zM363.3 203.3l-11.3-11.3-128 128-56-56-11.3-11.3-22.6 22.6 11.3 11.3 67.3 67.3 11.3 11.3 11.3-11.3 139.3-139.3 11.3-11.3-22.6-22.6z' },
  globe: { vb: '0 0 512 512', d: 'M352 256c0 22.2-1.2 43.6-3.3 64l-185.3 0c-2.2-20.4-3.3-41.8-3.3-64s1.2-43.6 3.3-64l185.3 0c2.2 20.4 3.3 41.8 3.3 64zm28.8-64l99.1 0c5.3 20.5 8.1 41.9 8.1 64s-2.8 43.5-8.1 64l-99.1 0c2.1-20.6 3.2-42 3.2-64s-1.1-43.4-3.2-64zm87.6-32l-93.1 0c-6-51-20.8-97.9-42.3-132.4 58.6 21.8 106.5 67.2 130.1 124.9 1.9 2.5 3.6 5 5.3 7.5zm-125.4 0l-174 0c6.1-48.4 20.5-92.4 40.9-124.2 14.9-23.2 31.3-35.8 46.1-35.8s31.2 12.6 46.1 35.8c20.4-31.8 34.8 75.8 40.9 124.2zm-206 0l-93.1 0c25.2-60.4 76.7-107.6 135.4-132.4-21.5 34.5-36.3 81.4-42.3 132.4zM32 256c0-22.1 2.8-43.5 8.1-64l99.1 0c-2.1 20.6-3.2 42-3.2 64s1.1 43.4 3.2 64l-99.1 0c-5.3-20.5-8.1-41.9-8.1-64zm137 96l174 0c-6.1 48.4-20.5 92.4-40.9 124.2-14.9 23.2-31.3 35.8-46.1 35.8s-31.2-12.6-46.1-35.8c-20.4-31.8-34.8-75.8-40.9-124.2zm-32 0c6 51 20.8 97.9 42.3 132.4-58.7-24.8-110.2-72-135.4-132.4l93.1 0zm243.8 0l93.1 0c-25.2 60.4-76.7 107.6-135.4 132.4 21.5-34.5 36.3-81.4 42.3-132.4z' },
  folder: { vb: '0 0 512 512', d: 'M64 80l122.7 0 53.3 53.3 9.4 9.4 198.6 0 0 289.3-384 0 0-352zM200 48l-168 0 0 416 448 0 0-352-216 0-54.6-54.6-9.4-9.4z' },
  fileCode: { vb: '0 0 384 512', d: 'M32 32l160 0 0 160 160 0 0 288-320 0 0-448zM224 45.3L338.7 160 224 160 224 45.3zM224 0L0 0 0 512 384 512 384 160 224 0zM155.3 267.3l11.3-11.3-22.6-22.6-11.3 11.3-64 64-11.3 11.3 11.3 11.3 64 64 11.3 11.3 22.6-22.6-11.3-11.3-52.7-52.7 52.7-52.7zm96-22.6l-22.6 22.6 11.3 11.3 52.7 52.7-52.7 52.7-11.3 11.3 22.6 22.6 11.3-11.3 64-64 11.3-11.3-11.3-11.3-64-64-11.3-11.3z' },
  plus: { vb: '0 0 448 512', d: 'M240 64l0-16-32 0 0 192-192 0 0 32 192 0 0 192 32 0 0-192 192 0 0-32-192 0 0-176z' },
  rotate: { vb: '0 0 512 512', d: 'M464 48l0 117.5C419 102.6 345.3 64 262.1 64 128.4 64 19.2 169.3 14.2 302.1l32 1.2C50.6 187.4 145.6 96 262.1 96c75.2 0 141.7 35.9 181.2 91.2L352 187.2l0 32 144 0 0-16 0-155.2-32 0zM465.8 299.9c-4.4 115.9-99.4 207.3-215.9 207.3-75.2 0-141.7-35.9-181.2-91.2l91.3 0 0-32-144 0 0 171.2 32 0 0-117.5C93 500.6 166.7 539.2 249.9 539.2c133.7 0 242.9-105.3 247.9-238.1l-32-1.2z' },
  trash: { vb: '0 0 448 512', d: 'M160 64l128 0 16 32-160 0 16-32zm-35.8 0L98.6 115.2 0 115.2 0 147.2l32 0 0 332.8c0 17.7 14.3 32 32 32l320 0c17.7 0 32-14.3 32-32l0-332.8 32 0 0-32-98.6 0-25.6-51.2-7.1-14.2-174.6 0-7.1 14.2zM64 147.2l320 0 0 332.8-320 0 0-332.8zm96 64l0 208 32 0 0-208-32 0zm96 0l0 208 32 0 0-208-32 0z' },
  pen: { vb: '0 0 512 512', d: 'M410.3 23.1l11.3-11.3 22.6 22.6 45.3 45.3 22.6 22.6-11.3 11.3-368 368-6.6 6.6-9.1 2.3-96 24-26.2 6.5 6.5-26.2 24-96 2.3-9.1 6.6-6.6 368-368zM365.1 113.6L74.5 404.2 58.1 469.9 123.8 453.5 414.4 162.9 365.1 113.6zm71.9-26.7l-49.3-49.3-22.6 22.6 49.3 49.3 22.6-22.6z' },
  copy: { vb: '0 0 448 512', d: 'M192 64l192 0 0 288-192 0 0-288zM160 32l0 352 256 0 0-352-256 0zM64 160l-32 0 0 320 256 0 0-32-224 0 0-288z' },
  eye: { vb: '0 0 576 512', d: 'M288 96c-105.9 0-195.8 66.2-240.6 160 44.8 93.8 134.7 160 240.6 160s195.8-66.2 240.6-160C483.8 162.2 393.9 96 288 96zM13.5 248.8C61.8 142 164.7 64 288 64s226.2 78 274.5 184.8l3.5 7.2-3.5 7.2C514.2 370 411.3 448 288 448S61.8 370 13.5 263.2L10 256l3.5-7.2zM288 192a64 64 0 1 0 0 128 64 64 0 1 0 0-128zm-96 64a96 96 0 1 1 192 0 96 96 0 1 1 -192 0z' },
  eyeSlash: { vb: '0 0 640 512', d: 'M38.8 5.1C28.4-3.1 13.3-1.2 5.1 9.2S-1.2 34.7 9.2 42.9l592 464c10.4 8.2 25.5 6.3 33.7-4.1s6.3-25.5-4.1-33.7L512.9 376.8C558.2 336.9 592.7 286.6 609.5 256 561.2 149.2 458.3 71.2 335 71.2c-57.4 0-111.1 17.5-156.8 46.8L38.8 5.1zM204.6 139.2c38.5-22.8 83.2-36 130.4-36 105.9 0 195.8 66.2 240.6 160-15.4 32.3-38 61.5-65.8 85.4l-78-61.1c8.3-13.8 13.2-30 13.2-47.5 0-53-43-96-96-96-17.5 0-33.7 4.9-47.5 13.2l-96.9-18zM115.6 202.9L90.4 183.1C59.9 211.2 36.1 246.2 20.5 280.8L17 288l3.5 7.2C68.8 402 171.7 480 295 480c46.8 0 90.8-11.5 130-31.6l-26.2-20.5c-31.9 13.1-66.9 20.1-103.8 20.1-105.9 0-195.8-66.2-240.6-160 15.8-33.1 39.2-62.9 68.2-85.1z' },
  externalLink: { vb: '0 0 512 512', d: 'M320 32l160 0 0 160-32 0 0-105.4-212.7 212.7-22.6-22.6 212.7-212.7-105.4 0 0-32zM64 96l160 0 0 32-128 0 0 320 320 0 0-128 32 0 0 160-384 0 0-384z' },
  download: { vb: '0 0 512 512', d: 'M272 32l0 297.4 84.7-84.7 22.6 22.6-123.3 123.3-123.3-123.3 22.6-22.6 84.7 84.7 0-297.4 32 0zM64 448l384 0 0 32-384 0 0-32z' },
  upload: { vb: '0 0 512 512', d: 'M256 38.6l123.3 123.3-22.6 22.6-84.7-84.7 0 297.4-32 0 0-297.4-84.7 84.7-22.6-22.6L256 38.6zM64 448l384 0 0 32-384 0 0-32z' },
  lock: { vb: '0 0 448 512', d: 'M144 144c0-44.2 35.8-80 80-80s80 35.8 80 80l0 48-160 0 0-48zm-32 48l-80 0 0 288 384 0 0-288-80 0 0-48C336 82.1 285.9 32 224 32S112 82.1 112 144l0 48zm-48 32l320 0 0 224-320 0 0-224zm160 80l-16 0 0 64 32 0 0-64-16 0z' },
  unlock: { vb: '0 0 448 512', d: 'M224 64c44.2 0 80 35.8 80 80l0 48 32 0 0-48C336 82.1 285.9 32 224 32S112 82.1 112 144l0 48-80 0 0 288 384 0 0-288-272 0 0-48c0-44.2 35.8-80 80-80zM64 224l320 0 0 224-320 0 0-224zm160 80l-16 0 0 64 32 0 0-64-16 0z' },
  fingerprint: { vb: '0 0 512 512', d: 'M256 64c-53 0-96 43-96 96l0 32-32 0 0-32c0-70.7 57.3-128 128-128s128 57.3 128 128l0 96-32 0 0-96c0-53-43-96-96-96zm0 64c-17.7 0-32 14.3-32 32l0 160c0 53 43 96 96 96l16 0 0 32-16 0c-70.7 0-128-57.3-128-128l0-160c0-35.3 28.7-64 64-64s64 28.7 64 64l0 160c0 17.7 14.3 32 32 32s32-14.3 32-32l0-32 32 0 0 32c0 35.3-28.7 64-64 64s-64-28.7-64-64l0-160c0-17.7-14.3-32-32-32zm-96 96l0 96c0 61.9 50.1 112 112 112l0 32c-79.5 0-144-64.5-144-144l0-96 32 0z' },
  empty: { vb: '0 0 512 512', d2: 'M16 140c.5 99.2 41.3 280.7 213.6 363.2 16.7 8 36.1 8 52.8 0 172.4-82.5 213.2-264 213.6-363.2 .1-26.2-16.3-47.9-38.3-57.2L269.4 2.9C265.2 1 260.7 0 256 0s-9.2 1-13.4 2.9L54.3 82.8c-22 9.3-38.4 31-38.3 57.2zm184 68c0-30.9 25.1-56 56-56 15.5 0 29.5 6.3 39.6 16.4 5.1 5.1 9.2 11.1 12 17.8 1.4 3.3 2.5 6.9 3.3 10.5 .4 1.9 .7 3.8 .9 5.7 .1 .9 .2 1.9 .2 2.7 0 .9 .1 1.7 .1 2.9 0 .1 0 .3 0 .4 0 .5 0 1 0 1.7 0 0 0 .2 0 .4 0 .5-.1 1.1-.1 1.8-.1 1.3-.3 2.7-.4 4.1-.4 2.7-1 5.3-1.7 7.8-1.5 5.1-3.7 9.9-6.6 14.2-5.6 8.7-13.6 15.8-23.1 20.3 0 23.1 0 46.3 0 69.4l0 .4c0 .5 0 1.3-.1 2.1-.1 .8-.2 1.6-.4 2.4-.3 1.5-.8 3-1.4 4.5-1.2 2.9-3 5.4-5.1 7.6-4.3 4.3-10.3 7-17 7-13.3 0-24-10.7-24-24 0-23.1 0-46.3 0-69.4-18.9-9-32-28.3-32-50.6z', d: 'M280 258.6c18.9-9 32-28.3 32-50.6 0-30.9-25.1-56-56-56s-56 25.1-56 56c0 22.3 13.1 41.6 32 50.6l0 69.4c0 13.3 10.7 24 24 24s24-10.7 24-24l0-69.4z' }
};
const LUNA_KEYHOLE_PATHS = [
  ['M32 4C29.6 9.1 25 12.2 25 16.8C25 19.3 27.2 20.9 30 21.2L32 19.2L34 21.2C36.8 20.9 39 19.3 39 16.8C39 12.2 34.4 9.1 32 4Z'],
  ['M29.4 20C27.9 17.5 24.5 16.7 21.3 17.5C17.9 18.3 17 21.7 19.2 24.1C18.4 21.7 20 20.5 21.8 21C23.4 21.5 24.4 23.3 24.6 25.4L29.4 20Z'],
  ['M34.6 20C36.1 17.5 39.5 16.7 42.7 17.5C46.1 18.3 47 21.7 44.8 24.1C45.6 21.7 44 20.5 42.2 21C40.6 21.5 39.6 23.3 39.4 25.4L34.6 20Z'],
  ['M23.3 27.2C20.8 23.7 17.5 22 13.7 22.8C8.4 23.8 5.4 28.2 6.3 33.3C7.2 38.5 11.8 41.6 17.1 41.1C19.3 40.9 20.9 40 21.4 38.9C16.6 39.5 11.2 36.9 10.6 32.9C10.1 29.6 12.2 27 15.2 27.1C18.1 27.2 19.4 29.5 18.9 31.2C18.5 29.9 17.2 29.1 15.9 29.6C14.2 30.2 13.6 32.1 14.4 33.7C15.5 35.9 18.4 36.8 22.3 36.1C20.4 33.8 20.7 30.2 23.3 27.2Z'],
  ['M40.7 27.2C43.2 23.7 46.5 22 50.3 22.8C55.6 23.8 58.6 28.2 57.7 33.3C56.8 38.5 52.2 41.6 46.9 41.1C44.7 40.9 43.1 40 42.6 38.9C47.4 39.5 52.8 36.9 53.4 32.9C53.9 29.6 51.8 27 48.8 27.1C45.9 27.2 44.6 29.5 45.1 31.2C45.5 29.9 46.8 29.1 48.1 29.6C49.8 30.2 50.4 32.1 49.6 33.7C48.5 35.9 45.6 36.8 41.7 36.1C43.6 33.8 43.3 30.2 40.7 27.2Z'],
  ['M27.1 38.6C23.8 40.5 22.2 44.4 19.9 46.5C18.3 48 16.3 48.5 13.5 48C12.6 52.3 15.2 56 19.5 56.5C23 56.9 26.2 55.2 28.1 52.4L25.8 49.8C23.8 52.2 20.4 53.8 17.8 51.6C22.6 50.9 24.4 47.8 25.3 43.9L27.1 38.6Z'],
  ['M36.9 38.6C40.2 40.5 41.8 44.4 44.1 46.5C45.7 48 47.7 48.5 50.5 48C51.4 52.3 48.8 56 44.5 56.5C41 56.9 37.8 55.2 35.9 52.4L38.2 49.8C40.2 52.2 43.6 53.8 46.2 51.6C41.4 50.9 39.6 47.8 38.7 43.9L36.9 38.6Z'],
  ['M28.8 50.7C29.3 54.1 28.5 56 26.5 57.4C28.4 58.3 30 57.2 30.6 55.6C29.4 58 30.1 60 32 60.5C33.9 59 34.6 58 33.4 55.6C34 57.2 35.6 58.3 37.5 57.4C35.5 56 34.7 54.1 35.2 50.7L28.8 50.7Z'],
  ['M32 18C38.1 18 43 22.9 43 29C43 33.1 40.8 36.7 37.5 38.6L43 52L21 52L26.5 38.6C23.2 36.7 21 33.1 21 29C21 22.9 25.9 18 32 18ZM32 22C28.1 22 25 25.1 25 29C25 31.9 26.8 34.4 29.4 35.5L25.3 48L38.7 48L34.6 35.5C37.2 34.4 39 31.9 39 29C39 25.1 35.9 22 32 22Z', 'evenodd']
];
function svgIcon(name, cls = 'fa-svg') {
  const def = FA_ICONS[name] || FA_ICONS.all;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', def.vb); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', cls);
  if (def.d2) { const p2 = document.createElementNS(SVG_NS, 'path'); p2.setAttribute('class', 'fa-secondary'); p2.setAttribute('d', def.d2); svg.append(p2); }
  const p1 = document.createElementNS(SVG_NS, 'path'); p1.setAttribute('class', 'fa-primary'); p1.setAttribute('d', def.d); svg.append(p1);
  return svg;
}
function inferButtonIcon(text) {
  if (!text || text === '\u2605' || text === '\u2606') return null;
  if (/^\+\s*/.test(text)) return 'plus';
  if (/^(Delete|Remove|Prune)/i.test(text)) return 'trash';
  if (/^Edit\b/i.test(text)) return 'pen';
  if (/^Copy\b/i.test(text)) return 'copy';
  if (/^(Reveal|Show)\b/i.test(text) && !/Reveal extension/i.test(text)) return 'eye';
  if (/^(Hide|Mask)\b/i.test(text)) return 'eyeSlash';
  if (/^(Refresh|Recount|Reconnect|Check again|Retry)\b/i.test(text)) return 'rotate';
  if (/^(Open offline|Open an existing offline)/i.test(text)) return 'archive';
  if (/^(Use Google connection|Sign in with Google)/i.test(text)) return 'globe';
  if (/^(Cloud settings|Back to cloud settings|Save cloud settings)/i.test(text)) return 'settings';
  if (/^Lock\b/i.test(text)) return 'lock';
  if (/Touch ID|Biometric/i.test(text)) return 'fingerprint';
  if (/^(Unlock|Create encrypted vault)\b/i.test(text)) return 'unlock';
  if (/^(Open website|Reveal extension)/i.test(text)) return 'externalLink';
  if (/^(Export|Download)\b/i.test(text)) return 'download';
  if (/^(Import|Replace Desktop OAuth|Update in Vault|Save to Vault|Back up|Save encrypted|Save key pair|Save as an API|Create & save)/i.test(text)) return 'shieldCheck';
  if (/^(Restore|Choose CSV|Choose backup)/i.test(text)) return 'upload';
  if (/^Generate\b/i.test(text)) return 'generator';
  if (/^Archive\b/i.test(text)) return 'archive';
  return null;
}
function setBtnContent(btn, text, explicitIcon = null) {
  const iconName = explicitIcon || inferButtonIcon(text);
  const cleanText = text.replace(/^\+\s+/, '');
  btn.replaceChildren();
  if (iconName && FA_ICONS[iconName]) btn.append(svgIcon(iconName, 'fa-svg btn-icon'));
  btn.append(document.createTextNode(cleanText));
}
function doorMark() {
  const wrap = el('div', 'door');
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 64 64'); svg.setAttribute('aria-hidden', 'true');
  const bg = document.createElementNS(SVG_NS, 'rect');
  bg.setAttribute('width', '64'); bg.setAttribute('height', '64'); bg.setAttribute('rx', '14'); bg.setAttribute('fill', '#06070e');
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('fill', '#e7c66a');
  for (const [d, rule] of LUNA_KEYHOLE_PATHS) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    if (rule) p.setAttribute('fill-rule', rule);
    g.append(p);
  }
  svg.append(bg, g); wrap.append(svg); return wrap;
}
function thdDevice() {
  const wrap = el('div', 'thd-device'); wrap.setAttribute('aria-hidden', 'true');
  const line = el('div', 'thd-line'), hw = el('div', 'thd-hw', 'vault'), ipa = el('span', 'thd-ipa');
  append(ipa, el('span', 'thd-slash', '/'), document.createTextNode('v\u0254\u02d0lt'), el('span', 'thd-slash', '/'));
  const def = el('p', 'thd-def');
  append(def, el('span', 'thd-pos', 'n.'), el('span', 'thd-dot', ' \u00b7 '), document.createTextNode('a sealed chamber for credentials kept out of casual view.'));
  return append(wrap, append(line, hw, ipa), def);
}
const names = { all: 'All items', login: 'Logins', card: 'Payment cards', ssh: 'SSH keys', api: 'API credentials', recovery: 'Recovery codes', note: 'Secure notes', favorites: 'Favorites', archive: 'Archive' };
const state = { status: null, mode: 'loading', filter: 'all', search: '', items: [], selected: null, current: null, offline: false, exists: true, busy: false, genTab: 'password', settingsTab: 'security', localSsh: null, localConfig: null, sshView: null, configSel: { entryName: null, relPath: null, fileData: null, revealed: false } };
let epoch = 0, toastTimer, revealTimers = [], activityAt = 0, skyCtrl = null;
function syncSky(active) {
  document.body.dataset.sky = active ? 'active' : 'paused';
  const c = $('#thd-sky'); if (!c || typeof c.getContext !== 'function') return;
  if (!skyCtrl) {
    const ctx = c.getContext('2d'); if (!ctx) return;
    let dpr = Math.min(window.devicePixelRatio || 1, 2), w = 0, h = 0, stars = [], raf = 0, running = false, s = 0x6d2b79f5;
    const nextUnit = () => { s = (s + 0x9e3779b9) | 0; let t = Math.imul(s ^ (s >>> 16), 0x21f0aaad); t = Math.imul(t ^ (t >>> 15), 0x735a2d97); return ((t ^ (t >>> 15)) >>> 0) / 4294967296; };
    const seed = () => {
      w = c.width = Math.max(1, Math.floor(window.innerWidth * dpr)); h = c.height = Math.max(1, Math.floor(window.innerHeight * dpr));
      c.style.width = `${window.innerWidth}px`; c.style.height = `${window.innerHeight}px`; s = 0x6d2b79f5;
      const n = Math.min(260, Math.floor((window.innerWidth * window.innerHeight) / 5500));
      stars = Array.from({ length: n }, () => ({ x: nextUnit() * w, y: nextUnit() * h, r: (nextUnit() < 0.14 ? 1.3 + nextUnit() * 1.1 : 0.45 + nextUnit() * 0.8) * dpr, a: 0.18 + nextUnit() * 0.65, sp: 0.0004 + nextUnit() * 0.0014, ph: nextUnit() * 6.283, warm: nextUnit() < 0.09 }));
    };
    const draw = t => {
      ctx.clearRect(0, 0, w, h);
      for (const st of stars) {
        const tw = 0.68 + 0.32 * Math.sin(t * st.sp + st.ph);
        ctx.fillStyle = st.warm ? `rgba(244,220,149,${(st.a * tw).toFixed(3)})` : `rgba(223,230,255,${(st.a * tw).toFixed(3)})`;
        ctx.beginPath(); ctx.arc(st.x, st.y, st.r, 0, 6.283); ctx.fill();
      }
      if (running) raf = requestAnimationFrame(draw);
    };
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    seed(); window.addEventListener('resize', () => { seed(); if (!running) draw(0); }, { passive: true });
    skyCtrl = {
      set(on) {
        if (reduce) { running = false; cancelAnimationFrame(raf); draw(0); return; }
        if (on && !running) { running = true; raf = requestAnimationFrame(draw); }
        else if (!on && running) { running = false; cancelAnimationFrame(raf); }
      }
    };
  }
  skyCtrl.set(active);
}
function el(tag, cls, text) { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }
function append(parent, ...children) { for (const child of children) if (child) parent.append(child); return parent; }
function button(text, action, cls = '', disabled = false, icon = null) { const n = el('button', `button ${cls}`); n.type = 'button'; n.disabled = disabled; setBtnContent(n, text, icon); n.addEventListener('click', () => run(action)); return n; }
function input(value = '', type = 'text', placeholder = '') { const n = el('input', 'input'); n.type = type; n.value = value; n.placeholder = placeholder; n.autocomplete = 'off'; n.spellcheck = false; return n; }
function secretInput(placeholder, autocomplete) {
  const control = input('', 'password', placeholder); control.autocomplete = autocomplete;
  const wrap = el('div', 'secret-wrap'); const toggle = el('button', 'button small subtle secret-toggle'); toggle.type = 'button'; toggle.setAttribute('aria-label', 'Show what you are typing');
  setBtnContent(toggle, 'Show', 'eye');
  toggle.addEventListener('click', () => { const show = control.type === 'password'; control.type = show ? 'text' : 'password'; setBtnContent(toggle, show ? 'Hide' : 'Show', show ? 'eyeSlash' : 'eye'); control.focus(); });
  append(wrap, control, toggle); return { wrap, control };
}
let fieldSeq = 0;
function field(label, control, full = false) {
  // Wrapped controls (input + toggle) get an explicit for/id pairing so the accessible name is the label text alone.
  const inner = ['INPUT', 'TEXTAREA', 'SELECT'].includes(control.tagName) ? null : control.querySelector('input,textarea,select');
  if (inner) { const n = el('div', `form-field${full ? ' full' : ''}`); const l = el('label', '', label); inner.id ||= `field-${++fieldSeq}`; l.htmlFor = inner.id; return append(n, l, control); }
  const n = el('label', `form-field${full ? ' full' : ''}`); return append(n, el('span', '', label), control);
}
function checkbox(text, checked = false) { const n = input('', 'checkbox'); n.checked = checked; const label = el('label', 'check'); append(label, n, el('span', '', text)); return { label, input: n }; }
function notice(text, type = '') { return el('div', `notice ${type}`, text); }
function toast(message, error = false) { clearTimeout(toastTimer); const node = $('#toast'); node.textContent = message; node.className = `toast${error ? ' error' : ''}`; node.hidden = false; toastTimer = setTimeout(() => { node.hidden = true; node.textContent = ''; }, error ? 10000 : 4500); }
async function api(channel, payload = {}) {
  if (!window.vaultAPI) throw new Error('Launch this interface through the desktop app.');
  const started = epoch;
  const result = await window.vaultAPI.call(channel, payload);
  if (started !== epoch && ['vault-get', 'vault-list', 'generate-password', 'generate-token', 'generate-ssh', 'passkey-create', 'totp', 'vault-save', 'vault-archive', 'vault-delete', 'vault-refresh', 'vault-unlock', 'vault-create', 'ssh-local', 'ssh-local-key', 'ssh-local-remove', 'config-local', 'config-local-file', 'config-local-remove'].includes(channel)) throw new Error('The vault was locked.');
  if (!result.ok) throw new Error(result.error || 'Operation failed.');
  return result.data;
}
async function run(action) { try { await action?.(); } catch (error) { toast(error.message || 'Operation failed.', true); } }
async function busy(action, label = 'Working securely...') {
  if (state.busy) return;
  state.busy = true;
  const indicator = el('div', 'busy-indicator', label);
  if (label.includes('Google sign-in')) { const cancel = button('Cancel', () => api('google-cancel'), 'subtle small'); cancel.dataset.cancel = 'true'; indicator.append(cancel); }
  document.body.append(indicator);
  const buttons = [...document.querySelectorAll('button:not([data-cancel])')].filter(b => !b.disabled); buttons.forEach(b => b.disabled = true);
  try { return await action(); } finally { state.busy = false; indicator.remove(); buttons.filter(b => b.isConnected).forEach(b => b.disabled = false); }
}
function clearSensitiveUI() {
  epoch++; revealTimers.forEach(clearTimeout); revealTimers = [];
  state.current = null; state.selected = null; state.items = []; state.search = ''; state.mode = 'loading';
  state.localSsh = null; state.localConfig = null; state.sshView = null; state.configSel = { entryName: null, relPath: null, fileData: null, revealed: false };
  for (const node of document.querySelectorAll('input,textarea')) node.value = '';
  $('#modal').close(); $('#modal').replaceChildren(); $('#main').replaceChildren(); $('#toast').hidden = true; $('#toast').textContent = '';
}
async function boot() {
  try {
    state.status = await api('status');
    if (state.status.unlocked) { state.offline = state.status.offline; state.mode = 'browse'; await reloadItems(); }
    else if (!state.status.settings.project || !state.status.oauthConfigured) { state.mode = 'setup'; }
    else { state.mode = 'unlock'; state.offline = false; if (state.status.signedIn) { try { const p = await api('vault-probe'); state.exists = p.exists; } catch (error) { state.exists = true; toast(error.message, true); } } }
    render();
  } catch (error) { $('#main').replaceChildren(append(el('div', 'content'), el('h1', '', 'Unable to open the vault'), notice(error.message, 'error'), button('Retry', boot))); }
}
async function reloadItems() {
  state.items = await api('vault-list');
  if (state.selected && !state.items.some(item => item.id === state.selected)) state.selected = null;
  const [sshData, cfgData] = await Promise.all([api('ssh-local').catch(() => null), api('config-local').catch(() => null)]);
  if (sshData && Array.isArray(sshData.keys)) state.localSsh = sshData;
  if (cfgData && Array.isArray(cfgData.entries)) state.localConfig = cfgData;
}
function renderSidebar() {
  const side = $('#sidebar'); side.replaceChildren();
  append(side, append(el('div', 'brand'), doorMark(), append(el('div'), el('div', 'brand-name', 'Vault'), el('div', 'eyebrow', 'THE HIDDEN DOOR'))));
  const unlocked = Boolean(state.status?.unlocked);
  const pill = el('div', `vault-pill${unlocked ? '' : ' locked'}`);
  append(pill, el('span', 'orb'), append(el('div'), el('p', '', state.status?.settings.vault ? `${state.status.settings.vault[0].toUpperCase()}${state.status.settings.vault.slice(1)} vault` : 'Your private vault'), el('small', '', unlocked ? (state.offline ? 'Offline / read only' : 'Google Cloud / encrypted') : 'Locked on this device'))); side.append(pill);
  side.append(el('div', 'nav-label', 'LIBRARY'));
  for (const kind of ['all', 'login', 'card', 'ssh', 'api', 'recovery', 'note', 'favorites', 'archive']) {
    const vaultCount = state.items.filter(i => {
      if (kind === 'archive') return i.archived;
      if (i.archived) return false;
      if (kind === 'all') return true;
      if (kind === 'favorites') return i.favorite;
      if (kind === 'recovery') return i.kind === 'recovery' || i.hasRecoveryCodes;
      return i.kind === kind;
    }).length;
    const countLabel = unlocked ? String(vaultCount) : '';
    const n = el('button', `nav-btn${state.mode === 'browse' && state.filter === kind ? ' active' : ''}`);
    n.type = 'button'; append(n, append(el('span', 'nav-icon'), svgIcon(kind)), el('span', '', names[kind]), el('span', 'nav-count', countLabel));
    n.disabled = !unlocked; n.addEventListener('click', () => { state.mode = 'browse'; state.filter = kind; state.search = ''; state.current = null; state.selected = null; state.sshView = kind === 'ssh' ? { type: 'env', tab: 'config', hostSearch: '' } : null; render(); }); side.append(n);
  }
  const cfgBtn = el('button', `nav-btn${state.mode === 'config' ? ' active' : ''}`);
  cfgBtn.type = 'button'; cfgBtn.disabled = !unlocked;
  append(cfgBtn, append(el('span', 'nav-icon'), svgIcon('config')), el('span', '', '~/.config'), el('span', 'nav-count', unlocked && state.localConfig?.entries ? String(state.localConfig.entries.length) : ''));
  cfgBtn.addEventListener('click', () => { state.mode = 'config'; state.search = ''; state.current = null; render(); });
  side.append(cfgBtn);
  side.append(el('hr', 'sidebar-rule'));
  for (const [mode, text] of [['generator', 'Generator'], ['settings', 'Settings & backup']]) {
    const n = el('button', `nav-btn${state.mode === mode ? ' active' : ''}`); append(n, append(el('span', 'nav-icon'), svgIcon(mode)), el('span', '', text)); n.type = 'button'; n.disabled = mode === 'generator' && !unlocked;
    n.addEventListener('click', () => { state.mode = mode; state.current = null; render(); }); side.append(n);
  }
  const bottom = el('div', 'sidebar-bottom');
  append(bottom, append(el('div', 'account-row'), el('span', 'small-orb'), el('span', '', state.status?.signedIn ? 'Google connected' : 'Your cloud. Your control.')), el('div', 'account-email', state.status?.email || 'No account connected'));
  if (unlocked) bottom.append(button('Lock vault', async () => { await api('vault-lock'); }, 'subtle small wide'));
  bottom.append(el('div', 'shortcut', IS_MAC ? 'Open: Control + Option + Space\nLock: Command + Shift + L' : 'Open: tray icon (Ctrl + Alt + Space on X11)\nLock: Ctrl + Shift + L')); side.append(bottom);
}
function render() {
  revealTimers.forEach(clearTimeout); revealTimers = [];
  syncSky(state.mode === 'setup' || state.mode === 'unlock' || state.mode === 'loading');
  renderSidebar(); $('#main').replaceChildren();
  if (state.mode === 'setup') renderSetup();
  else if (state.mode === 'unlock') renderUnlock();
  else if (state.mode === 'browse') renderBrowse();
  else if (state.mode === 'config') renderConfigBrowser();
  else if (state.mode === 'generator') renderGenerator();
  else if (state.mode === 'settings') renderSettings();
  else $('#main').append(el('div', 'loading', 'Opening your vault...'));
}
// Running Secret Manager cost estimate: billable versions × list price, minus the free tier.
// An estimate from counts, not a bill; the Billing API is outside this app's scope.
function money(n) { return `$${n.toFixed(2)}`; }
function costBadge() {
  const c = state.status?.cost; if (!state.status?.unlocked || !c) return null;
  const b = el('button', `cost-badge${c.known && c.stale ? ' stale' : ''}${c.known ? '' : ' unknown'}`); b.type = 'button';
  append(b, el('span', 'cost-label', 'GCP SM'), el('span', 'cost-value', c.known ? `≈ ${money(c.monthly)}/mo` : 'cost: counting…'));
  b.title = c.known ? `${c.billable} billable versions across ${c.secrets} secrets at ${money(c.pricePerVersion)} each after ${c.freeVersions} free. Counted ${new Date(c.at).toLocaleString()}${c.savesSince ? `, +${c.savesSince} saves since` : ''}${c.pending ? `, ${c.pending} awaiting destruction` : ''}. Estimate, not a bill.` : 'Counting secret versions in the background. Estimate, not a bill.';
  b.setAttribute('aria-label', 'Estimated Google Secret Manager cost; open Settings');
  b.addEventListener('click', () => { state.mode = 'settings'; state.settingsTab = 'cloud'; render(); });
  return b;
}
function header(title, options = {}) {
  const top = el('header', 'topbar'); append(top, el('h1', '', title), state.status?.syncing ? el('span', 'sync-pill', 'Syncing with Google…') : null, costBadge(), el('div', 'spacer'));
  if (options.search) {
    const search = input(state.search, 'search', state.mode === 'config' ? 'Search ~/.config directories & files' : 'Search your vault'); search.id = 'search'; search.setAttribute('aria-label', 'Search titles, account names, tags and websites');
    search.addEventListener('input', () => { state.search = search.value; if (state.mode === 'config') renderConfigList(); else renderList(); });
    append(top, append(el('div', 'search-wrap'), search, el('kbd', '', '\u2318 K')));
  }
  if (options.add) top.append(button('+ New item', () => renderEditor(), 'primary', state.offline));
  $('#main').append(top);
  if (state.status?.unlocked && state.offline) $('#main').append(el('div', 'info-bar offline', 'Offline snapshot / Read-only. Cloud changes and access revocations cannot be checked while offline.'));
  for (const warning of state.status?.warnings || []) $('#main').append(el('div', 'info-bar warning', warning));
  return top;
}
function renderSetup() {
  const layout = el('div', 'setup-layout'), hero = el('section', 'hero');
  const title = el('h1'); append(title, document.createTextNode('Your keys.'), el('br'), document.createTextNode('Your cloud.'), el('br'), el('span', '', 'Your door.'));
  append(hero, thdDevice(), el('div', 'eyebrow', 'MEET YOUR PRIVATE VAULT'), title, el('p', '', 'Passwords, payment cards, SSH keys, passkeys and the credentials that keep your world running. Encrypted on ' + DEVICE + ' before they enter Google Secret Manager.'));
  const chips = el('div', 'security-chips'); for (const text of ['AES-256-GCM', 'GOOGLE OAUTH + PKCE', 'NO APP BACKEND']) chips.append(el('span', 'security-chip', text)); hero.append(chips);
  hero.append(el('p', 'footnote', 'Includes hdv CLI, OpenSSH Agent, WebAuthn Passkeys, and Chromium Browser AutoFill integration.'));
  const form = el('section');
  const config = el('div', 'panel'); append(config, append(el('div', 'step-heading'), el('span', 'step-number', '1'), el('h3', '', 'Choose your cloud vault')));
  const project = input(state.status?.settings.project || '', 'text', 'your-google-cloud-project-id'); project.id = 'project-id';
  const vaultName = input(state.status?.settings.vault || 'personal', 'text', 'personal'); vaultName.id = 'vault-name';
  append(config, field('Google Cloud project ID', project), field('Vault name', vaultName), el('div', 'hint', 'Use a dedicated project with Secret Manager enabled. Setup commands and required permissions are described in README.md.'), button('Save cloud settings', () => busy(async () => { state.status = await api('configure', { project: project.value.trim(), vault: vaultName.value.trim(), idleSeconds: 300 }); render(); toast('Cloud settings saved.'); }), 'primary wide'));
  const oauth = el('div', 'panel'); append(oauth, append(el('div', 'step-heading'), el('span', 'step-number', '2'), el('h3', '', 'Connect your Google account')), el('p', '', 'Import the Desktop app OAuth client JSON from your project. Google sign-in opens in your normal browser; this app never asks for your Google password.'));
  if (state.status?.authUnreadable) oauth.append(notice(IS_MAC ? 'The saved Google sign-in could not be read from macOS-protected storage (Keychain access was denied or the app signature changed). Import the OAuth client JSON again to reset it.' : 'The saved Google sign-in could not be read from OS-protected storage (the system keyring was locked or unavailable). Unlock the keyring, or import the OAuth client JSON again to reset it.', 'warning'));
  append(oauth, button(state.status?.oauthConfigured ? 'Replace Desktop OAuth JSON' : 'Import Desktop OAuth JSON', () => busy(async () => { const result = await api('import-oauth'); if (!result.cancelled) { state.status = result; render(); toast('Desktop OAuth client configured.'); } }), 'wide'));
  append(oauth, el('div', 'hint', 'Do not use a service-account key or Web application client.'), button('Sign in with Google', () => signIn(), 'primary wide', !state.status?.oauthConfigured || !state.status?.settings.project));
  append(form, config, oauth); append(layout, hero, form); $('#main').append(layout);
}
async function signIn() {
  await busy(async () => { state.status = await api('google-login'); const p = await api('vault-probe'); state.exists = p.exists; state.offline = false; state.mode = 'unlock'; render(); }, 'Waiting for Google sign-in...');
}
function renderUnlock() {
  const wrapper = el('div', 'unlock-wrap'), card = el('section', 'unlock-card');
  append(card, doorMark(), thdDevice(), el('h1', '', state.exists ? 'Welcome back.' : 'Make it yours.'), el('p', 'subtitle', state.exists ? 'Your Google account opens the cloud.\nYour master password opens the vault.' : 'Create a private vault in your Google Cloud project.'));
  if (!state.status.signedIn && !state.offline) {
    append(card, button('Sign in with Google', signIn, 'primary wide'), el('div', 'hint', 'Existing credentials are never available from Google sign-in alone.'), button('Open an existing offline snapshot', openOffline, 'subtle wide'), button('Cloud settings', () => { state.mode = 'setup'; render(); }, 'subtle wide'));
  } else if (!state.exists && !state.offline) {
    const pw = secretInput('At least 16 characters', 'new-password'), cf = secretInput('Repeat your master password', 'new-password'); const password = pw.control, confirmation = cf.control;
    append(card, notice('Choose a unique, strong master password. You will also receive a recovery code. Save that code somewhere outside this vault.'), field('Master password', pw.wrap), field('Confirm master password', cf.wrap));
    card.append(button('Create encrypted vault', () => busy(async () => {
      if (password.value !== confirmation.value) throw new Error('The master passwords do not match.');
      const result = await api('vault-create', { password: password.value }); password.value = ''; confirmation.value = '';
      state.status = await api('status'); state.mode = 'browse'; state.items = []; render(); showRecovery(result.recoveryCode);
    }, 'Creating encrypted vault...'), 'primary wide'));
    card.append(button('Back to cloud settings', () => { state.mode = 'setup'; render(); }, 'subtle wide'));
  } else {
    if (state.offline) card.append(notice('Offline mode uses the last successful encrypted snapshot. It does not check cloud access and cannot save changes.'));
    const sw = secretInput('Master password', 'current-password'), secret = sw.control, recovery = checkbox('Use my recovery code'); secret.id = 'unlock-password';
    recovery.input.addEventListener('change', () => { secret.placeholder = recovery.input.checked ? 'HDV1-...' : 'Master password'; secret.value = ''; });
    append(card, field('Unlock credential', sw.wrap), recovery.label);
    const unlock = async () => busy(async () => { await api('vault-unlock', { credential: secret.value, recovery: recovery.input.checked, offline: state.offline }); secret.value = ''; state.status = await api('status'); state.mode = 'browse'; await reloadItems(); render(); }, 'Decrypting on this device...');
    card.append(button(state.offline ? 'Unlock offline snapshot' : 'Unlock vault', unlock, 'primary wide'));
    if (state.status?.biometric?.enabled) {
      const bio = async () => busy(async () => { await api('biometric-unlock', { offline: state.offline }); state.status = await api('status'); state.mode = 'browse'; await reloadItems(); render(); window.focus(); $('.search-wrap input')?.focus(); }, `Waiting for ${bioLabel()}...`);
      card.append(button(`Unlock with ${bioLabel()}`, bio, 'wide touchid'));
    }
    secret.addEventListener('keydown', event => { if (event.key === 'Enter') run(unlock); });
    const row = el('div', 'button-row unlock-secondary-row');
    append(row, button(state.offline ? 'Use Google connection' : 'Open offline instead', state.offline ? async () => { state.offline = false; await boot(); } : openOffline, 'subtle small wide'), button('Reconnect Google', signIn, 'subtle small wide'));
    append(card, row, el('div', 'footnote', 'Auto-lock is enabled. The master password and recovery code are never saved to disk or sent to Google.'));
    setTimeout(() => secret.isConnected && secret.focus(), 50);
    if ((!initialAutoTouchIdDone || pendingAutoTouchId) && state.status?.biometric?.enabled && state.status?.biometric?.available) {
      initialAutoTouchIdDone = true;
      pendingAutoTouchId = false;
      setTimeout(() => { autoTouchIdUnlock(); }, 100);
    }
  }
  append(wrapper, card); $('#main').append(wrapper);
}
let initialAutoTouchIdDone = false, pendingAutoTouchId = false, autoBioPending = false;
async function autoTouchIdUnlock() {
  if (state.mode === 'loading') { pendingAutoTouchId = true; return; }
  if (autoBioPending || state.busy || state.mode !== 'unlock' || state.exists === false) return;
  if (!state.status?.biometric?.enabled || !state.status?.biometric?.available) return;
  const pwInput = $('#unlock-password');
  if (pwInput && pwInput.value.length > 0) return;
  pendingAutoTouchId = false;
  autoBioPending = true;
  try {
    await busy(async () => {
      await api('biometric-unlock', { offline: state.offline });
      state.status = await api('status');
      state.mode = 'browse';
      await reloadItems();
      render();
      window.focus();
      $('.search-wrap input')?.focus();
    }, `Waiting for ${bioLabel()}...`);
  } catch (_) {
    setTimeout(() => $('#unlock-password')?.focus(), 50);
  } finally {
    autoBioPending = false;
  }
}
async function openOffline() { const p = await api('vault-probe', { offline: true }); if (!p.exists) throw new Error('No offline snapshot exists yet. Connect and unlock online once first.'); state.exists = true; state.offline = true; state.mode = 'unlock'; render(); }
function showRecovery(code) {
  const modal = $('#modal'); modal.replaceChildren();
  append(modal, el('h2', '', 'Keep your spare key.'), el('p', '', 'This recovery code can decrypt your vault without the master password. Save it offline, outside this app. It will not be shown again.'), el('div', 'recovery', code));
  const saved = checkbox('I saved this recovery code somewhere safe.');
  const done = button('Open my vault', () => { modal.close(); modal.replaceChildren(); code = ''; }, 'primary', true);
  saved.input.addEventListener('change', () => { done.disabled = !saved.input.checked; });
  append(modal, button('Copy recovery code', async () => { await api('copy', { value: code }); toast('Copied. Clipboard clears after 30 seconds.'); }, 'subtle'), saved.label, notice('Losing both the master password and this code means losing access. Google account recovery cannot decrypt the vault.', 'warning'), append(el('div', 'button-row end'), done));
  const preventCancel = event => event.preventDefault();
  modal.addEventListener('cancel', preventCancel);
  modal.addEventListener('close', () => modal.removeEventListener('cancel', preventCancel), { once: true });
  modal.showModal();
}
function matchingItems() {
  const search = state.search.toLowerCase().trim();
  return state.items.filter(item => {
    const category = state.filter === 'archive'
      ? item.archived
      : !item.archived && (
        state.filter === 'all' ||
        (state.filter === 'favorites'
          ? item.favorite
          : state.filter === 'recovery'
            ? (item.kind === 'recovery' || item.hasRecoveryCodes)
            : item.kind === state.filter)
      );
    return category && (!search || `${item.title} ${item.subtitle} ${item.tags}`.toLowerCase().includes(search));
  });
}
function isLocalKeyInVault(localKey) {
  return state.items.some(i => !i.archived && i.kind === 'ssh' && (i.title === localKey.name || (localKey.fingerprint && i.subtitle && i.subtitle.includes(localKey.fingerprint))));
}
function renderBrowse() {
  header(names[state.filter], { search: true, add: true });
  const body = el('div', 'browse'); append(body, el('section', 'item-column'), el('section', 'detail')); $('#main').append(body); renderList();
  if (state.current) renderDetail(state.current);
  else if (state.filter === 'ssh' && state.localSsh) {
    if (state.sshView?.type === 'local-key') {
      const k = state.localSsh.keys.find(x => x.name === state.sshView.name);
      if (k) renderLocalSshKeyDetail(k); else renderSshEnvDetail();
    } else renderSshEnvDetail();
  } else if (state.filter === 'recovery') {
    renderVaultRecoveryOverview();
  } else renderEmptyDetail();
}
function renderList() {
  const column = $('.item-column'); if (!column) return; column.replaceChildren();
  const items = matchingItems();
  const headingLabel = state.filter === 'ssh' ? 'VAULT SSH KEYS' : state.filter === 'recovery' ? 'SERVICE RECOVERY CODES' : 'YOUR ITEMS';
  append(column, append(el('div', 'column-heading'), el('span', '', headingLabel), el('span', '', `${items.length} RECORD${items.length === 1 ? '' : 'S'}`)));
  for (const item of items) {
    const row = el('button', `item-row${item.id === state.selected ? ' selected' : ''}`); row.type = 'button'; row.dataset.kind = item.kind;
    let badge = null;
    if (item.recoveryTotal > 0 && (state.filter === 'recovery' || item.kind === 'recovery')) {
      const low = item.recoveryRemaining <= 2;
      badge = el('span', `mini-badge${low ? ' warn' : ' ok'}`, `${item.recoveryRemaining}/${item.recoveryTotal}`);
    } else if (item.hasPasskey) {
      badge = el('span', 'mini-badge ok', 'PASSKEY');
    }
    const subText = state.filter === 'recovery' && item.kind === 'login' && item.recoveryTotal > 0
      ? `${item.recoveryRemaining} of ${item.recoveryTotal} unused · ${item.username || item.url || 'Login'}`
      : (item.subtitle || names[item.kind]);
    append(row, append(el('span', 'item-icon mono'), svgIcon(state.filter === 'recovery' ? 'recovery' : item.kind)), append(el('span', 'item-copy'), el('div', 'item-title', item.title), el('div', 'item-subtitle', subText)), badge, item.favorite ? append(el('span', 'star'), svgIcon('starSolid')) : null);
    row.addEventListener('click', () => run(async () => { const itemData = await api('vault-get', { id: item.id }); state.selected = item.id; state.current = itemData; state.sshView = null; renderList(); renderDetail(itemData); })); column.append(row);
  }
  if (!items.length && state.filter !== 'ssh') {
    append(column, el('div', 'hint', state.search
      ? 'No matching items. Try a title, tag or username.'
      : state.filter === 'recovery'
        ? 'No 2FA backup or recovery code sets saved yet. Click "+ New item" (Recovery) or add recovery codes to any Login.'
        : 'Nothing here yet. Add your first item or import a login CSV in Settings.'));
  }
  if (state.filter === 'recovery') {
    append(column, append(el('div', 'column-heading section-gap'), el('span', '', 'VAULT SPARE KEY'), el('span', '', 'HEADER KEY')));
    const isSel = !state.selected && !state.current;
    const spareRow = el('button', `item-row${isSel ? ' selected' : ''}`); spareRow.type = 'button'; spareRow.dataset.kind = 'recovery';
    append(spareRow,
      append(el('span', 'item-icon mono'), svgIcon('shieldCheck')),
      append(el('span', 'item-copy'), el('div', 'item-title', 'Hidden Door Vault Spare Key'), el('div', 'item-subtitle mono', 'HDV1-… · Emergency vault decryptor')),
      el('span', 'mini-badge ok', 'ACTIVE'));
    spareRow.addEventListener('click', () => { state.selected = null; state.current = null; renderList(); renderVaultRecoveryOverview(); });
    column.append(spareRow);
  }
  if (state.filter === 'ssh' && state.localSsh) {
    if (!items.length && !state.search) append(column, el('div', 'hint compact-hint', 'No SSH keys stored in Google Secret Manager yet. Import any local ~/.ssh key below with one click.'));
    const search = state.search.toLowerCase().trim();
    const localKeys = (state.localSsh.keys || []).filter(k => !search || `${k.name} ${k.keyType} ${k.comment} ${k.fingerprint} ${(k.hosts || []).join(' ')}`.toLowerCase().includes(search));
    append(column, append(el('div', 'column-heading section-gap'), el('span', '', 'LOCAL ~/.SSH KEYS'), el('span', '', `${localKeys.length} ON DISK`)));
    for (const k of localKeys) {
      const isSel = !state.selected && state.sshView?.type === 'local-key' && state.sshView.name === k.name;
      const inVault = isLocalKeyInVault(k);
      const row = el('button', `item-row${isSel ? ' selected' : ''}`); row.type = 'button'; row.dataset.kind = 'ssh';
      const subParts = [k.keyType || 'KEY', k.hosts?.length ? `${k.hosts.length} host${k.hosts.length === 1 ? '' : 's'}` : null, k.fingerprint ? k.fingerprint.slice(0, 19) + '…' : null].filter(Boolean);
      const badge = el('span', `mini-badge${inVault ? ' ok' : ''}`, inVault ? 'IN VAULT' : '~/.SSH');
      append(row, append(el('span', 'item-icon mono'), svgIcon('ssh')), append(el('span', 'item-copy'), el('div', 'item-title', k.name), el('div', 'item-subtitle mono', subParts.join(' · '))), badge);
      row.addEventListener('click', () => { state.selected = null; state.current = null; state.sshView = { type: 'local-key', name: k.name }; renderList(); renderLocalSshKeyDetail(k); });
      column.append(row);
    }
    append(column, append(el('div', 'column-heading section-gap'), el('span', '', '~/.SSH ENVIRONMENT'), el('span', '', 'LOCAL MAC')));
    const envRows = [
      ['config', 'host', 'SSH Config Hosts', `config · ${(state.localSsh.config?.hosts || []).length} host blocks`],
      ['authorized', 'shieldCheck', 'Authorized Keys', `authorized_keys · ${(state.localSsh.authorizedKeys?.keys || []).length} keys`],
      ['known', 'globe', 'Known Hosts', `known_hosts · ${state.localSsh.knownHosts?.totalLines || 0} entries`]
    ];
    for (const [tabKey, iconName, title, sub] of envRows) {
      const isSel = !state.selected && (!state.sshView || (state.sshView.type === 'env' && state.sshView.tab === tabKey));
      const row = el('button', `item-row${isSel ? ' selected' : ''}`); row.type = 'button';
      append(row, append(el('span', 'item-icon mono'), svgIcon(iconName)), append(el('span', 'item-copy'), el('div', 'item-title', title), el('div', 'item-subtitle mono', sub)));
      row.addEventListener('click', () => { state.selected = null; state.current = null; state.sshView = { type: 'env', tab: tabKey, hostSearch: '' }; renderList(); renderSshEnvDetail(); });
      column.append(row);
    }
  }
}
function renderLocalSshKeyDetail(k) {
  revealTimers.forEach(clearTimeout); revealTimers = [];
  const detail = $('.detail'); if (!detail) return; detail.replaceChildren();
  const inVault = isLocalKeyInVault(k);
  const top = el('div', 'detail-top'), info = el('div', 'detail-title'), actions = el('div', 'detail-actions');
  append(info, el('h2', 'mono', `~/.ssh/${k.name}`), el('span', 'tag', 'Local ~/.ssh key'), el('span', 'tag', k.keyType || 'SSH'));
  if (k.privateMode || k.publicMode) info.append(el('span', 'tag mono', `mode ${k.privateMode || k.publicMode}`));
  if (k.encrypted) info.append(el('span', 'tag', 'Passphrase protected'));
  if (inVault) info.append(el('span', 'tag ok-tag', 'Backed up in Vault'));
  if (k.hasPrivate) {
    actions.append(button(inVault ? 'Update in Vault' : 'Import into Vault', () => busy(async () => {
      const priv = await api('ssh-local-key', { name: k.name });
      const hostList = (k.hosts || []).length ? `Linked ~/.ssh/config hosts: ${k.hosts.join(', ')}` : 'Imported from local ~/.ssh directory.';
      const existingVaultItem = state.items.find(i => !i.archived && i.kind === 'ssh' && i.title === k.name);
      const saved = await api('vault-save', {
        item: {
          ...(existingVaultItem ? { id: existingVaultItem.id } : {}),
          kind: 'ssh',
          title: k.name,
          publicKey: k.publicKey || '',
          privateKey: priv.privateKey || '',
          fingerprint: k.fingerprint || '',
          tags: 'local-ssh, ~/.ssh',
          notes: `${hostList}\nSource path: ~/.ssh/${k.name} (${priv.mode || k.privateMode || '0600'})`,
          favorite: existingVaultItem ? existingVaultItem.favorite : false,
          archived: false
        }
      });
      await reloadItems(); state.status = await api('status');
      state.selected = saved.id; state.current = saved; state.sshView = null;
      render(); toast(`Encrypted and saved ~/.ssh/${k.name} to Google Secret Manager.`);
    }, 'Encrypting SSH key into Vault...'), 'primary small', state.offline));
  }
  actions.append(button('Delete local file', () => busy(async () => {
    const res = await api('ssh-local-remove', { target: 'local-key', name: k.name, inVault });
    if (res.cancelled) return;
    await reloadItems();
    state.sshView = { type: 'env', tab: 'config', hostSearch: '' };
    render();
    toast(`Deleted ~/.ssh/${k.name} from disk.`);
  }, 'Deleting local SSH key...'), 'danger small'));
  append(top, append(el('div', 'item-icon mono'), svgIcon('ssh')), info, actions);
  detail.append(top);

  const fields = el('div', 'field-group');
  append(fields,
    readField('Fingerprint', k.fingerprint),
    readField('Algorithm & comment', [k.keyType, k.comment].filter(Boolean).join(' · ')),
    readField('Public key', k.publicKey, false, true),
    readField('Files on disk', [k.hasPrivate ? `~/.ssh/${k.name} (${k.privateMode})` : null, k.hasPublic ? `~/.ssh/${k.name}.pub (${k.publicMode})` : 'Public key derived from private key'].filter(Boolean).join('  ·  '))
  );
  if (k.hasPrivate) {
    const wrap = el('div', 'read-field'), line = el('div', 'read-line');
    const area = el('textarea', 'read-value mono'); area.rows = 3; area.readOnly = true;
    area.value = '•••••••••••••••••••••••••••••••••••••••• (on disk in ~/.ssh — click Reveal to inspect)';
    const tools = el('div', 'field-tools');
    let loadedPrivate = '';
    const toggleBtn = button('Reveal', async () => {
      if (loadedPrivate) { loadedPrivate = ''; area.value = '•••••••••••••••••••••••••••••••••••••••• (on disk in ~/.ssh — click Reveal to inspect)'; area.rows = 3; setBtnContent(toggleBtn, 'Reveal', 'eye'); return; }
      const res = await api('ssh-local-key', { name: k.name });
      loadedPrivate = res.privateKey || '';
      area.value = loadedPrivate; area.rows = 8; setBtnContent(toggleBtn, 'Hide', 'eyeSlash');
      revealTimers.push(setTimeout(() => { loadedPrivate = ''; area.value = '•••••••••••••••••••••••••••••••••••••••• (on disk in ~/.ssh — click Reveal to inspect)'; area.rows = 3; setBtnContent(toggleBtn, 'Reveal', 'eye'); }, 15000));
    }, 'subtle small');
    const copyBtn = button('Copy', async () => {
      const res = loadedPrivate ? { privateKey: loadedPrivate } : await api('ssh-local-key', { name: k.name });
      await api('copy', { value: res.privateKey });
      toast('Private key copied. Clipboard clears after 30 seconds.');
    }, 'subtle small');
    append(tools, toggleBtn, copyBtn);
    append(line, area, tools);
    append(wrap, el('div', 'read-label', 'Private key (~/.ssh/' + k.name + ')'), line);
    fields.append(wrap);
  }
  detail.append(fields);

  const linkedHosts = (state.localSsh?.config?.hosts || []).filter(h => (k.hosts || []).includes(h.host));
  const hostSection = el('section', 'sgroup env-section');
  append(hostSection, append(el('div', 'sgroup-head'), el('h3', '', `Linked ~/.ssh/config Hosts (${linkedHosts.length})`), el('span', 'sgroup-hint', 'IdentityFile references')));
  if (linkedHosts.length) {
    const grid = el('div', 'host-grid');
    for (const h of linkedHosts) {
      const card = el('div', 'host-card');
      const head = el('div', 'host-card-head');
      append(head, el('strong', 'mono', h.host), button('Copy ssh', async () => { await api('copy', { value: `ssh ${h.host}` }); toast(`Copied "ssh ${h.host}"`); }, 'subtle small'));
      const meta = el('div', 'host-meta mono');
      append(meta,
        h.hostName ? el('div', '', `HostName: ${h.hostName}`) : null,
        h.user ? el('div', '', `User: ${h.user}`) : null,
        h.port && h.port !== '22' ? el('div', '', `Port: ${h.port}`) : null,
        h.proxyJump ? el('div', '', `ProxyJump: ${h.proxyJump}`) : null
      );
      append(card, head, meta);
      grid.append(card);
    }
    hostSection.append(grid);
  } else {
    hostSection.append(el('div', 'sgroup-foot', 'No explicit Host block in ~/.ssh/config points to this key via IdentityFile.'));
  }
  detail.append(hostSection);
}
function renderSshEnvDetail() {
  revealTimers.forEach(clearTimeout); revealTimers = [];
  const detail = $('.detail'); if (!detail) return; detail.replaceChildren();
  const ssh = state.localSsh || { keys: [], config: { hosts: [], raw: '' }, authorizedKeys: { keys: [] }, knownHosts: { hosts: [], totalLines: 0 } };
  if (!state.sshView || state.sshView.type !== 'env') state.sshView = { type: 'env', tab: 'config', hostSearch: '' };
  const activeTab = state.sshView.tab || 'config';

  const top = el('div', 'detail-top'), info = el('div', 'detail-title'), actions = el('div', 'detail-actions');
  append(info, el('h2', '', '~/.ssh Environment Inspector'),
    el('span', 'tag mono', `${ssh.keys.length} local keys`),
    el('span', 'tag mono', `${ssh.config?.hosts?.length || 0} config hosts`),
    el('span', 'tag mono', `${ssh.authorizedKeys?.keys?.length || 0} authorized`),
    el('span', 'tag mono', `${ssh.knownHosts?.totalLines || 0} known hosts`));
  append(actions,
    button('Refresh ~/.ssh', () => busy(async () => { await reloadItems(); render(); toast('Refreshed local ~/.ssh directory.'); }, 'Scanning ~/.ssh...'), 'subtle small'),
    button('Back up ~/.ssh/config to Vault', () => busy(async () => {
      if (!ssh.config?.raw) throw new Error('~/.ssh/config is empty or not present.');
      const existing = state.items.find(i => !i.archived && i.kind === 'note' && i.title === '~/.ssh/config');
      const saved = await api('vault-save', {
        item: {
          ...(existing ? { id: existing.id } : {}),
          kind: 'note',
          title: '~/.ssh/config',
          notes: ssh.config.raw,
          tags: 'ssh, config, ~/.ssh',
          favorite: existing ? existing.favorite : true,
          archived: false
        }
      });
      await reloadItems(); state.status = await api('status');
      toast(`Backed up ~/.ssh/config (${ssh.config.hosts.length} hosts) to Vault.`);
    }, 'Encrypting ~/.ssh/config...'), 'primary small', state.offline || !ssh.config?.raw));
  append(top, append(el('div', 'item-icon mono'), svgIcon('ssh')), info, actions);
  detail.append(top);

  const tabBar = el('div', 'settings-topbar ssh-env-bar');
  const tabs = el('div', 'settings-tabs');
  for (const [k, label, icon] of [
    ['config', `SSH Config Hosts (${ssh.config?.hosts?.length || 0})`, 'ssh'],
    ['authorized', `Authorized Keys (${ssh.authorizedKeys?.keys?.length || 0})`, 'shieldCheck'],
    ['known', `Known Hosts (${ssh.knownHosts?.totalLines || 0})`, 'globe']
  ]) {
    const b = el('button', `settings-tab${activeTab === k ? ' active' : ''}`); b.type = 'button';
    append(b, svgIcon(icon, 'fa-svg tab-icon'), el('span', '', label));
    b.addEventListener('click', () => { state.sshView.tab = k; renderList(); renderSshEnvDetail(); });
    tabs.append(b);
  }
  const filterInput = input(state.sshView.hostSearch || '', 'search', activeTab === 'config' ? 'Filter hosts, IPs, users or keys…' : activeTab === 'authorized' ? 'Filter authorized keys…' : 'Filter known hosts or fingerprints…');
  filterInput.classList.add('compact-search');
  const bodyWrap = el('div', 'ssh-env-body');
  filterInput.addEventListener('input', () => { state.sshView.hostSearch = filterInput.value; paintEnvBody(); });
  append(tabBar, tabs, filterInput);
  detail.append(tabBar, bodyWrap);

  function paintEnvBody() {
    bodyWrap.replaceChildren();
    const q = (state.sshView.hostSearch || '').toLowerCase().trim();
    if (activeTab === 'config') {
      const hosts = (ssh.config?.hosts || []).filter(h => !q || `${h.host} ${h.hostName} ${h.user} ${h.identityFile} ${h.proxyJump}`.toLowerCase().includes(q));
      if (!hosts.length) {
        bodyWrap.append(notice(q ? 'No SSH Config Host blocks match your filter.' : 'No Host blocks found in ~/.ssh/config.'));
      } else {
        const grid = el('div', 'host-grid');
        for (const h of hosts) {
          const card = el('div', 'host-card');
          const head = el('div', 'host-card-head');
          const btns = append(el('div', 'button-row'),
            button('Copy ssh', async () => { await api('copy', { value: `ssh ${h.host}` }); toast(`Copied "ssh ${h.host}"`); }, 'subtle small'),
            button('Remove', () => busy(async () => {
              const res = await api('ssh-local-remove', { target: 'config-host', host: h.host });
              if (res.cancelled) return;
              state.localSsh = await api('ssh-local');
              renderList(); renderSshEnvDetail();
              toast(`Removed Host "${h.host}" (backup saved at ~/.ssh/config.bak).`);
            }, 'Updating ~/.ssh/config...'), 'danger small'));
          append(head, el('strong', 'mono host-alias', h.host), btns);
          const meta = el('div', 'host-meta mono');
          append(meta,
            h.hostName ? el('div', '', `HostName: ${h.hostName}`) : null,
            h.user ? el('div', '', `User: ${h.user}`) : null,
            h.port && h.port !== '22' ? el('div', '', `Port: ${h.port}`) : null,
            h.proxyJump ? el('div', '', `ProxyJump: ${h.proxyJump}`) : null,
            h.identityAgent ? el('div', '', `IdentityAgent: ${h.identityAgent}`) : null
          );
          if (h.identityFile) {
            const keyBase = h.identityFile.split('/').pop();
            const matchedKey = ssh.keys.find(k => k.name === keyBase);
            const keyRow = el('div', 'host-key-row');
            if (matchedKey) {
              const jump = el('button', 'code-pill-copy', `Key: ~/.ssh/${keyBase} →`); jump.type = 'button';
              jump.addEventListener('click', () => { state.sshView = { type: 'local-key', name: matchedKey.name }; renderList(); renderLocalSshKeyDetail(matchedKey); });
              keyRow.append(jump);
            } else {
              keyRow.append(el('span', 'muted mono', `IdentityFile: ${h.identityFile}`));
            }
            meta.append(keyRow);
          }
          append(card, head, meta);
          grid.append(card);
        }
        bodyWrap.append(grid);
      }
      if (ssh.config?.raw) {
        const rawGroup = el('section', 'sgroup env-section');
        append(rawGroup,
          append(el('div', 'sgroup-head'), el('h3', '', 'Raw ~/.ssh/config'), button('Copy config', async () => { await api('copy', { value: ssh.config.raw }); toast('Copied ~/.ssh/config to clipboard.'); }, 'subtle small')),
          el('pre', 'code-block config-pre', ssh.config.raw));
        bodyWrap.append(rawGroup);
      }
    } else if (activeTab === 'authorized') {
      const authKeys = (ssh.authorizedKeys?.keys || []).filter(k => !q || `${k.keyType} ${k.comment} ${k.fingerprint} ${k.options}`.toLowerCase().includes(q));
      bodyWrap.append(el('p', 'hint', `Public keys listed in ~/.ssh/authorized_keys are authorized to log into ${DEVICE} over SSH.`));
      if (!authKeys.length) {
        bodyWrap.append(notice(q ? 'No authorized keys match your filter.' : `~/.ssh/authorized_keys is empty or not present on ${DEVICE}.`));
      } else {
        const list = el('div', 'auth-list');
        for (const ak of authKeys) {
          const matchingLocal = ssh.keys.find(lk => lk.fingerprint && lk.fingerprint === ak.fingerprint);
          const card = el('div', 'sgroup auth-card');
          const head = el('div', 'sgroup-head');
          const badges = el('div', 'pill-row');
          append(badges, el('span', 'tag', ak.keyType), el('span', 'tag mono', `Line ${ak.line}`));
          if (matchingLocal) badges.append(el('span', 'tag ok-tag', `Matches ~/.ssh/${matchingLocal.name}`));
          if (ak.options) badges.append(el('span', 'tag', `opts: ${ak.options}`));
          const btns = append(el('div', 'button-row'),
            button('Copy public key', async () => { await api('copy', { value: ak.raw }); toast('Authorized public key copied.'); }, 'subtle small'),
            button('Remove', () => busy(async () => {
              const res = await api('ssh-local-remove', { target: 'authorized-key', line: ak.line, comment: ak.comment, fingerprint: ak.fingerprint, publicKey: ak.publicKey });
              if (res.cancelled) return;
              state.localSsh = await api('ssh-local');
              renderList(); renderSshEnvDetail();
              toast('Removed authorized key (backup saved at ~/.ssh/authorized_keys.bak).');
            }, 'Updating ~/.ssh/authorized_keys...'), 'danger small'));
          append(head,
            append(el('div'), el('h3', 'mono', ak.comment || '(no comment)'), badges),
            btns);
          append(card, head,
            readField('SHA-256 Fingerprint', ak.fingerprint),
            readField('Public key line', ak.raw, false, true));
          list.append(card);
        }
        bodyWrap.append(list);
      }
    } else if (activeTab === 'known') {
      const allKnown = ssh.knownHosts?.hosts || [];
      const filtered = allKnown.filter(h => !q || `${h.host} ${h.keyType} ${h.fingerprint} ${h.comment}`.toLowerCase().includes(q));
      const headRow = el('div', 'known-summary');
      append(headRow,
        el('span', 'hint', `Showing ${Math.min(filtered.length, 250)} of ${filtered.length} matching entries (${ssh.knownHosts?.totalLines || 0} total in ~/.ssh/known_hosts).`),
        ssh.knownHosts?.raw ? button('Back up known_hosts to Vault', () => busy(async () => {
          const existing = state.items.find(i => !i.archived && i.kind === 'note' && i.title === '~/.ssh/known_hosts');
          await api('vault-save', {
            item: {
              ...(existing ? { id: existing.id } : {}),
              kind: 'note',
              title: '~/.ssh/known_hosts',
              notes: ssh.knownHosts.raw,
              tags: 'ssh, known_hosts, ~/.ssh',
              favorite: false,
              archived: false
            }
          });
          await reloadItems(); state.status = await api('status');
          toast('Backed up ~/.ssh/known_hosts to Vault.');
        }, 'Encrypting known_hosts...'), 'subtle small', state.offline) : null);
      bodyWrap.append(headRow);
      if (!filtered.length) {
        bodyWrap.append(notice(q ? 'No known_hosts entries match your filter.' : 'No entries found in ~/.ssh/known_hosts.'));
      } else {
        const table = el('div', 'sgroup known-table');
        for (const kh of filtered.slice(0, 250)) {
          const row = el('div', 'known-row');
          const left = el('div', 'known-main');
          append(left,
            append(el('div', 'known-host-line'),
              el('strong', 'mono', kh.host),
              el('span', 'tag', kh.keyType),
              kh.revoked ? el('span', 'tag danger-tag', 'REVOKED') : null,
              kh.certAuthority ? el('span', 'tag', '@cert-authority') : null,
              el('span', 'muted mono', `L${kh.line}`)),
            el('div', 'known-fp mono', kh.fingerprint || '(unparsed key)'));
          const btns = append(el('div', 'button-row'),
            button('Copy FP', async () => { await api('copy', { value: kh.fingerprint || kh.host }); toast(`Copied ${kh.host} fingerprint.`); }, 'subtle small'),
            button('Remove', () => busy(async () => {
              const res = await api('ssh-local-remove', { target: 'known-host', line: kh.line, host: kh.host, rawHostField: kh.rawHostField, fingerprint: kh.fingerprint });
              if (res.cancelled) return;
              state.localSsh = await api('ssh-local');
              renderList(); renderSshEnvDetail();
              toast(`Removed ${kh.host} from ~/.ssh/known_hosts (backup saved).`);
            }, 'Updating ~/.ssh/known_hosts...'), 'danger small'));
          append(row, left, btns);
          table.append(row);
        }
        bodyWrap.append(table);
      }
    }
  }
  paintEnvBody();
}
function renderConfigBrowser() {
  header('~/.config Inspector', { search: true });
  const body = el('div', 'browse'); append(body, el('section', 'item-column'), el('section', 'detail')); $('#main').append(body);
  renderConfigList();
  renderConfigDetail();
}
function renderConfigList() {
  const column = $('.item-column'); if (!column) return; column.replaceChildren();
  const entries = state.localConfig?.entries || [];
  const q = state.search.toLowerCase().trim();
  const filtered = entries.filter(e => !q || e.name.toLowerCase().includes(q) || (e.files || []).some(f => f.relPath.toLowerCase().includes(q)));
  append(column, append(el('div', 'column-heading'), el('span', '', '~/.CONFIG DIRECTORIES'), el('span', '', `${filtered.length} ITEM${filtered.length === 1 ? '' : 'S'}`)));
  if (!state.configSel.entryName && filtered.length) {
    const first = filtered.find(e => e.files?.length) || filtered[0];
    state.configSel.entryName = first.name;
    state.configSel.relPath = first.files?.[0]?.relPath || null;
  }
  for (const entry of filtered) {
    const isSel = state.configSel.entryName === entry.name;
    const hasSensitive = (entry.files || []).some(f => f.sensitive);
    const row = el('button', `item-row${isSel ? ' selected' : ''}`); row.type = 'button';
    const sub = entry.kind === 'dir' ? `${entry.fileCount} readable file${entry.fileCount === 1 ? '' : 's'}` : `${entry.files?.[0]?.size || 0} bytes`;
    append(row,
      append(el('span', 'item-icon mono'), svgIcon(entry.kind === 'dir' ? 'folder' : 'fileCode')),
      append(el('span', 'item-copy'), el('div', 'item-title mono', entry.name), el('div', 'item-subtitle', sub)),
      hasSensitive ? el('span', 'mini-badge warn', 'AUTH/KEY') : null);
    row.addEventListener('click', () => run(async () => {
      state.configSel = { entryName: entry.name, relPath: entry.files?.[0]?.relPath || null, fileData: null, revealed: false };
      renderConfigList();
      await loadAndRenderConfigFile();
    }));
    column.append(row);
  }
  if (!filtered.length) column.append(el('div', 'hint', q ? 'No ~/.config directories or files match your search.' : 'No readable files found in ~/.config.'));
}
async function loadAndRenderConfigFile() {
  if (state.configSel.relPath) {
    try { state.configSel.fileData = await api('config-local-file', { relPath: state.configSel.relPath }); }
    catch (err) { state.configSel.fileData = { error: err.message }; }
  }
  renderConfigDetail();
}
function renderConfigDetail() {
  const detail = $('.detail'); if (!detail) return; detail.replaceChildren();
  const entries = state.localConfig?.entries || [];
  const entry = entries.find(e => e.name === state.configSel.entryName);
  if (!entry) {
    detail.append(append(el('div', 'empty'), append(el('div', 'empty-icon'), svgIcon('config')), el('h2', '', 'Inspect ~/.config'), el('p', '', 'Select a tool directory from ~/.config on the left to inspect its local configuration files and back up critical configs or tokens to your Vault.')));
    return;
  }
  if (state.configSel.relPath && !state.configSel.fileData) {
    run(loadAndRenderConfigFile);
    detail.append(el('div', 'loading', `Reading ~/.config/${state.configSel.relPath}…`));
    return;
  }
  const top = el('div', 'detail-top'), info = el('div', 'detail-title'), actions = el('div', 'detail-actions');
  append(info, el('h2', 'mono', `~/.config/${entry.name}`), el('span', 'tag', entry.kind === 'dir' ? 'Directory' : 'File'), el('span', 'tag mono', `${entry.fileCount} file${entry.fileCount === 1 ? '' : 's'}`));
  append(actions,
    button('Refresh ~/.config', () => busy(async () => { await reloadItems(); state.configSel.fileData = null; render(); toast('Refreshed ~/.config directory.'); }, 'Scanning ~/.config...'), 'subtle small'),
    button(entry.kind === 'dir' ? 'Delete directory' : 'Delete file', () => busy(async () => {
      const res = await api('config-local-remove', { relPath: entry.name, kind: entry.kind });
      if (res.cancelled) return;
      state.localConfig = await api('config-local');
      state.configSel = { entryName: null, relPath: null, fileData: null, revealed: false };
      renderConfigList();
      await loadAndRenderConfigFile();
      toast(`Deleted ~/.config/${entry.name} from disk.`);
    }, `Deleting ~/.config/${entry.name}...`), 'danger small'));
  append(top, append(el('div', 'item-icon mono'), svgIcon(entry.kind === 'dir' ? 'folder' : 'fileCode')), info, actions);
  detail.append(top);

  if (!entry.files || !entry.files.length) {
    detail.append(notice('No readable text configuration files were found in this directory (binary caches, databases and files over 256 KB are skipped).'));
    return;
  }

  const filePicker = el('div', 'config-file-tabs');
  for (const f of entry.files) {
    const shortName = f.relPath.startsWith(entry.name + '/') ? f.relPath.slice(entry.name.length + 1) : f.relPath;
    const b = el('button', `config-file-tab mono${state.configSel.relPath === f.relPath ? ' active' : ''}${f.sensitive ? ' sensitive' : ''}`);
    b.type = 'button';
    append(b, svgIcon(f.sensitive ? 'login' : 'fileCode', 'fa-svg tab-icon'), el('span', '', shortName));
    b.addEventListener('click', () => run(async () => {
      state.configSel.relPath = f.relPath;
      state.configSel.fileData = null;
      state.configSel.revealed = false;
      await loadAndRenderConfigFile();
    }));
    filePicker.append(b);
  }
  detail.append(filePicker);

  const fd = state.configSel.fileData;
  if (!fd) return;
  if (fd.error) { detail.append(notice(fd.error, 'error')); return; }

  const fileCard = el('section', 'sgroup env-section');
  const head = el('div', 'sgroup-head');
  const metaPills = el('div', 'pill-row');
  append(metaPills,
    el('span', 'tag mono', `mode ${fd.mode}`),
    el('span', 'tag mono', `${fd.size.toLocaleString()} bytes`),
    fd.sensitive ? el('span', 'tag warn-tag', 'Sensitive / Auth Config') : null);
  const fileActions = el('div', 'button-row');
  if (fd.sensitive) {
    fileActions.append(button(state.configSel.revealed ? 'Mask values' : 'Reveal plaintext', () => {
      state.configSel.revealed = !state.configSel.revealed;
      renderConfigDetail();
    }, 'subtle small'));
  }
  fileActions.append(
    button('Copy file', async () => { await api('copy', { value: fd.content }); toast(`Copied ~/.config/${fd.relPath} (clears in 30s).`); }, 'subtle small'),
    button('Save to Vault', () => busy(async () => {
      const vaultTitle = `~/.config/${fd.relPath}`;
      const existing = state.items.find(i => !i.archived && i.title === vaultTitle);
      await api('vault-save', {
        item: {
          ...(existing ? { id: existing.id } : {}),
          kind: 'note',
          title: vaultTitle,
          notes: fd.content,
          tags: `config, ~/.config, ${entry.name}`,
          favorite: existing ? existing.favorite : false,
          archived: false
        }
      });
      await reloadItems(); state.status = await api('status');
      toast(`Encrypted and saved ${vaultTitle} to Google Secret Manager.`);
    }, 'Encrypting config file into Vault...'), 'primary small', state.offline),
    entry.kind === 'dir' ? button('Delete file', () => busy(async () => {
      const targetRel = fd.relPath;
      const res = await api('config-local-remove', { relPath: targetRel, kind: 'file' });
      if (res.cancelled) return;
      state.localConfig = await api('config-local');
      const updatedEntry = (state.localConfig?.entries || []).find(e => e.name === entry.name);
      state.configSel.entryName = updatedEntry ? updatedEntry.name : null;
      state.configSel.relPath = updatedEntry?.files?.[0]?.relPath || null;
      state.configSel.fileData = null;
      state.configSel.revealed = false;
      renderConfigList();
      await loadAndRenderConfigFile();
      toast(`Deleted ~/.config/${targetRel} from disk.`);
    }, `Deleting ~/.config/${fd.relPath}...`), 'danger small') : null
  );
  append(head, append(el('div'), el('h3', 'mono', `~/.config/${fd.relPath}`), metaPills), fileActions);
  fileCard.append(head);

  const displayContent = fd.sensitive && !state.configSel.revealed
    ? fd.content.split(/\r?\n/).map(line => {
      if (/^\s*(#|\/\/|;|$)/.test(line)) return line;
      const kv = line.match(/^(\s*[\w.-]+\s*[:=]\s*)(.+)$/);
      if (kv) return `${kv[1]}••••••••••••••••`;
      return '••••••••••••••••••••••••••••••••';
    }).join('\n')
    : fd.content;

  if (fd.sensitive && !state.configSel.revealed) {
    fileCard.append(el('div', 'sgroup-foot', 'Values in this file are masked by default because the filename or path matches an authentication or credential pattern. Click "Reveal plaintext" to view.'));
  }
  fileCard.append(el('pre', 'code-block config-pre', displayContent));
  detail.append(fileCard);
}
function renderEmptyDetail() {
  const detail = $('.detail'); if (!detail) return; detail.replaceChildren();
  const empty = el('div', 'empty');
  append(empty, append(el('div', 'empty-icon'), doorMark(true)), el('h2', '', state.items.length ? 'Select an item' : 'Your vault is empty'), el('p', '', state.items.length ? 'Secrets stay encrypted until you open an item. Only titles, account names, tags and websites are kept in memory for search.' : 'Create your first login, card, SSH key, API key or secure note. Each item is encrypted on ' + DEVICE + ' before it is stored in Google Secret Manager.'), !state.offline ? button('+ Create an item', () => renderEditor(), 'primary') : null);
  detail.append(empty);
}
function readField(label, value, secret = false, multiline = false) {
  if (!value) return null;
  const wrap = el('div', 'read-field'), line = el('div', 'read-line');
  const control = multiline && !secret ? el('textarea', 'read-value mono') : el('input', 'read-value mono');
  if (control.tagName === 'INPUT') control.type = secret ? 'password' : 'text';
  control.value = value; control.readOnly = true; control.setAttribute('aria-label', label); if (control.tagName === 'TEXTAREA') control.rows = 3;
  const tools = el('div', 'field-tools');
  if (secret) {
    const revBtn = button('Reveal', () => {
      if (control.tagName === 'INPUT') {
        const hidden = control.type === 'password';
        control.type = hidden ? 'text' : 'password';
        setBtnContent(revBtn, 'Reveal', hidden ? 'eyeSlash' : 'eye');
        revealTimers.push(setTimeout(() => { control.type = 'password'; setBtnContent(revBtn, 'Reveal', 'eye'); }, 15000));
      }
    }, 'subtle small', false, 'eye');
    tools.append(revBtn);
  }
  tools.append(button('Copy', async () => { await api('copy', { value }); toast('Copied. Clipboard clears after 30 seconds.'); }, 'subtle small'));
  append(line, control, tools); append(wrap, el('div', 'read-label', label), line); return wrap;
}
function deleteVaultItem(item) {
  return busy(async () => {
    const res = await api('vault-delete', { id: item.id });
    if (res && res.deleted) {
      state.selected = null;
      state.current = null;
      await reloadItems();
      state.status = await api('status');
      render();
      toast(`Deleted "${item.title || 'item'}" from your vault.`);
    }
  }, 'Deleting from Google Secret Manager...');
}
function parseTags(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    if (raw.length >= 3 && raw.every(x => typeof x === 'string' && x.length <= 1)) raw = raw.join('');
    else return raw.map(x => String(x ?? '').trim()).filter(Boolean);
  }
  let val = String(raw);
  if (val.length >= 5 && val.length % 2 === 1) {
    let oddAllCommas = true;
    for (let i = 1; i < val.length; i += 2) {
      if (val[i] !== ',') { oddAllCommas = false; break; }
    }
    if (oddAllCommas) {
      let joined = '';
      for (let i = 0; i < val.length; i += 2) joined += val[i];
      val = joined;
    }
  }
  return val.split(',').map(s => s.trim()).filter(Boolean);
}
function parseRecoveryCodes(raw) {
  if (!raw) return [];
  const text = Array.isArray(raw) ? raw.join('\n') : String(raw);
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const out = [];
  for (const line of lines) {
    if (/^#|^\/\//.test(line)) continue;
    let used = false;
    let body = line.replace(/^(?:\d+[\.\)]|[-*•])\s+/, '').trim();
    if (/^(\[x\]|\[used\]|✓|✔|used\s*:)/i.test(body)) {
      used = true;
      body = body.replace(/^(\[x\]|\[used\]|✓|✔|used\s*:)\s*/i, '').trim();
    } else if (/^(\[\s*\]|unused\s*:)/i.test(body)) {
      body = body.replace(/^(\[\s*\]|unused\s*:)\s*/i, '').trim();
    } else if (/^~.+~$/.test(body)) {
      used = true;
      body = body.slice(1, -1).trim();
    } else if (/\((used|consumed)\)$/i.test(body)) {
      used = true;
      body = body.replace(/\s*\((used|consumed)\)$/i, '').trim();
    }
    body = body.replace(/^\d+[\.\)]\s+/, '').trim();
    if (!body) continue;
    out.push({ code: body, used });
  }
  return out;
}
function formatRecoveryCodes(entries) {
  if (!Array.isArray(entries)) return '';
  return entries
    .filter(e => e && typeof e.code === 'string' && e.code.trim())
    .map(e => `${e.used ? '[x] ' : ''}${e.code.trim()}`)
    .join('\n');
}
function renderVaultRecoveryOverview() {
  revealTimers.forEach(clearTimeout); revealTimers = [];
  const detail = $('.detail'); if (!detail) return; detail.replaceChildren();
  const top = el('div', 'detail-top'), info = el('div', 'detail-title'), actions = el('div', 'detail-actions');
  const recoveryItems = state.items.filter(i => !i.archived && (i.kind === 'recovery' || i.hasRecoveryCodes));
  const totalCodes = recoveryItems.reduce((sum, i) => sum + (i.recoveryTotal || 0), 0);
  const unusedCodes = recoveryItems.reduce((sum, i) => sum + (i.recoveryRemaining || 0), 0);
  append(info,
    el('h2', '', 'Recovery & Backup Codes'),
    el('span', 'tag ok-tag', `${recoveryItems.length} service set${recoveryItems.length === 1 ? '' : 's'}`),
    totalCodes ? el('span', `tag mono${unusedCodes <= 2 ? ' warn-tag' : ''}`, `${unusedCodes}/${totalCodes} unused codes`) : null
  );
  append(actions,
    button('+ New recovery code set', () => renderEditor({ kind: 'recovery' }), 'primary small', state.offline),
    button('Rotate Vault Spare Key', showRekeyModal, 'subtle small', state.offline)
  );
  append(top, append(el('div', 'item-icon mono'), svgIcon('recovery')), info, actions);
  detail.append(top);

  const spareCard = el('section', 'sgroup env-section');
  const spareHead = el('div', 'sgroup-head');
  append(spareHead,
    append(el('div'), el('h3', '', 'Hidden Door Vault Spare Key (HDV1-…)'), el('span', 'sgroup-hint', 'Emergency vault decryption wrapper')),
    button('Issue new spare key', showRekeyModal, 'small', state.offline)
  );
  append(spareCard,
    spareHead,
    el('p', 'about-text', 'Your vault header wraps the 256-bit AES-GCM vault key twice: once under your master password and once under your offline recovery code (HDV1-…). Either one can independently decrypt your vault or an exported .hdvault backup.'),
    notice('The Vault Spare Key itself is never stored in plaintext inside the vault. If you ever misplace your physical HDV1-… recovery code, click "Issue new spare key" to re-wrap the vault header and generate a fresh recovery code without re-uploading any items.')
  );
  detail.append(spareCard);

  const svcCard = el('section', 'sgroup env-section');
  const svcHead = el('div', 'sgroup-head');
  append(svcHead,
    append(el('div'), el('h3', '', `Saved Service Recovery Codes (${recoveryItems.length})`), el('span', 'sgroup-hint', '2FA backup codes & emergency account keys')),
    button('+ Add service recovery codes', () => renderEditor({ kind: 'recovery' }), 'subtle small', state.offline)
  );
  svcCard.append(svcHead);
  if (!recoveryItems.length) {
    svcCard.append(el('div', 'sgroup-foot', 'Store 2FA backup codes for GitHub, Google, Apple, Cloudflare, Discord, Stripe, AWS or any other account. You can create a standalone Recovery item or attach recovery codes directly inside any Login item.'));
  } else {
    const grid = el('div', 'host-grid');
    for (const item of recoveryItems) {
      const card = el('div', 'host-card');
      const head = el('div', 'host-card-head');
      const low = item.recoveryTotal > 0 && item.recoveryRemaining <= 2;
      const badge = el('span', `tag mono${low ? ' warn-tag' : ' ok-tag'}`, item.recoveryTotal > 0 ? `${item.recoveryRemaining} / ${item.recoveryTotal} unused` : 'Saved');
      append(head, el('strong', '', item.title), badge);
      const meta = el('div', 'host-meta mono');
      append(meta,
        item.username ? el('div', '', `Account: ${item.username}`) : null,
        item.url ? el('div', '', `Website: ${item.url}`) : null,
        el('div', '', `Type: ${item.kind === 'recovery' ? 'Dedicated recovery item' : 'Attached to Login'}`)
      );
      const openBtn = button('Inspect codes →', async () => {
        const itemData = await api('vault-get', { id: item.id });
        state.selected = item.id; state.current = itemData;
        renderList(); renderDetail(itemData);
      }, 'subtle small');
      append(card, head, meta, append(el('div', 'button-row'), openBtn));
      grid.append(card);
    }
    svcCard.append(grid);
  }
  detail.append(svcCard);
}
function renderRecoveryCodesSection(item) {
  const entries = parseRecoveryCodes(item.recoveryCodes);
  if (!entries.length && item.kind !== 'recovery') return null;
  const sec = el('section', 'sgroup env-section recovery-section');
  const head = el('div', 'sgroup-head');
  const total = entries.length;
  const remaining = entries.filter(e => !e.used).length;
  const low = total > 0 && remaining <= 2;
  const titleWrap = el('div');
  const pills = el('div', 'pill-row');
  if (total > 0) {
    append(pills,
      el('span', `tag mono${low ? ' warn-tag' : ' ok-tag'}`, `${remaining} of ${total} unused`),
      total - remaining > 0 ? el('span', 'tag mono', `${total - remaining} used`) : null
    );
  }
  append(titleWrap, el('h3', '', 'Recovery / Backup Codes'), pills);

  let revealed = false;
  const grid = el('div', 'recovery-code-grid');
  const tools = el('div', 'button-row');

  const toggleBtn = button('Reveal codes', () => {
    revealed = !revealed;
    setBtnContent(toggleBtn, revealed ? 'Hide codes' : 'Reveal codes', revealed ? 'eyeSlash' : 'eye');
    paintCodes();
    if (revealed) {
      revealTimers.push(setTimeout(() => {
        revealed = false;
        setBtnContent(toggleBtn, 'Reveal codes', 'eye');
        paintCodes();
      }, 15000));
    }
  }, 'subtle small', !total, 'eye');

  const copyUnusedBtn = button('Copy unused', async () => {
    const unused = entries.filter(e => !e.used).map(e => e.code);
    if (!unused.length) throw new Error('All recovery codes in this set are marked as used.');
    await api('copy', { value: unused.join('\n') });
    toast(`Copied ${unused.length} unused recovery code${unused.length === 1 ? '' : 's'} (clears in 30s).`);
  }, 'subtle small', !remaining, 'copy');

  const downloadBtn = button('Download .txt', () => {
    const lines = [
      `Hidden Door Vault — Recovery Codes`,
      `Title: ${item.title}`,
      item.username ? `Account: ${item.username}` : null,
      item.url ? `Website: ${item.url}` : null,
      `Exported: ${new Date().toISOString()}`,
      `Unused: ${remaining} of ${total}`,
      `----------------------------------------`,
      ...entries.map((e, idx) => `${String(idx + 1).padStart(2, '0')}. [${e.used ? 'USED' : 'OPEN'}] ${e.code}`)
    ].filter(Boolean).join('\n') + '\n';
    const blob = new Blob([lines], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${item.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'recovery'}-codes.txt`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast('Downloaded recovery codes text file.');
  }, 'subtle small', !total, 'download');

  append(tools, toggleBtn, copyUnusedBtn, downloadBtn);
  append(head, titleWrap, tools);
  sec.append(head);

  function maskCode(code) {
    return code.replace(/[A-Za-z0-9]/g, '•');
  }

  function paintCodes() {
    grid.replaceChildren();
    if (!entries.length) {
      grid.append(el('div', 'sgroup-foot', 'No recovery codes entered yet. Click "Edit" above to paste your one-per-line backup codes.'));
      return;
    }
    entries.forEach((entry, idx) => {
      const card = el('div', `recovery-code-card${entry.used ? ' is-used' : ''}`);
      const left = el('div', 'recovery-code-main');
      const idxSpan = el('span', 'recovery-code-idx mono', `#${String(idx + 1).padStart(2, '0')}`);
      const valSpan = el('code', 'recovery-code-val mono', revealed ? entry.code : maskCode(entry.code));
      append(left, idxSpan, valSpan);

      const rowBtns = el('div', 'recovery-code-actions');
      const copyOne = button('Copy', async () => {
        await api('copy', { value: entry.code });
        toast(`Copied code #${idx + 1} (clears in 30s).`);
      }, 'subtle small');
      const markBtn = button(entry.used ? 'Mark unused' : 'Mark used', () => busy(async () => {
        entries[idx].used = !entries[idx].used;
        const updatedRaw = formatRecoveryCodes(entries);
        const saved = await api('vault-save', { item: { ...item, recoveryCodes: updatedRaw } });
        state.current = saved;
        await reloadItems();
        renderList();
        renderDetail(saved);
        toast(entries[idx].used ? `Marked code #${idx + 1} as used.` : `Marked code #${idx + 1} as unused.`);
      }, 'Updating recovery code status...'), `small ${entry.used ? 'subtle' : 'ghost'}`, state.offline);

      append(rowBtns, copyOne, markBtn);
      append(card, left, rowBtns);
      grid.append(card);
    });
  }

  paintCodes();
  sec.append(grid);
  return sec;
}
function renderDetail(item) {
  revealTimers.forEach(clearTimeout); revealTimers = []; const detail = $('.detail'); if (!detail) return; detail.replaceChildren();
  if (item.document) {
    const info = item.documentInfo;
    append(detail, el('h2', '', item.title), el('span', 'tag', 'Encrypted document'));
    if (info) append(detail, readField('Filename', info.filename), readField('Media type', info.mediaType), readField('Size', `${info.size} bytes`), readField('SHA-256', info.sha256));
    detail.append(notice('Open and save this file through a connected document app. Its encrypted manifest cannot be edited as a credential note.'));
    return;
  }
  const top = el('div', 'detail-top'), info = el('div', 'detail-title'), actions = el('div', 'detail-actions');
  append(info, el('h2', '', item.title), el('span', 'tag', names[item.kind]));
  if (item.kind === 'login' && item.passkeyId) info.append(el('span', 'tag ok-tag', 'Passkey'));
  const recEntries = parseRecoveryCodes(item.recoveryCodes);
  if (recEntries.length) {
    const rem = recEntries.filter(e => !e.used).length;
    info.append(el('span', `tag mono${rem <= 2 ? ' warn-tag' : ''}`, `${rem}/${recEntries.length} recovery codes`));
  }
  for (const tag of parseTags(item.tags)) info.append(el('span', 'tag', tag));
  const favBtn = el('button', `button subtle small icon-btn${item.favorite ? ' fav-active' : ''}`);
  favBtn.type = 'button'; favBtn.disabled = state.offline;
  favBtn.setAttribute('aria-label', item.favorite ? 'Unmark favorite' : 'Mark as favorite');
  favBtn.title = item.favorite ? 'Unmark favorite' : 'Mark as favorite';
  favBtn.append(svgIcon(item.favorite ? 'starSolid' : 'favorites', 'fa-svg btn-icon'));
  favBtn.addEventListener('click', () => run(async () => { const saved = await api('vault-save', { item: { ...item, favorite: !item.favorite } }); state.current = saved; await reloadItems(); render(); }));
  append(actions,
    favBtn,
    button('Edit', () => renderEditor(item), 'small', state.offline),
    button('Delete', () => deleteVaultItem(item), 'danger small', state.offline)
  );
  append(top, append(el('div', 'item-icon mono'), svgIcon(item.kind)), info, actions); detail.append(top);
  if (item.archived) detail.append(notice('This item is archived. Its cloud versions and encrypted backup copies are not deleted.'));
  if (item.kind === 'card') {
    const card = el('div', 'card-preview'); append(card, el('div', 'card-bank', cardBrand(item.number.replace(/\D/g, ''))), el('div', 'card-digits mono', `\u2022\u2022\u2022\u2022  \u2022\u2022\u2022\u2022  ${item.number.replace(/\D/g, '').slice(-4) || '\u2014'}`), append(el('div', 'card-bottom'), el('span', '', item.holder || 'CARDHOLDER'), el('span', '', item.expiry || 'MM / YY'))); detail.append(card);
  }
  const fields = el('div', 'field-group');
  if (item.kind === 'login') {
    append(fields, readField('Username / email', item.username), readField('Password', item.password, true), readField('Website', item.url), readField('TOTP secret (base32 or otpauth://)', item.totpSecret, true));
    if (item.passkeyId) {
      append(fields,
        readField('Passkey Relying Party', item.passkeyRpName ? `${item.passkeyRpName} (${item.passkeyRpId})` : item.passkeyRpId),
        readField('Passkey Username', item.passkeyUserName),
        readField('Passkey Credential ID', item.passkeyId, false, true),
        readField('Passkey Algorithm', `${item.passkeyAlgorithm || 'ES256'} · ${item.passkeySignCount || 0} signatures`, false, true)
      );
    }
  }
  if (item.kind === 'recovery') {
    append(fields, readField('Account / email', item.username), readField('Service website', item.url));
  }
  if (item.kind === 'card') append(fields, readField('Cardholder', item.holder), readField('Card number', item.number, true), readField('Expiry', item.expiry), readField('Security code', item.securityCode, true));
  if (item.kind === 'ssh') append(fields, readField('Public key', item.publicKey, false, true), readField('Private key', item.privateKey, true), readField('Fingerprint', item.fingerprint));
  if (item.kind === 'api') append(fields, readField('Account / identifier', item.username), readField('Token / secret', item.token, true), readField('Service URL', item.url));
  append(fields, readField('Notes', item.notes, false, true)); if (fields.childNodes.length) detail.append(fields);
  const recoverySection = renderRecoveryCodesSection(item);
  if (recoverySection) detail.append(recoverySection);
  const row = el('div', 'button-row');
  if (item.url) row.append(button('Open website', () => api('open-website', { id: item.id }), 'small'));
  if (item.totpSecret) {
    const code = el('span', 'mono muted'); row.append(button('Show one-time code', async () => { const result = await api('totp', { id: item.id }); code.textContent = `${result.value} / ${result.remaining}s remaining`; revealTimers.push(setTimeout(() => { code.textContent = ''; }, result.remaining * 1000)); }, 'small')); row.append(code);
  }
  if (item.kind === 'ssh') row.append(button('Export private key', () => api('ssh-export', { id: item.id }), 'small'));
  row.append(button(item.archived ? 'Restore from archive' : 'Archive item', async () => { const saved = await api('vault-archive', { id: item.id, archived: !item.archived }); state.current = saved; await reloadItems(); render(); toast(saved.archived ? 'Item archived. Cloud versions are retained.' : 'Item restored.'); }, 'subtle small', state.offline));
  row.append(button('Delete permanently', () => deleteVaultItem(item), 'danger small', state.offline));
  detail.append(row);
  const updated = new Date(item.updatedAt); append(detail, el('div', 'detail-foot', `Last updated ${Number.isNaN(updated.getTime()) ? 'unknown' : updated.toLocaleString()}\nEncrypted with AES-256-GCM before upload. Secret fields remain masked until revealed.`));
}
const KIND_META = { login: ['Login', 'Website or app sign-in'], card: ['Card', 'Personal payment card'], ssh: ['SSH key', 'Ed25519 key pair'], api: ['API', 'Token or secret'], recovery: ['Recovery', '2FA backup & recovery codes'], note: ['Note', 'Encrypted free text'] };
function cardBrand(digits) {
  if (/^4/.test(digits)) return 'VISA'; if (/^(5[1-5]|2[2-7])/.test(digits)) return 'MASTERCARD'; if (/^3[47]/.test(digits)) return 'AMERICAN EXPRESS'; if (/^6(011|5)/.test(digits)) return 'DISCOVER'; return 'PAYMENT CARD';
}
function luhn(digits) { if (digits.length < 12) return false; let sum = 0, alt = false; for (let i = digits.length - 1; i >= 0; i--) { let d = Number(digits[i]); if (alt) { d *= 2; if (d > 9) d -= 9; } sum += d; alt = !alt; } return sum % 10 === 0; }
function groupDigits(digits) { return digits.length && /^3[47]/.test(digits) ? digits.replace(/^(\d{1,4})(\d{1,6})?(\d{1,5})?.*/, (_, a, b, c) => [a, b, c].filter(Boolean).join(' ')) : digits.replace(/(\d{4})(?=\d)/g, '$1 ').trim(); }
function strengthOf(value) {
  if (!value) return { bits: 0, level: 0, label: 'Nothing yet' };
  let alphabet = 0; if (/[a-z]/.test(value)) alphabet += 26; if (/[A-Z]/.test(value)) alphabet += 26; if (/\d/.test(value)) alphabet += 10; if (/[^A-Za-z0-9]/.test(value)) alphabet += 33;
  const bits = Math.floor(value.length * Math.log2(alphabet || 1)), level = bits < 40 ? 1 : bits < 64 ? 2 : bits < 90 ? 3 : 4;
  return { bits, level, label: ['', 'Weak', 'Fair', 'Strong', 'Excellent'][level] };
}
function secretField(name, label, existing, controls, placeholder = '', mono = true) {
  const sw = secretInput(placeholder, 'off'); sw.control.value = existing[name] || ''; if (mono) sw.control.classList.add('mono'); controls[name] = sw.control; return { node: field(label, sw.wrap), control: sw.control, wrap: sw.wrap };
}
function panel(title, hint) { const n = el('section', 'edit-panel'); const head = el('div', 'edit-panel-head'); append(head, el('h3', '', title), hint ? el('span', 'edit-panel-hint', hint) : null); n.append(head); return n; }
const PASSKEY_KEYS = ['passkeyId', 'passkeyRpId', 'passkeyRpName', 'passkeyUserHandle', 'passkeyUserName', 'passkeyAlgorithm', 'passkeyPrivateKey', 'passkeyPublicKey', 'passkeySignCount', 'passkeyCreatedAt'];
function renderEditor(existing = {}) {
  if (existing.document) { toast('Document manifests are read-only here. Use a connected document app.'); return; }
  state.current = null;
  if (!$('.detail')) { state.mode = 'browse'; render(); }
  const detail = $('.detail'); detail.replaceChildren();
  append(detail, append(el('div', 'editor-header'), append(el('div'), el('div', 'eyebrow', existing.id ? 'EDITING' : 'NEW ITEM'), el('h2', '', existing.id ? 'Edit credential' : 'New credential')), button('Cancel', () => { state.current = existing.id ? existing : null; render(); }, 'subtle small')));
  const kinds = ['login', 'card', 'ssh', 'api', 'recovery', 'note']; let kindValue = existing.kind || (kinds.includes(state.filter) ? state.filter : 'login');
  const picker = el('div', 'kind-picker'); picker.setAttribute('role', 'radiogroup'); picker.setAttribute('aria-label', 'Type');
  const kindButtons = {};
  for (const k of kinds) { const b = el('button', 'kind-option'); b.type = 'button'; b.setAttribute('role', 'radio'); append(b, append(el('span', 'kind-glyph'), svgIcon(k)), append(el('span', 'kind-text'), el('strong', '', KIND_META[k][0]), el('small', '', KIND_META[k][1]))); b.addEventListener('click', () => { kindValue = k; syncKind(); buildFields(); }); kindButtons[k] = b; picker.append(b); }
  function syncKind() { for (const [k, b] of Object.entries(kindButtons)) { b.classList.toggle('active', k === kindValue); b.setAttribute('aria-checked', String(k === kindValue)); } }
  if (existing.id) picker.classList.add('locked');
  const title = input(existing.title || '', 'text', 'Give this item a name'), tags = input(parseTags(existing.tags).join(', '), 'text', 'work, personal, infrastructure'), favorite = checkbox('Mark as favorite', existing.favorite);
  const identity = panel('Identity', 'How it appears in your vault'); append(identity, field('Title', title));
  const dynamic = el('div', 'edit-dynamic'), controls = {};
  const passkeyState = {}; for (const k of PASSKEY_KEYS) if (existing[k] !== undefined) passkeyState[k] = existing[k];
  function add(name, label, type = 'text', placeholder = '', target = dynamic) {
    const n = type === 'textarea' ? el('textarea', 'input mono') : input('', type, placeholder); n.value = existing[name] || ''; n.autocomplete = 'off'; n.spellcheck = false; controls[name] = n; target.append(field(label, n)); return n;
  }
  function buildFields() {
    dynamic.replaceChildren(); for (const key of Object.keys(controls)) delete controls[key];
    if (kindValue === 'login') {
      const who = panel('Sign-in', 'What you type at the door'); dynamic.append(who);
      add('username', 'Username / email', 'text', 'you@example.com', who);
      const pw = secretField('password', 'Password', existing, controls, '', true); who.append(pw.node);
      const meter = el('div', 'strength'); const bars = Array.from({ length: 4 }, () => el('i')); const meterText = el('span', 'strength-text'); append(meter, append(el('div', 'strength-bars'), ...bars), meterText);
      const updateMeter = () => { const st = strengthOf(pw.control.value); meter.dataset.level = String(st.level); bars.forEach((b, i) => b.classList.toggle('on', i < st.level)); meterText.textContent = st.bits ? `${st.label} · ~${st.bits} bits` : st.label; };
      pw.control.addEventListener('input', updateMeter); updateMeter();
      const gen = button('Generate 32 characters', async () => { const result = await api('generate-password', { length: 32 }); pw.control.value = result.value; pw.control.type = 'text'; setBtnContent(pw.wrap.querySelector('.secret-toggle'), 'Hide', 'eyeSlash'); updateMeter(); toast(`Generated with ${result.bits} bits of search-space entropy.`); }, 'small ghost');
      append(who, append(el('div', 'field-foot'), meter, gen));
      const where = panel('Where', 'Website, 2FA and recovery codes'); dynamic.append(where);
      add('url', 'Website', 'url', 'https://', where);
      const totp = secretField('totpSecret', 'TOTP secret (base32 or otpauth://, optional)', existing, controls, 'JBSWY3DPEHPK3PXP or otpauth://totp/…', true); where.append(totp.node);
      where.append(el('div', 'hint', 'Supports base32 (SHA-1 · 6 digits · 30s) or otpauth://totp/ URIs with SHA-1/256/512, 6 or 8 digits, and custom period.'));
      const recArea = add('recoveryCodes', 'Recovery / backup codes (optional, one per line)', 'textarea', 'xxxx-xxxx-xxxx\nyyyy-yyyy-yyyy', where);
      recArea.rows = 4;
      where.append(el('div', 'hint', 'Logins with recovery codes also appear in the dedicated Recovery codes section in the sidebar.'));
      if (passkeyState.passkeyId) {
        const pk = panel('Passkey', 'WebAuthn credential attached to this login'); dynamic.append(pk);
        pk.append(el('div', 'hint', `Relying party: ${passkeyState.passkeyRpId} · ID: ${passkeyState.passkeyId.slice(0, 18)}… (${passkeyState.passkeyAlgorithm || 'ES256'})`));
        pk.append(button('Remove passkey from login', () => { for (const k of PASSKEY_KEYS) passkeyState[k] = k === 'passkeySignCount' ? 0 : ''; pk.remove(); toast('Passkey will be removed when you save.'); }, 'small subtle'));
      }
    }
    if (kindValue === 'recovery') {
      const svc = panel('Account & service', 'Where these backup codes belong'); dynamic.append(svc);
      add('username', 'Account / email (optional)', 'text', 'you@example.com', svc);
      add('url', 'Service website (optional)', 'url', 'https://', svc);
      const codesPanel = panel('Recovery / backup codes', 'One code per line · prefix with [x] when used'); dynamic.append(codesPanel);
      const recArea = add('recoveryCodes', 'Recovery codes', 'textarea', 'abcd-efgh-ijkl\nmnop-qrst-uvwx\n[x] 1234-5678-9012', codesPanel);
      recArea.rows = 8;
      const genBackupBtn = button('Generate 10 random backup codes', async () => {
        const generatedCodes = [];
        for (let i = 0; i < 10; i++) {
          const r = await api('generate-password', { length: 12, upper: true, lower: false, digits: true, symbols: false, avoidAmbiguous: true });
          const raw = r.value.toUpperCase();
          generatedCodes.push(`${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`);
        }
        recArea.value = generatedCodes.join('\n');
        toast('Generated 10 high-entropy backup codes.');
      }, 'small ghost');
      append(codesPanel, genBackupBtn, el('div', 'hint', 'Paste the emergency 2FA backup codes given by a service, or generate a set for your own infrastructure. You can mark individual codes as used with one click in the detail view.'));
    }
    if (kindValue === 'card') {
      const stage = el('div', 'card-stage'); dynamic.append(stage);
      const preview = el('div', 'card-preview live'); const brand = el('div', 'card-bank', 'PAYMENT CARD'), digits = el('div', 'card-digits mono', '••••  ••••  ••••  ••••'), holderLine = el('span', '', 'CARDHOLDER'), expLine = el('span', '', 'MM / YY'), chip = el('div', 'card-chip'), valid = el('div', 'card-valid');
      append(preview, append(el('div', 'card-top'), brand, chip), digits, append(el('div', 'card-bottom'), holderLine, expLine), valid); stage.append(preview);
      const form = panel('Card details', `Encrypted before it leaves ${DEVICE}`); stage.append(form);
      const holder = add('holder', 'Cardholder', 'text', 'Name as printed', form); holder.autocapitalize = 'characters';
      const num = secretField('number', 'Card number', existing, controls, '0000 0000 0000 0000', true); form.append(num.node); num.control.inputMode = 'numeric';
      const row = el('div', 'edit-row'); form.append(row);
      const exp = add('expiry', 'Expiry', 'text', 'MM / YY', row); exp.classList.add('mono'); exp.inputMode = 'numeric';
      const cvc = secretField('securityCode', 'Security code', existing, controls, '•••', true); row.append(cvc.node); cvc.control.inputMode = 'numeric'; cvc.control.maxLength = 4;
      const paint = () => {
        const raw = num.control.value.replace(/\D/g, '').slice(0, 19); const grouped = groupDigits(raw); if (num.control.value !== grouped) num.control.value = grouped;
        brand.textContent = cardBrand(raw); preview.dataset.brand = cardBrand(raw).split(' ')[0].toLowerCase();
        digits.textContent = raw ? groupDigits(raw).split(' ').map((g, i, a) => i < a.length - 1 ? '•'.repeat(g.length) : g).join('  ') : '••••  ••••  ••••  ••••';
        holderLine.textContent = (holder.value || 'CARDHOLDER').toUpperCase();
        let e = exp.value.replace(/[^\d]/g, '').slice(0, 4); if (e.length > 2) e = `${e.slice(0, 2)} / ${e.slice(2)}`; if (exp.value && exp.value !== e && !exp.value.endsWith('/') ) exp.value = e; expLine.textContent = e || 'MM / YY';
        valid.textContent = raw.length >= 12 ? (luhn(raw) ? '✓ Number checks out' : 'Number does not check out yet') : ''; valid.classList.toggle('ok', luhn(raw));
      };
      for (const c of [num.control, holder, exp]) c.addEventListener('input', paint); paint();
      form.append(el('div', 'hint', 'Personal storage only. Not a PCI-compliant merchant system.'));
    }
    if (kindValue === 'ssh') {
      const keys = panel('Key pair', 'OpenSSH Ed25519'); dynamic.append(keys);
      add('publicKey', 'Public key', 'textarea', '', keys); add('privateKey', 'Private key', 'textarea', '', keys); add('fingerprint', 'Fingerprint', 'text', 'SHA256:…', keys);
      keys.append(button('Generate Ed25519 key pair', async () => { const pair = await api('generate-ssh', { comment: 'hidden-door-vault' }); for (const key of ['publicKey', 'privateKey', 'fingerprint']) controls[key].value = pair[key]; toast('New Ed25519 key pair generated. Save it to encrypt it into your vault.'); }, 'small ghost'));
      keys.append(el('div', 'hint', 'Generated private keys are encrypted by the vault, and served automatically over the local SSH_AUTH_SOCK agent while unlocked.'));
    }
    if (kindValue === 'api') {
      const svc = panel('Service', 'Account and endpoint'); dynamic.append(svc); add('username', 'Account / identifier', 'text', '', svc); add('url', 'Service URL', 'url', 'https://', svc);
      const sec = panel('Secret', 'Token, key or secret'); dynamic.append(sec); const tok = secretField('token', 'Token / secret', existing, controls, '', true); sec.append(tok.node);
      sec.append(button('Generate 256-bit random token', async () => { tok.control.value = (await api('generate-token')).value; tok.control.type = 'text'; setBtnContent(tok.wrap.querySelector('.secret-toggle'), 'Hide', 'eyeSlash'); }, 'small ghost'));
    }
    const notes = panel('Secure notes', kindValue === 'note' ? 'Everything here is encrypted' : 'Optional'); dynamic.append(notes); add('notes', 'Secure notes', 'textarea', '', notes);
  }
  syncKind(); buildFields();
  const org = panel('Organize', 'Tags and favorites'); append(org, field('Tags (comma-separated)', tags), favorite.label);
  append(detail, picker, identity, dynamic, org);
  const save = button('Save encrypted item', () => busy(async () => {
    const values = { ...(existing.id ? { id: existing.id } : {}), kind: kindValue, title: title.value, tags: tags.value, favorite: favorite.input.checked, archived: existing.archived || false, ...(kindValue === 'login' ? passkeyState : {}) };
    for (const [key, control] of Object.entries(controls)) values[key] = key === 'number' ? control.value.replace(/\D/g, '') : control.value;
    const saved = await api('vault-save', { item: values }); state.selected = saved.id; state.current = saved; await reloadItems(); state.status = await api('status'); render(); toast('Encrypted and saved to Google Secret Manager.');
  }, 'Encrypting and saving...'), 'primary', state.offline);
  const footerActions = el('div', 'button-row');
  if (existing.id) footerActions.append(button('Delete permanently', () => deleteVaultItem(existing), 'danger', state.offline));
  footerActions.append(save);
  append(detail, append(el('div', 'editor-footer sticky'), el('span', 'footer-note', state.offline ? 'Offline snapshot is read-only.' : `Encrypted on ${DEVICE}, then stored as a new secret version.`), footerActions)); title.focus();
}
function renderGenerator() {
  header('Generator'); const content = el('div', 'content'); $('#main').append(content);
  append(content, append(el('div', 'section-header'), el('h2', '', 'Strong by construction.'), el('p', '', 'Cryptographic randomness, generated on this device. No third-party password API. No passwords sent to a generator service.')));
  const tabs = el('div', 'generator-tabs');
  for (const [key, name, icon] of [['password', 'Password', 'login'], ['token', 'Random token', 'api'], ['ssh', 'SSH key', 'ssh'], ['passkey', 'About passkeys', 'shieldCheck']]) {
    const b = el('button', state.genTab === key ? 'active' : ''); b.type = 'button';
    append(b, svgIcon(icon, 'fa-svg tab-icon'), el('span', '', name));
    b.addEventListener('click', () => { state.genTab = key; render(); }); tabs.append(b);
  }
  content.append(tabs);
  if (state.genTab === 'passkey') {
    const grid = el('div', 'section-grid'), main = el('div', 'panel'), aside = el('div', 'panel');
    append(main, el('h2', '', 'Passkeys are not long passwords.'), el('p', '', 'A passkey is an origin-bound key pair (ES256 P-256 or EdDSA Ed25519) created during a WebAuthn registration ceremony. Websites normally trigger registration automatically through the Hidden Door Vault Chromium extension, or you can pre-create a passkey credential here.'));
    const rpId = input('', 'text', 'github.com'), userName = input('', 'text', 'you@example.com'), alg = el('select', 'input');
    for (const [v, label] of [['ES256', 'ES256 (ECDSA P-256 · WebAuthn default)'], ['EdDSA', 'EdDSA (Ed25519)']]) { const o = el('option', '', label); o.value = v; alg.append(o); }
    const out = el('pre', 'code-block', 'Passkey credential ID and COSE metadata will appear here.');
    append(main, field('Relying party domain (RP ID)', rpId), field('Account username / email', userName), field('Algorithm', alg), out,
      append(el('div', 'button-row'), button('Create & save passkey in vault', () => busy(async () => {
        if (!rpId.value.trim()) throw new Error('Enter a relying party domain (for example, github.com).');
        const created = await api('passkey-create', { rpId: rpId.value.trim(), rpName: rpId.value.trim(), userName: userName.value.trim() || 'user', algorithm: alg.value });
        out.textContent = `Credential ID: ${created.credentialId}\nRP ID: ${created.rpId}\nAlgorithm: ${created.algorithm}`;
        await reloadItems(); state.status = await api('status'); toast('Passkey encrypted and saved to your vault.');
      }, 'Creating passkey...'), 'primary', state.offline)));
    append(aside, el('h3', '', 'Browser WebAuthn ceremony.'), el('p', '', 'When the Chromium extension is installed, navigator.credentials.create() and navigator.credentials.get() on websites talk directly to Hidden Door Vault over Native Messaging.'), notice('Install the Native Messaging host from Settings -> CLI, SSH Agent & Browser, then load the extension folder in Chrome, Brave, Arc or Edge.'));
    append(grid, main, aside); content.append(grid); return;
  }
  const grid = el('div', 'section-grid'), main = el('div', 'panel'), aside = el('div', 'panel');
  if (state.genTab === 'password') {
    append(main, el('h3', '', 'Password recipe')); const range = input('32', 'range'); range.min = 16; range.max = 128; const output = el('output', '', '32');
    range.addEventListener('input', () => output.textContent = range.value); append(main, field('Length', append(el('div', 'range-row'), range, output)));
    const checks = {}; const checkGrid = el('div', 'check-grid'); for (const [k, text] of [['upper', 'Uppercase A-Z'], ['lower', 'Lowercase a-z'], ['digits', 'Numbers 0-9'], ['symbols', 'Symbols']]) { checks[k] = checkbox(text, true); checkGrid.append(checks[k].label); }
    const ambiguous = checkbox('Avoid similar-looking characters'); append(main, checkGrid, ambiguous.label);
    const generated = el('div', 'generator-output', 'Ready when you are.'), entropy = el('div', 'entropy', 'Operating-system-backed CSPRNG'); let value = '';
    const generate = async () => { const settings = { length: Number(range.value), avoidAmbiguous: ambiguous.input.checked }; for (const [key, check] of Object.entries(checks)) settings[key] = check.input.checked; const result = await api('generate-password', settings); value = result.value; generated.textContent = value; entropy.textContent = `${result.bits} bits of generated search-space entropy`; };
    append(main, generated, entropy, append(el('div', 'button-row'), button('Generate password', generate, 'primary'), button('Copy', async () => { if (!value) throw new Error('Generate a password first.'); await api('copy', { value }); toast('Copied for 30 seconds.'); })), el('div', 'divider'), button('Use in a new login', () => { if (!value) throw new Error('Generate a password first.'); renderEditor({ kind: 'login', password: value }); }, 'wide', state.offline));
    append(aside, el('h3', '', 'Encryption is a separate layer.'), el('p', '', 'Randomness makes the password hard to guess. AES-256-GCM encrypts saved credentials and detects tampering. scrypt derives a wrapping key from your master password.'), notice('There is no meaningful "military-grade password" setting. This app names the algorithms it uses; it does not claim FIPS validation, government certification or an independent security audit.'), el('p', '', 'Use a different password for every account. A generated password is not saved until you add it to an item.'));
  } else if (state.genTab === 'token') {
    append(main, el('h3', '', 'Random secret material')); const bytes = el('select', 'input'), format = el('select', 'input'); for (const n of [32, 48, 64]) { const o = el('option', '', `${n * 8} bits / ${n} bytes`); o.value = n; bytes.append(o); } for (const f of ['base64url', 'hex']) { const o = el('option', '', f); o.value = f; format.append(o); }
    append(main, field('Entropy', bytes), field('Encoding', format)); const result = el('div', 'generator-output', 'Random, not registered.'); let value = '';
    append(main, result, append(el('div', 'button-row'), button('Generate token', async () => { const t = await api('generate-token', { bytes: Number(bytes.value), format: format.value }); value = t.value; result.textContent = value; }, 'primary'), button('Copy', async () => { await api('copy', { value }); toast('Copied for 30 seconds.'); })), el('div', 'divider'), button('Save as an API credential', () => { if (!value) throw new Error('Generate a token first.'); renderEditor({ kind: 'api', token: value }); }, 'wide', state.offline));
    append(aside, el('h3', '', 'A secret is not an account.'), el('p', '', 'These values are suitable as random secret material when a system accepts a user-defined secret. Generating one does not create an API key in Google, Stripe or any other service.'), notice('Random tokens are not passkeys. A service must be configured to recognize a token before it can authenticate anything.'));
  } else {
    append(main, el('h3', '', 'Ed25519 key pair')); const comment = input('hidden-door-vault', 'text', 'Key comment'), publicKey = el('pre', 'code-block', 'Your public key will appear here.'); let pair;
    append(main, field('Comment', comment), publicKey, append(el('div', 'button-row'), button('Generate key pair', async () => { pair = await api('generate-ssh', { comment: comment.value }); publicKey.textContent = `${pair.publicKey}\n\n${pair.fingerprint}`; }, 'primary'), button('Copy public key', async () => { if (!pair) throw new Error('Generate a key first.'); await api('copy', { value: pair.publicKey }); toast('Public key copied.'); })), el('div', 'divider'), button('Save key pair in vault', () => { if (!pair) throw new Error('Generate a key first.'); renderEditor({ kind: 'ssh', ...pair }); }, 'wide', state.offline));
    append(aside, el('h3', '', 'Private means private.'), el('p', '', 'The private key is not shown on this screen. Saving it creates an encrypted vault item. Its public half is designed to be installed on the services you control.'), notice('Exported generated private-key files have no passphrase. Export requires confirmation and uses owner-only file permissions. Add a passphrase with ssh-keygen -p.', 'warning'), el('p', '', 'Saved Ed25519 keys are automatically served over the built-in local SSH_AUTH_SOCK agent while your vault is unlocked.'));
  }
  append(grid, main, aside); content.append(grid);
}
function switchRow(label, description, checked, onChange, disabled = false, name = label) {
  const row = el('div', 'srow'); const text = el('div', 'srow-text'); append(text, el('div', 'srow-label', label), description ? (typeof description === 'string' ? el('div', 'srow-desc', description) : description) : null);
  const sw = el('button', `switch${checked ? ' on' : ''}`); sw.type = 'button'; sw.setAttribute('role', 'switch'); sw.setAttribute('aria-checked', String(checked)); sw.setAttribute('aria-label', name); sw.disabled = disabled; sw.append(el('span', 'knob'));
  sw.addEventListener('click', () => run(() => onChange(sw.getAttribute('aria-checked') !== 'true')));
  append(row, text, sw); return row;
}
function actionRow(label, description, control) {
  const row = el('div', 'srow'); const text = el('div', 'srow-text');
  append(text, el('div', 'srow-label', label), description ? (typeof description === 'string' ? el('div', 'srow-desc', description) : description) : null);
  append(row, text, control); return row;
}
function codePill(prefix, codeText, copyValue = null) {
  const pill = el('span', 'code-pill');
  if (prefix) pill.append(el('span', 'code-pill-label', prefix));
  pill.append(el('code', 'code-pill-val', codeText));
  if (copyValue) {
    const copyBtn = el('button', 'code-pill-copy', 'Copy'); copyBtn.type = 'button';
    copyBtn.addEventListener('click', e => { e.stopPropagation(); run(async () => { await api('copy', { value: copyValue }); toast(`Copied ${prefix || 'value'} to clipboard.`); }); });
    pill.append(copyBtn);
  }
  return pill;
}
function group(title, hint) { const g = el('section', 'sgroup'); const head = el('div', 'sgroup-head'); append(head, el('h3', '', title), hint ? el('span', 'sgroup-hint', hint) : null); g.append(head); return g; }
function renderSettings() {
  header('Settings & backup'); const content = el('div', 'content settings'), st = state.status, locked = !st.unlocked;
  const topBar = el('div', 'settings-topbar');
  const tabs = el('div', 'settings-tabs'); tabs.setAttribute('role', 'tablist');
  const tabDefs = [
    ['security', 'Security', 'shieldCheck'],
    ['cloud', 'Cloud & Billing', 'globe'],
    ['integrations', 'Integrations', 'ssh'],
    ['backup', 'Backup & Import', 'archive'],
    ['about', 'About', 'note']
  ];
  for (const [key, label, icon] of tabDefs) {
    const b = el('button', `settings-tab${state.settingsTab === key ? ' active' : ''}`);
    b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(state.settingsTab === key));
    append(b, svgIcon(icon, 'fa-svg tab-icon'), el('span', '', label));
    b.addEventListener('click', () => { state.settingsTab = key; render(); });
    tabs.append(b);
  }
  const strip = el('div', 'status-strip compact');
  const chip = (label, value, tone = '') => { const c = el('div', `status-chip ${tone}`); append(c, el('span', 'status-label', label), el('span', 'status-value', value)); return c; };
  append(strip,
    chip('Vault', `${st.settings.vault || 'personal'}${st.unlocked ? (st.offline ? ' · offline' : ' · open') : ' · locked'}`, st.unlocked ? 'ok' : ''),
    chip('Google', st.signedIn ? st.email : (st.oauthConfigured ? 'not signed in' : 'no client'), st.signedIn ? 'ok' : 'warn'),
    chip('Pruning', st.settings.pruneKeep ? `keep ${st.settings.pruneKeep}` : 'off', st.prune?.denied ? 'warn' : (st.settings.pruneKeep ? 'ok' : '')));
  append(topBar, tabs, strip);
  content.append(topBar);

  const stage = el('div', 'settings-stage');
  content.append(stage);

  if (state.settingsTab === 'security') {
    const sec = group('Device security & session lock', IS_MAC ? 'This Mac' : 'This computer');
    if (st.biometric && !st.biometric.available) {
      sec.append(actionRow(bioLabel(), st.biometric.reason || `${OS_NAME} did not report a usable biometric sensor.`, button('Check again', () => busy(async () => { state.status = await api('status'); render(); }), 'small')));
    } else if (st.biometric?.available) {
      sec.append(switchRow(`${bioLabel()} unlock`, st.biometric.enabled ? `Enabled on ${DEVICE}. Uses the same OS-protected storage class as the Google sign-in token.` : (locked ? 'Unlock online first, then enable.' : `Skip typing the master password on ${DEVICE}.`), st.biometric.enabled, async next => { const r = await api(next ? 'biometric-enable' : 'biometric-disable'); if (!r.cancelled) { state.status = await api('status'); render(); toast(r.enabled ? `${bioLabel()} unlock enabled.` : `${bioLabel()} unlock disabled.`); } }, !st.biometric.enabled && (locked || st.offline), st.biometric.enabled ? `Disable ${bioLabel()} unlock` : `Enable ${bioLabel()} unlock`));
    }
    const idle = el('select', 'input compact'); idle.setAttribute('aria-label', 'Auto-lock after inactivity');
    for (const [v, label] of [[60, '1 minute'], [180, '3 minutes'], [300, '5 minutes'], [600, '10 minutes'], [900, '15 minutes'], [1800, '30 minutes']]) { const o = el('option', '', label); o.value = v; idle.append(o); }
    idle.value = st.settings.idleSeconds || 300;
    idle.addEventListener('change', () => run(async () => { state.status = await api('configure', { project: state.status.settings.project, vault: state.status.settings.vault, idleSeconds: Number(idle.value), idleOnly: true }); toast('Auto-lock updated.'); render(); }));
    sec.append(actionRow('Auto-lock after inactivity', `Also locks automatically when ${IS_MAC ? 'macOS' : 'the computer'} sleeps or the screen locks.`, idle));
    sec.append(switchRow('Lock when window is hidden', 'Immediately locks the vault whenever the Hidden Door Vault window is closed or hidden.', st.settings.lockOnHide === true, async next => { state.status = await api('configure', { project: state.status.settings.project, vault: state.status.settings.vault, idleSeconds: state.status.settings.idleSeconds || 300, lockOnHide: next, idleOnly: true }); render(); toast(next ? 'Will lock when window is hidden.' : 'Will remain unlocked when hidden until idle timeout.'); }));
    sec.append(switchRow('Launch at login', st.packaged ? (IS_MAC ? 'Starts quietly in the macOS menu bar when you log in.' : 'Starts quietly in the system tray when you log in (XDG autostart entry in ~/.config/autostart).') : 'Available when running from the packaged app.', st.startup, async next => { await api('set-startup', { enabled: next }); state.status = await api('status'); const sw = sec.querySelector('[aria-label="Launch at login"]'); sw.classList.toggle('on', state.status.startup); sw.setAttribute('aria-checked', String(state.status.startup)); toast(state.status.startup ? 'Will launch at login.' : 'Will not launch at login.'); }, !st.packaged));
    sec.append(actionRow('Master password', 'Re-wraps the vault key under a new master password and issues a fresh recovery code without re-uploading items.', button('Change master password', showRekeyModal, 'small', locked || st.offline)));
    if (st.unlocked) sec.append(actionRow('Lock vault now', 'Immediately drops decrypted keys from memory and clears copied secrets from the clipboard.', button('Lock vault', async () => { await api('vault-lock'); }, 'small')));
    stage.append(sec);
  }

  if (state.settingsTab === 'cloud') {
    const attachments = group('Encrypted file attachments', 'Google Cloud Storage');
    const bucket = input(st.settings.attachmentBucket || '', 'text', 'your-attachment-bucket'); bucket.disabled = !locked;
    append(attachments, field('Attachment bucket', bucket), el('p', 'hint', 'Use an existing bucket with object read/create access for your Google account. This app does not create buckets or grant permissions. Lock the vault to change this setting.'), button('Save attachment bucket', () => busy(async () => { state.status = await api('configure', { attachmentBucket: bucket.value.trim(), idleOnly: true }); render(); toast('Attachment bucket saved.'); }), 'small', !locked), notice('Vault backups contain encrypted file references and keys, not attachment bytes. Keep the referenced GCS bucket and object generations. Existing files retain their original bucket references when this setting changes.'));
    stage.append(attachments);
    if (st.unlocked) {
      const c = st.cost || {};
      const costCard = el('section', 'sgroup cost-card');
      const costHead = el('div', 'cost-card-head');
      const costTitleWrap = el('div');
      append(costTitleWrap,
        el('div', 'eyebrow', 'SECRET MANAGER BILLING ESTIMATE'),
        el('h3', 'cost-headline', c.known ? `Estimated cost ≈ ${money(c.monthly)} per month` : 'Estimated cost · counting versions…'));
      costHead.append(costTitleWrap, button('Recount now', () => busy(async () => { state.status = { ...state.status, cost: await api('cost-recount') }; render(); toast('Secret Manager versions counted.'); }, 'Counting versions in Google...'), 'small', st.offline));
      costCard.append(costHead);
      if (c.known) {
        const metrics = el('div', 'cost-metrics');
        const metric = (val, lbl, sub = '') => { const m = el('div', 'cost-metric'); append(m, el('b', '', String(val)), el('span', '', lbl), sub ? el('small', '', sub) : null); return m; };
        append(metrics,
          metric(c.secrets, 'Active secrets', 'items + vault header'),
          metric(c.billable, 'Billable versions', `after ${c.freeVersions} free`),
          metric(money(c.pricePerVersion), 'Per version / mo', 'GCP list rate'),
          metric(c.savesSince ? `+${c.savesSince}` : (c.pending || 0), c.savesSince ? 'Saves since count' : 'Pending destroy', c.savesSince ? 'recount to update' : 'in grace window'));
        costCard.append(metrics);
        costCard.append(el('div', 'sgroup-foot', `Counted ${new Date(c.at).toLocaleString()}. Estimate from version counts, not a billing invoice; API access calls and tax are not included.`));
      } else {
        costCard.append(el('div', 'sgroup-foot', 'Not counted yet. Version counting runs automatically in the background after an online unlock.'));
      }
      stage.append(costCard);
    }

    const pruneChip = strip.querySelector('.status-chip:last-child');
    function buildPruneGroup() {
      const st = state.status, pr = group('Version history', 'Secret Manager billing');
      const keepNow = st.settings.pruneKeep || 0, graceNow = st.settings.pruneGraceHours || 72;
      const setPrune = async (keep, graceHours) => {
        state.status = await api('prune-config', { keep, graceHours });
        pruneChip.className = `status-chip ${state.status.prune?.denied ? 'warn' : (keep ? 'ok' : '')}`; pruneChip.querySelector('.status-value').textContent = keep ? `keep ${keep}` : 'off';
        pr.replaceWith(buildPruneGroup()); toast(keep ? `Keeping the newest ${keep} versions of each secret.` : 'Version pruning is off.');
      };
      pr.append(switchRow('Keep only recent versions', keepNow ? 'After every edit, older versions of that secret are automatically scheduled for destruction.' : 'Every edit adds a secret version that Google bills at $0.06/month until destroyed.', keepNow > 0, next => setPrune(next ? 3 : 0, graceNow), false, keepNow ? 'Disable version pruning' : 'Enable version pruning'));
      const keepSel = el('select', 'input compact'); for (const n of [2, 3, 5, 10]) { const o = el('option', '', `${n} versions`); o.value = n; keepSel.append(o); } keepSel.value = keepNow || 3; keepSel.disabled = !keepNow;
      keepSel.addEventListener('change', () => run(() => setPrune(Number(keepSel.value), graceNow)));
      pr.append(actionRow('Versions to keep per secret', 'The active version in use is always retained.', keepSel));
      const graceSel = el('select', 'input compact'); for (const [h, label] of [[24, '1 day'], [72, '3 days'], [168, '7 days'], [720, '30 days']]) { const o = el('option', '', label); o.value = h; graceSel.append(o); } graceSel.value = graceNow;
      graceSel.addEventListener('change', () => run(() => setPrune(keepNow, Number(graceSel.value))));
      pr.append(actionRow('Grace before destruction', 'Pruned versions stay disabled (and billed) during this window so you can re-enable them with gcloud if needed.', graceSel));
      if (st.prune?.denied) pr.append(notice('This Google account could not destroy versions. Re-run scripts/setup-gcp.sh to add versions.list/destroy/enable to the IAM role, then prune again.', 'warning'));
      const last = st.prune?.last;
      pr.append(actionRow('Prune now', last ? `Last sweep ${new Date(last.at).toLocaleString()}: ${last.scanned} secrets, ${last.destroyed} scheduled${last.failed ? `, ${last.failed} failed` : ''}.` : 'Scan every secret once and schedule old versions for destruction.', button('Prune old versions', () => showPrune(keepNow || 3), 'small', !st.unlocked || st.offline)));
      return pr;
    }
    stage.append(buildPruneGroup());

    const cl = group('Cloud connection', 'Google Secret Manager');
    const project = input(st.settings.project || '', 'text', 'your-project-id'), vault = input(st.settings.vault || 'personal'); project.classList.add('compact'); vault.classList.add('compact'); project.disabled = vault.disabled = st.unlocked;
    cl.append(actionRow('Project ID', st.unlocked ? 'Lock the vault to switch Google Cloud projects.' : 'A dedicated project with Secret Manager API enabled.', project));
    cl.append(actionRow('Vault namespace', 'Secrets are stored under the prefix hdv1-<name>-…', vault));
    if (!st.unlocked) cl.append(actionRow('', '', button('Save settings', () => busy(async () => { state.status = await api('configure', { project: project.value.trim(), vault: vault.value.trim(), idleSeconds: st.settings.idleSeconds || 300 }); toast('Settings saved.'); render(); }), 'primary small')));
    cl.append(actionRow('Google account', st.signedIn ? st.email : 'Not signed in.', button(st.signedIn ? 'Reconnect' : 'Sign in / reconnect Google', signIn, 'small', !st.oauthConfigured)));
    cl.append(actionRow('Desktop OAuth client', st.oauthConfigured ? `Configured on ${DEVICE}.` : 'Import the Desktop OAuth client JSON from Google Auth Platform.', button('Import Desktop OAuth JSON', () => busy(async () => { const result = await api('import-oauth'); if (!result.cancelled) { state.status = result; render(); } }), 'small', st.unlocked)));
    if (st.unlocked && !st.offline) cl.append(actionRow('Sync from cloud', 'Re-read every committed secret version from Google Secret Manager.', button('Refresh from Google', () => busy(async () => { await api('vault-refresh'); await reloadItems(); state.status = await api('status'); render(); toast('Vault refreshed.'); }), 'small')));
    if (st.signedIn) cl.append(actionRow('Sign out', `Removes the Google OAuth session, ${bioLabel()} key and local encrypted cache from ${DEVICE}.`, button('Sign out & clear local cache', async () => { const result = await api('google-logout'); if (!result.cancelled) await boot(); }, 'small danger')));
    stage.append(cl);
  }

  if (state.settingsTab === 'integrations') {
    const br = group('CLI, SSH Agent & Browser', 'Local 0600 Unix sockets');
    const bridge = st.bridge || {};
    const bridgeDesc = el('div', 'srow-desc');
    append(bridgeDesc, document.createTextNode('Serves the local hdv CLI and Chromium Native Messaging host.'), bridge.socketPath ? append(el('div', 'pill-row'), codePill('SOCKET', bridge.socketPath, bridge.socketPath)) : null);
    br.append(switchRow('Local CLI & browser bridge', bridgeDesc, bridge.enabled !== false, async next => { state.status = await api('bridge-config', { bridgeEnabled: next }); render(); toast(next ? 'CLI & browser bridge enabled.' : 'CLI & browser bridge disabled.'); }));

    const sshDesc = el('div', 'srow-desc');
    append(sshDesc, document.createTextNode('Serves your vault Ed25519 keys to ssh and git while unlocked.'), bridge.sshSocketPath ? append(el('div', 'pill-row'), codePill('SSH_AUTH_SOCK', bridge.sshSocketPath, `export SSH_AUTH_SOCK="${bridge.sshSocketPath}"`)) : null);
    br.append(switchRow('OpenSSH agent (SSH_AUTH_SOCK)', sshDesc, bridge.sshAgentEnabled !== false, async next => { state.status = await api('bridge-config', { sshAgentEnabled: next }); render(); toast(next ? 'SSH agent enabled.' : 'SSH agent disabled.'); }));
    if (bridge.sshSocketPath) {
      const exportCmd = `export SSH_AUTH_SOCK="${bridge.sshSocketPath}"`;
      const expDesc = append(el('div', 'srow-desc'), document.createTextNode(`Add to ${IS_MAC ? '~/.zshrc' : '~/.bashrc (or ~/.zshrc)'} to use vault SSH keys automatically in terminal sessions.`), append(el('div', 'pill-row'), codePill(IS_MAC ? 'ZSH' : 'SHELL', exportCmd, exportCmd)));
      br.append(actionRow('Shell environment export', expDesc, button('Copy export', async () => { await api('copy', { value: exportCmd }); toast('Copied SSH_AUTH_SOCK export to clipboard.'); }, 'small')));
    }

    const extId = bridge.extensionId || 'palhmjdobfcnfkkemcpfkecpjnefbnhp';
    const extDir = bridge.extensionDir || 'extension/';
    const cliPath = bridge.cliLinkPath || 'not linked';
    const pills = append(el('div', 'pill-row'),
      codePill('CLI', cliPath, cliPath),
      codePill('EXT ID', extId, extId),
      codePill('EXT DIR', extDir, extDir));
    const nmDesc = append(el('div', 'srow-desc'),
      document.createTextNode(`Registers Native Messaging manifests for ${IS_MAC ? 'Chrome, Comet, Brave, Arc and Edge' : 'Chrome, Brave, Edge, Vivaldi and Chromium (natively installed, not Snap or Flatpak)'}, links the hdv CLI into PATH, and stages the unpacked extension folder. To activate in Chrome: open chrome://extensions → Developer mode → Load unpacked.`),
      pills);
    const nmActions = append(el('div', 'cost-actions'),
      button('Reveal extension', () => busy(async () => { await api('install-browser', { revealOnly: true }); }), 'small subtle'),
      button(bridge.hostInstalled ? 'Reinstall host & CLI' : 'Install browser host & CLI', () => busy(async () => {
        const res = await api('install-browser', {});
        state.status = await api('status');
        render();
        const cli = res.cliLinkPath || res.cliWrapper || 'hdv';
        const count = Array.isArray(res.installed) ? res.installed.length : 5;
        toast(`Installed CLI (${cli}) and ${count} browser manifests.`);
      }, 'Installing manifests...'), 'small'));
    br.append(actionRow('Chromium Native Messaging & CLI', nmDesc, nmActions));
    stage.append(br);
  }

  if (state.settingsTab === 'backup') {
    const bk = group('Backup & recovery', 'Encrypted .hdvault files');
    bk.append(actionRow('Export encrypted backup', 'Exports all encrypted credentials and key wrappers to a local .hdvault file. Contains no Google OAuth tokens.', button('Export encrypted backup', () => busy(async () => { const r = await api('backup-export'); if (r.saved) toast('Encrypted backup exported.'); }), 'small', locked)));
    bk.append(actionRow('Restore from backup', 'Decrypts a .hdvault backup with its master password or recovery code and adds its items to this vault.', button('Restore an encrypted backup', showRestore, 'small', locked || st.offline)));
    stage.append(bk);

    const im = group('Import', 'From 1Password or any CSV');
    im.append(actionRow('Import wizard', 'Import logins or payment cards from a CSV file with column mapping, duplicate detection and live progress.', button('Import from 1Password / CSV', () => showImportWizard(), 'small', locked || st.offline)));
    im.append(el('div', 'sgroup-foot', 'Supports 1Password and standard CSV exports for Logins and Payment cards. The wizard can automatically delete the plaintext CSV after import completes.'));
    stage.append(im);
  }

  if (state.settingsTab === 'about') {
    const ab = group('About Hidden Door Vault', `Version ${st.appVersion}`);
    ab.append(actionRow('Payload encryption', 'Authenticated encryption with per-item random 96-bit nonces and context-bound AAD.', codePill('CIPHER', 'AES-256-GCM')));
    ab.append(actionRow('Key derivation', 'Master password and recovery code independently wrap a 256-bit random vault key.', codePill('KDF', 'scrypt N=131072, r=8, p=1')));
    ab.append(actionRow('SSH & Passkey signatures', 'Hardware-independent OpenSSH agent and WebAuthn ceremonies.', codePill('CURVES', 'Ed25519 · P-256 (ES256)')));
    ab.append(notice('Development build. Includes local CLI (hdv), SSH_AUTH_SOCK agent, WebAuthn passkeys and Chromium Native Messaging integration. No independent security audit, sharing, secure deletion or password-change flow.', 'warning'));
    ab.append(el('p', 'about-text', 'Clipboard clearing cannot erase copies captured by third-party clipboard managers. JavaScript runtimes cannot guarantee physical RAM zeroization. Screen-capture protection is best-effort.'));
    stage.append(ab);
  }

  $('#main').append(content);
}
let progressHandler = null;
window.vaultAPI?.onProgress?.(payload => progressHandler?.(payload));
function showImportWizard(preset = null) {
  const modal = $('#modal'); modal.replaceChildren(); modal.classList.add('wizard');
  const close = () => { modal.close(); modal.replaceChildren(); modal.classList.remove('wizard'); progressHandler = null; };
  const steps = ['Source', 'Review', 'Import', 'Done']; let stepIndex = 0;
  const head = el('div', 'wizard-head'); const title = el('h2', '', 'Import from 1Password or CSV'); const crumbs = el('div', 'wizard-steps'); append(head, title, crumbs);
  const body = el('div', 'wizard-body'); const foot = el('div', 'wizard-foot'); append(modal, head, body, foot);
  function paintCrumbs() { crumbs.replaceChildren(); steps.forEach((name, i) => { const c = el('span', `crumb${i === stepIndex ? ' active' : i < stepIndex ? ' done' : ''}`); append(c, el('b', '', String(i + 1)), el('span', '', name)); crumbs.append(c); }); }
  function show(i, render) { stepIndex = i; paintCrumbs(); body.replaceChildren(); foot.replaceChildren(); render(); }
  let preview = null, kind = preset || 'login';
  const stepSource = () => {
    append(body, el('p', 'wizard-lead', `Export a CSV from 1Password (File > Export, CSV) or any password manager, then pick it here. The file is read on ${DEVICE} and never uploaded; items are encrypted before they reach Google.`));
    const choices = el('div', 'choice-grid');
    for (const [k, name, desc, headers] of [['login', 'Logins', 'Websites, apps and accounts', 'Title, Url, Username, Password, OTPAuth, Favorite, Tags, Notes'], ['card', 'Payment cards', 'Personal credit and debit cards', 'Title, Cardholder, Number, Expiry, SecurityCode, Notes, Tags']]) {
      const c = el('button', `choice${kind === k ? ' active' : ''}`); c.type = 'button'; append(c, append(el('span', 'kind-glyph'), svgIcon(k)), el('strong', '', name), el('small', '', desc), el('code', '', headers)); c.addEventListener('click', () => { kind = k; show(0, stepSource); }); choices.append(c);
    }
    body.append(choices, el('div', 'hint', 'Only Title and Password (or Title and Number) are required. 1Password’s own column names are recognized.'));
    append(foot, button('Cancel', close, 'subtle'), button('Choose CSV file…', () => busy(async () => { const r = await api('import-preview', { kind }); if (r.cancelled) return; preview = r; show(1, stepReview); }, `Reading the file on ${DEVICE}...`), 'primary'));
  };
  const skipDup = checkbox('Skip items already in this vault or repeated in the file', true), skipNoSecret = checkbox(kind === 'card' ? 'Skip rows without a card number' : 'Skip rows without a password (passkey or Google sign-in accounts)', false), delSource = checkbox('Delete the CSV from disk after a complete import', true);
  const stepReview = () => {
    const p = preview; const stats = el('div', 'stat-grid');
    const stat = (n, label, tone = '') => { const s = el('div', `stat-tile ${tone}`); append(s, el('b', '', String(n)), el('span', '', label)); return s; };
    append(stats, stat(p.total, `${p.kind === 'card' ? 'cards' : 'logins'} in file`), stat(p.duplicateInVault + p.duplicateInFile, 'duplicates', p.duplicateInVault + p.duplicateInFile ? 'warn' : ''), stat(p.noSecret, p.kind === 'card' ? 'no number' : 'no password', p.noSecret ? 'warn' : ''), stat(p.vaultCount, 'already in vault'));
    append(body, el('p', 'wizard-lead', `${p.file}`), stats, el('div', 'hint', `First items: ${p.sample.join(' · ')}${p.total > p.sample.length ? ' …' : ''}`), skipDup.label, skipNoSecret.label, delSource.label, el('div', 'hint', 'Each item becomes one encrypted Secret Manager secret, about one per second. You can stop at any time; items already saved stay saved.'));
    append(foot, button('Back', () => { api('import-cancel'); preview = null; show(0, stepSource); }, 'subtle'), button('Start import', () => show(2, stepRun), 'primary'));
  };
  const stepRun = () => {
    const bar = el('div', 'progress'); const fill = el('div', 'progress-fill'); bar.append(fill); const line = el('div', 'progress-line', 'Starting…'); const sub = el('div', 'hint', ''); const started = Date.now();
    append(body, el('p', 'wizard-lead', `Encrypting on ${DEVICE} and writing to Google Secret Manager.`), bar, line, sub);
    const stop = button('Stop after this item', () => { api('import-stop'); stop.disabled = true; stop.textContent = 'Stopping…'; }, 'subtle'); foot.append(stop);
    progressHandler = ({ done, total, title: t }) => { const pct = total ? Math.round(done / total * 100) : 0; fill.style.width = `${pct}%`; line.textContent = `${done} of ${total} · ${pct}%`; const rate = done / Math.max(1, (Date.now() - started) / 1000); sub.textContent = done && done < total ? `${t} · about ${Math.max(1, Math.round((total - done) / Math.max(rate, 0.1)))}s left` : t || ''; };
    (async () => {
      try { const r = await api('import-run', { token: preview.token, skipDuplicates: skipDup.input.checked, skipNoSecret: skipNoSecret.input.checked, deleteSource: delSource.input.checked }); progressHandler = null; await reloadItems(); render(); show(3, () => stepDone(r)); }
      catch (error) { progressHandler = null; await reloadItems().catch(() => {}); render(); show(3, () => stepDone({ error: error.message })); }
    })();
  };
  const stepDone = r => {
    if (r.error) append(body, notice(r.error, 'error'));
    else {
      const done = el('div', 'stat-grid'); const stat = (n, label, tone = '') => { const s = el('div', `stat-tile ${tone}`); append(s, el('b', '', String(n)), el('span', '', label)); return s; };
      append(done, stat(r.saved, 'imported', 'ok'), stat(r.skipped, 'skipped'), stat(r.total - r.saved, r.stopped ? 'not reached' : 'failed'));
      append(body, el('p', 'wizard-lead', r.stopped ? 'Stopped. Everything saved so far is in the vault.' : 'Import complete.'), done, el('div', 'hint', r.deleted ? `${r.file} was deleted from disk.` : `${r.file} is still on disk and contains plaintext. Remove it when you are done.`));
    }
    foot.append(button('Done', close, 'primary'));
  };
  show(0, stepSource); modal.showModal();
}
function showPrune(keep) {
  const modal = $('#modal'); modal.replaceChildren(); modal.classList.add('wizard');
  const close = () => { modal.close(); modal.replaceChildren(); modal.classList.remove('wizard'); progressHandler = null; };
  const head = el('div', 'wizard-head'); append(head, el('h2', '', 'Prune old versions'));
  const body = el('div', 'wizard-body'); const foot = el('div', 'wizard-foot'); append(modal, head, body, foot);
  const bar = el('div', 'progress'); const fill = el('div', 'progress-fill'); bar.append(fill); const line = el('div', 'progress-line', 'Waiting for confirmation…'); const sub = el('div', 'hint', '');
  append(body, el('p', 'wizard-lead', `Each secret keeps its newest ${keep} enabled versions, always including the one in use. Older versions are disabled now and destroyed by Google after the grace period. Nothing you can see in the vault changes.`), bar, line, sub);
  const stop = button('Stop', () => { api('prune-stop'); stop.disabled = true; stop.textContent = 'Stopping…'; }, 'subtle'); foot.append(stop);
  progressHandler = ({ done, total, destroyed }) => { const pct = total ? Math.round(done / total * 100) : 0; fill.style.width = `${pct}%`; line.textContent = `${done} of ${total} secrets · ${pct}%`; sub.textContent = `${destroyed} version${destroyed === 1 ? '' : 's'} scheduled for destruction so far`; };
  modal.showModal();
  (async () => {
    let r; try { r = await api('prune-run', { keep }); } catch (error) { r = { error: error.message }; }
    progressHandler = null; foot.replaceChildren();
    if (r.cancelled) { close(); return; }
    body.replaceChildren();
    if (r.error) body.append(notice(r.error, 'error'));
    else {
      const grid = el('div', 'stat-grid'); const stat = (n, label, tone = '') => { const s = el('div', `stat-tile ${tone}`); append(s, el('b', '', String(n)), el('span', '', label)); return s; };
      append(grid, stat(r.scanned, 'secrets scanned'), stat(r.destroyed, 'scheduled', r.destroyed ? 'ok' : ''), stat(r.kept, 'versions kept'), stat(r.failed, 'failed', r.failed ? 'warn' : ''));
      append(body, el('p', 'wizard-lead', r.stopped ? 'Stopped. Versions already scheduled stay scheduled.' : 'Sweep complete.'), grid, el('div', 'hint', r.destroyed ? 'Scheduled versions are still billed until Google destroys them after the grace period.' : 'Nothing to prune: every secret is already within the limit.'));
    }
    try { state.status = await api('status'); } catch (_) {}
    foot.append(button('Done', () => { close(); render(); }, 'primary'));
  })();
}
function showRestore() {
  const modal = $('#modal'); modal.replaceChildren(); const secret = input('', 'password', 'Master password for the backup'), recovery = checkbox('Use the backup\'s recovery code');
  append(modal, el('h2', '', 'Restore encrypted items.'), el('p', '', 'Enter the credential that unlocks the source backup. Then choose the .hdvault file. Items will be added to the current vault without overwriting existing records.'), field('Backup unlock credential', secret), recovery.label, append(el('div', 'button-row end'), button('Cancel', () => { secret.value = ''; modal.close(); modal.replaceChildren(); }, 'subtle'), button('Choose backup & restore', () => busy(async () => {
    const result = await api('backup-restore', { credential: secret.value, recovery: recovery.input.checked }); secret.value = ''; if (!result.cancelled) { modal.close(); modal.replaceChildren(); await reloadItems(); render(); toast(`Restored ${result.saved} items.`); }
  }, 'Restoring encrypted backup...'), 'primary'))); modal.showModal();
}
function showRekeyModal() {
  const modal = $('#modal'); modal.replaceChildren();
  const currentPw = secretInput('Current master password', 'current-password');
  const nextPw = secretInput('New master password (at least 16 characters)', 'new-password');
  const confirmPw = secretInput('Confirm new master password', 'new-password');
  const useRecovery = checkbox('I forgot it: use my recovery code (HDV1-…) instead');
  useRecovery.input.addEventListener('change', () => { currentPw.control.placeholder = useRecovery.input.checked ? 'HDV1-...' : 'Current master password'; currentPw.control.value = ''; });
  const clear = () => { currentPw.control.value = ''; nextPw.control.value = ''; confirmPw.control.value = ''; modal.close(); modal.replaceChildren(); };
  append(modal,
    el('h2', '', 'Change master password.'),
    el('p', '', 'Re-wraps the 256-bit vault key in the cloud header under your new master password and issues a fresh recovery code. Existing items do not need to be re-uploaded. Confirm with the current master password or, if you no longer know it, with the recovery code.'),
    field('Current master password or recovery code', currentPw.wrap),
    useRecovery.label,
    field('New master password', nextPw.wrap),
    field('Confirm new master password', confirmPw.wrap),
    append(el('div', 'button-row end'),
      button('Cancel', clear, 'subtle'),
      button('Change master password', () => busy(async () => {
        if (nextPw.control.value.length < 16) throw new Error('Use a new master password of at least 16 characters.');
        if (nextPw.control.value !== confirmPw.control.value) throw new Error('New master passwords do not match.');
        const res = await api('vault-rekey', { currentPassword: currentPw.control.value, newPassword: nextPw.control.value, recovery: useRecovery.input.checked });
        currentPw.control.value = ''; nextPw.control.value = ''; confirmPw.control.value = '';
        modal.replaceChildren();
        const codeBox = el('div', 'recovery-box mono', res.recoveryCode);
        append(modal,
          el('h2', '', 'Save your new recovery code.'),
          el('p', '', `Master password updated (header generation ${res.generation}). Store this new recovery code offline; previous recovery codes and passwords no longer unlock the current header.`),
          codeBox,
          append(el('div', 'button-row end'),
            button('Copy recovery code', async () => { await api('copy', { value: res.recoveryCode }); toast('Copied recovery code.'); }, 'subtle'),
            button('I saved the recovery code', () => { modal.close(); modal.replaceChildren(); render(); }, 'primary')
          )
        );
      }, 'Re-wrapping vault key...'), 'primary')
    )
  );
  modal.showModal();
}
window.vaultAPI?.onLock(() => { clearSensitiveUI(); run(boot); });
window.vaultAPI?.onAutoTouchId?.(() => { autoTouchIdUnlock(); });
window.vaultAPI?.onSynced?.(async payload => {
  if (payload?.unlocked && !state.status?.unlocked) {
    await run(boot);
    if (!payload?.openItemId) return;
  }
  if (!state.status?.unlocked) return;
  if (payload?.openItemId) {
    try {
      state.status = await api('status');
      await reloadItems();
      const target = await api('vault-get', { id: payload.openItemId });
      if (target) {
        state.mode = 'browse';
        state.filter = 'all';
        state.search = '';
        state.selected = target.id;
        state.current = target;
        render();
        return;
      }
    } catch (_) {}
  } else if (payload?.openMode) {
    state.mode = payload.openMode;
    render();
    return;
  }
  try {
    state.status = await api('status');
    if (['browse', 'settings'].includes(state.mode)) {
      await reloadItems();
      if (!$('.editor-header')) render();
    }
  } catch (_) {}
  if (payload?.ok === false) toast(`Background sync failed: ${payload.error}`, true);
  else if (payload?.fetched) toast(`Synced ${payload.fetched} changed item${payload.fetched === 1 ? '' : 's'} from Google.`);
});
for (const event of ['pointerdown', 'keydown', 'wheel']) document.addEventListener(event, () => { if (Date.now() - activityAt > 1000) { activityAt = Date.now(); window.vaultAPI?.activity(); } }, { passive: true });
document.addEventListener('keydown', event => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('#search')?.focus(); } if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'l') { event.preventDefault(); run(() => api('vault-lock')); } });
run(boot);
