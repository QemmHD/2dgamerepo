#!/bin/sh
# Vendors the three.js modules glbsheet.html needs (not committed — ~1.4MB).
# Run from the directory you serve (it creates ./three/ and ./utils/ there).
set -e
V=0.160.0
mkdir -p three utils
curl -sSL -o three/three.module.js  "https://unpkg.com/three@$V/build/three.module.js"
curl -sSL -o three/GLTFLoader.js    "https://unpkg.com/three@$V/examples/jsm/loaders/GLTFLoader.js"
curl -sSL -o utils/BufferGeometryUtils.js "https://unpkg.com/three@$V/examples/jsm/utils/BufferGeometryUtils.js"
echo "three.js $V vendored: $(du -sh three utils | tr '\n' ' ')"
