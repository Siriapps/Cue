import { readFileSync, writeFileSync, existsSync, statSync } from 'fs';
import { resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const contentPath = resolve(__dirname, 'dist/content.js');

try {
  if (!existsSync(contentPath)) {
    throw new Error(`File does not exist: ${contentPath}`);
  }
  
  // Read file as raw bytes
  const rawBytes = readFileSync(contentPath);
  
  // Validate and clean UTF-8 byte-by-byte
  // Chrome is very strict about UTF-8, so we need to ensure every byte sequence is valid
  const cleanedBytes = [];
  let i = 0;
  
  while (i < rawBytes.length) {
    const byte = rawBytes[i];
    
    // ASCII (0x00-0x7F) - always valid
    if ((byte & 0x80) === 0) {
      cleanedBytes.push(byte);
      i++;
    }
    // 2-byte sequence (0xC0-0xDF)
    else if ((byte & 0xE0) === 0xC0) {
      if (i + 1 < rawBytes.length && (rawBytes[i + 1] & 0xC0) === 0x80) {
        cleanedBytes.push(byte, rawBytes[i + 1]);
        i += 2;
      } else {
        i++; // Skip invalid byte
      }
    }
    // 3-byte sequence (0xE0-0xEF)
    else if ((byte & 0xF0) === 0xE0) {
      if (i + 2 < rawBytes.length && 
          (rawBytes[i + 1] & 0xC0) === 0x80 && 
          (rawBytes[i + 2] & 0xC0) === 0x80) {
        cleanedBytes.push(byte, rawBytes[i + 1], rawBytes[i + 2]);
        i += 3;
      } else {
        i++; // Skip invalid byte
      }
    }
    // 4-byte sequence (0xF0-0xF7)
    else if ((byte & 0xF8) === 0xF0) {
      if (i + 3 < rawBytes.length && 
          (rawBytes[i + 1] & 0xC0) === 0x80 && 
          (rawBytes[i + 2] & 0xC0) === 0x80 &&
          (rawBytes[i + 3] & 0xC0) === 0x80) {
        cleanedBytes.push(byte, rawBytes[i + 1], rawBytes[i + 2], rawBytes[i + 3]);
        i += 4;
      } else {
        i++; // Skip invalid byte
      }
    }
    // Continuation byte (0x80-0xBF) without a start byte - invalid
    else if ((byte & 0xC0) === 0x80) {
      i++; // Skip orphaned continuation byte
    }
    // Invalid byte
    else {
      i++; // Skip invalid byte
    }
  }
  
  const cleanedBuffer = Buffer.from(cleanedBytes);
  
  // Convert all non-ASCII characters to Unicode escape sequences
  // This ensures Chrome's strict UTF-8 validation passes
  const cleanedContent = cleanedBuffer.toString('utf8');
  const asciiSafe = cleanedContent.replace(/[^\x00-\x7F]/g, (char) => {
    const code = char.charCodeAt(0);
    return '\\u' + code.toString(16).padStart(4, '0');
  });
  
  // Write as ASCII-safe UTF-8
  writeFileSync(contentPath, asciiSafe, 'utf8');
  
  console.log('✓ Ensured content.js is UTF-8 encoded');
} catch (error) {
  console.error('Error ensuring UTF-8 encoding:', error);
  process.exit(1);
}
