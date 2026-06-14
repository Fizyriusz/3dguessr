const fs = require('fs');
const path = require('path');

const glbPath = path.join(__dirname, '..', 'public', 'models', 'sample.glb');
const outPath = path.join(__dirname, '..', 'public', 'models', 'sample.glb');

if (!fs.existsSync(glbPath)) {
  console.error("File not found:", glbPath);
  process.exit(1);
}

const buffer = fs.readFileSync(glbPath);

// Check GLB Header
const magic = buffer.readUInt32LE(0);
const version = buffer.readUInt32LE(4);
const totalLength = buffer.readUInt32LE(8);

console.log("Magic bytes as UInt32LE:", magic.toString(16), "As ASCII:", buffer.toString('ascii', 0, 4));

if (magic !== 0x46546c67) { // "glTF"
  console.error("Invalid GLB file header magic:", magic);
  process.exit(1);
}

console.log("Reading GLB file version:", version, "length:", totalLength);

// Read Chunk 0 (JSON)
const jsonChunkLength = buffer.readUInt32LE(12);
const jsonChunkType = buffer.readUInt32LE(16);

if (jsonChunkType !== 0x4E4F534A) { // "JSON"
  console.error("Chunk 0 is not JSON");
  process.exit(1);
}

const jsonString = buffer.toString('utf8', 20, 20 + jsonChunkLength);
const gltf = JSON.parse(jsonString);

console.log("Parsed glTF JSON. Modifying materials to be Unlit...");

// Initialize extensions collections if not present
if (!gltf.extensionsUsed) {
  gltf.extensionsUsed = [];
}
if (!gltf.extensionsUsed.includes('KHR_materials_unlit')) {
  gltf.extensionsUsed.push('KHR_materials_unlit');
}

// Convert all materials to use KHR_materials_unlit
if (gltf.materials) {
  gltf.materials.forEach((mat) => {
    console.log("Modifying material:", mat.name || "unnamed");
    
    // Add KHR_materials_unlit extension
    if (!mat.extensions) {
      mat.extensions = {};
    }
    mat.extensions.KHR_materials_unlit = {};

    // Remove PBR properties that might conflict or cause issues,
    // but keep baseColorTexture or baseColorFactor for the Unlit extension to use!
    if (mat.pbrMetallicRoughness) {
      // Keep baseColorTexture and baseColorFactor, delete metallic/roughness factors and textures
      delete mat.pbrMetallicRoughness.metallicFactor;
      delete mat.pbrMetallicRoughness.roughnessFactor;
      delete mat.pbrMetallicRoughness.metallicRoughnessTexture;
    }
    
    // Clear other lighting-based factors
    delete mat.normalTexture;
    delete mat.occlusionTexture;
    delete mat.emissiveTexture;
    delete mat.emissiveFactor;
  });
}

// Re-serialize JSON chunk
let newJsonString = JSON.stringify(gltf);
// glTF JSON chunk must be padded with spaces (0x20) to a multiple of 4 bytes
while (newJsonString.length % 4 !== 0) {
  newJsonString += ' ';
}

const newJsonBuffer = Buffer.from(newJsonString, 'utf8');
const newJsonChunkLength = newJsonBuffer.length;

// Get remaining chunks (binary buffer chunk 1)
const originalJsonChunkEnd = 20 + jsonChunkLength;
const binaryChunkHeaderOffset = originalJsonChunkEnd;

let newBuffer;

if (binaryChunkHeaderOffset < buffer.length) {
  const binaryChunkLength = buffer.readUInt32LE(binaryChunkHeaderOffset);
  const binaryChunkType = buffer.readUInt32LE(binaryChunkHeaderOffset + 4);
  const binaryChunkData = buffer.subarray(binaryChunkHeaderOffset + 8, binaryChunkHeaderOffset + 8 + binaryChunkLength);

  // Re-write GLB
  const headerSize = 20; // GLB header (12) + JSON chunk header (8)
  const binaryHeaderSize = 8;
  const newTotalLength = headerSize + newJsonChunkLength + binaryHeaderSize + binaryChunkLength;

  newBuffer = Buffer.alloc(newTotalLength);

  // Write GLB Header
  newBuffer.writeUInt32LE(0x46544C67, 0); // magic
  newBuffer.writeUInt32LE(version, 4); // version
  newBuffer.writeUInt32LE(newTotalLength, 8); // total length

  // Write JSON Chunk Header
  newBuffer.writeUInt32LE(newJsonChunkLength, 12);
  newBuffer.writeUInt32LE(0x4E4F534A, 16); // "JSON"
  
  // Write JSON Data
  newJsonBuffer.copy(newBuffer, 20);

  // Write Binary Chunk Header
  const newBinaryChunkOffset = 20 + newJsonChunkLength;
  newBuffer.writeUInt32LE(binaryChunkLength, newBinaryChunkOffset);
  newBuffer.writeUInt32LE(binaryChunkType, newBinaryChunkOffset + 4);

  // Write Binary Data
  binaryChunkData.copy(newBuffer, newBinaryChunkOffset + 8);
} else {
  // No binary chunk
  const newTotalLength = 20 + newJsonChunkLength;
  newBuffer = Buffer.alloc(newTotalLength);

  newBuffer.writeUInt32LE(0x46544C67, 0);
  newBuffer.writeUInt32LE(version, 4);
  newBuffer.writeUInt32LE(newTotalLength, 8);

  newBuffer.writeUInt32LE(newJsonChunkLength, 12);
  newBuffer.writeUInt32LE(0x4E4F534A, 16);

  newJsonBuffer.copy(newBuffer, 20);
}

fs.writeFileSync(outPath, newBuffer);
console.log("Successfully converted GLB model to Unlit materials!");
