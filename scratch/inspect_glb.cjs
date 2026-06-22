const fs = require('fs');
const path = require('path');

const glbPath = path.join(__dirname, '..', 'public', 'models', 'sample.glb');

if (!fs.existsSync(glbPath)) {
  console.error("GLB file not found at:", glbPath);
  process.exit(1);
}

const buffer = fs.readFileSync(glbPath);

// Check GLB header
const magic = buffer.toString('utf8', 0, 4);
const version = buffer.readUInt32LE(4);
const length = buffer.readUInt32LE(8);

console.log("GLB Header:");
console.log("- Magic:", magic);
console.log("- Version:", version);
console.log("- Total Length:", length, "bytes");

if (magic !== 'glTF') {
  console.error("Invalid GLB magic header");
  process.exit(1);
}

// Read Chunk 0 (JSON)
const chunkLength = buffer.readUInt32LE(12);
const chunkType = buffer.toString('utf8', 16, 20);

console.log("Chunk 0:");
console.log("- Length:", chunkLength);
console.log("- Type:", chunkType);

if (chunkType !== 'JSON') {
  console.error("Chunk 0 is not JSON");
  process.exit(1);
}

const jsonBuffer = buffer.subarray(20, 20 + chunkLength);
const jsonString = jsonBuffer.toString('utf8');

try {
  const gltf = JSON.parse(jsonString);
  console.log("glTF JSON parsed successfully!");
  console.log("- Extensions used:", gltf.extensionsUsed);
  console.log("- Extensions required:", gltf.extensionsRequired);
  console.log("- Number of materials:", gltf.materials ? gltf.materials.length : 0);
  if (gltf.materials) {
    console.log("- Materials sample:", gltf.materials.slice(0, 3));
  }
  console.log("- Number of meshes:", gltf.meshes ? gltf.meshes.length : 0);
  console.log("- Number of nodes:", gltf.nodes ? gltf.nodes.length : 0);
  console.log("- Scenes:", gltf.scenes);
} catch (e) {
  console.error("Failed to parse glTF JSON:", e.message);
}
