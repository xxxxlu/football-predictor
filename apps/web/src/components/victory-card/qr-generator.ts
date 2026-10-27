/**
 * Minimal pure-TypeScript QR Code matrix generator (ECC Level L/M)
 * Zero external dependencies. Generates a boolean[][] module matrix.
 */

const PAD0 = 0xec;
const PAD1 = 0x11;

class QRBitBuffer {
  private buffer: number[] = [];
  private length = 0;

  get(index: number): boolean {
    const bufIndex = Math.floor(index / 8);
    return ((this.buffer[bufIndex] >>> (7 - (index % 8))) & 1) === 1;
  }

  put(num: number, length: number): void {
    for (let i = 0; i < length; i++) {
      this.putBit(((num >>> (length - i - 1)) & 1) === 1);
    }
  }

  getLengthInBits(): number {
    return this.length;
  }

  putBit(bit: boolean): void {
    const bufIndex = Math.floor(this.length / 8);
    if (this.buffer.length <= bufIndex) {
      this.buffer.push(0);
    }
    if (bit) {
      this.buffer[bufIndex] |= 0x80 >>> (this.length % 8);
    }
    this.length++;
  }
}

// Polynomial & Galois Field math for Reed-Solomon error correction
const EXP_TABLE = new Uint8Array(256);
const LOG_TABLE = new Uint8Array(256);
for (let i = 0, x = 1; i < 256; i++) {
  EXP_TABLE[i] = x;
  LOG_TABLE[x] = i;
  x = (x << 1) ^ (x >= 128 ? 0x11d : 0);
}

function glog(n: number): number {
  if (n < 1) throw new Error("glog(" + n + ")");
  return LOG_TABLE[n];
}

function gexp(n: number): number {
  while (n < 0) n += 255;
  while (n >= 256) n -= 255;
  return EXP_TABLE[n];
}

class QRPolynomial {
  num: number[];
  constructor(num: number[], shift = 0) {
    let offset = 0;
    while (offset < num.length && num[offset] === 0) offset++;
    this.num = new Array(num.length - offset + shift);
    for (let i = 0; i < num.length - offset; i++) this.num[i] = num[i + offset];
    for (let i = num.length - offset; i < this.num.length; i++) this.num[i] = 0;
  }

  get(index: number): number {
    return this.num[index];
  }

  getLength(): number {
    return this.num.length;
  }

  multiply(e: QRPolynomial): QRPolynomial {
    const num = new Array(this.getLength() + e.getLength() - 1).fill(0);
    for (let i = 0; i < this.getLength(); i++) {
      for (let j = 0; j < e.getLength(); j++) {
        num[i + j] ^= gexp(glog(this.get(i)) + glog(e.get(j)));
      }
    }
    return new QRPolynomial(num);
  }

  mod(e: QRPolynomial): QRPolynomial {
    if (this.getLength() - e.getLength() < 0) return this;
    const ratio = glog(this.get(0)) - glog(e.get(0));
    const num = new Array(this.getLength());
    for (let i = 0; i < this.getLength(); i++) num[i] = this.get(i);
    for (let i = 0; i < e.getLength(); i++) {
      num[i] ^= gexp(glog(e.get(i)) + ratio);
    }
    return new QRPolynomial(num).mod(e);
  }
}

// Error correction table for versions 1 to 6 (Level M)
// [totalDataCount, ecCountPerBlock]
const RS_BLOCK_TABLE: Record<number, [number, number]> = {
  1: [16, 10],
  2: [28, 16],
  3: [44, 26],
  4: [64, 36],
  5: [86, 48],
  6: [108, 64],
};

function getErrorCorrectPolynomial(errorCorrectLength: number): QRPolynomial {
  let a = new QRPolynomial([1], 0);
  for (let i = 0; i < errorCorrectLength; i++) {
    a = a.multiply(new QRPolynomial([1, gexp(i)], 0));
  }
  return a;
}

export function generateQrMatrix(text: string): boolean[][] {
  const bytes = new TextEncoder().encode(text);
  // Pick smallest fitting version (1 to 6)
  let typeNumber = 1;
  while (typeNumber <= 6) {
    const [totalData] = RS_BLOCK_TABLE[typeNumber];
    if (bytes.length + 3 <= totalData) break;
    typeNumber++;
  }
  if (typeNumber > 6) typeNumber = 6;

  const [totalDataCount, ecCount] = RS_BLOCK_TABLE[typeNumber];
  const buffer = new QRBitBuffer();

  // Mode: 8-bit byte (0100)
  buffer.put(4, 4);
  buffer.put(bytes.length, 8);
  for (let i = 0; i < bytes.length; i++) {
    buffer.put(bytes[i], 8);
  }

  // End of data
  if (buffer.getLengthInBits() + 4 <= totalDataCount * 8) {
    buffer.put(0, 4);
  }
  while (buffer.getLengthInBits() % 8 !== 0) {
    buffer.putBit(false);
  }
  while (buffer.getLengthInBits() < totalDataCount * 8) {
    buffer.put(PAD0, 8);
    if (buffer.getLengthInBits() >= totalDataCount * 8) break;
    buffer.put(PAD1, 8);
  }

  // Reed Solomon error correction
  const rawData: number[] = [];
  for (let i = 0; i < totalDataCount; i++) {
    let byte = 0;
    for (let b = 0; b < 8; b++) {
      if (buffer.get(i * 8 + b)) byte |= 0x80 >>> b;
    }
    rawData.push(byte);
  }

  const rsPoly = getErrorCorrectPolynomial(ecCount);
  const rawPoly = new QRPolynomial(rawData, ecCount);
  const modPoly = rawPoly.mod(rsPoly);

  const finalData = [...rawData];
  for (let i = 0; i < ecCount; i++) {
    const modIndex = i + modPoly.getLength() - ecCount;
    finalData.push(modIndex >= 0 ? modPoly.get(modIndex) : 0);
  }

  // Build grid
  const moduleCount = typeNumber * 4 + 17;
  const matrix: (boolean | null)[][] = Array.from({ length: moduleCount }, () =>
    new Array(moduleCount).fill(null),
  );

  // Helper to place finder pattern
  const setupFinder = (row: number, col: number) => {
    for (let r = -1; r <= 7; r++) {
      if (row + r <= -1 || moduleCount <= row + r) continue;
      for (let c = -1; c <= 7; c++) {
        if (col + c <= -1 || moduleCount <= col + c) continue;
        if (
          (0 <= r && r <= 6 && (c === 0 || c === 6)) ||
          (0 <= c && c <= 6 && (r === 0 || r === 6)) ||
          (2 <= r && r <= 4 && 2 <= c && c <= 4)
        ) {
          matrix[row + r][col + c] = true;
        } else {
          matrix[row + r][col + c] = false;
        }
      }
    }
  };

  setupFinder(0, 0);
  setupFinder(moduleCount - 7, 0);
  setupFinder(0, moduleCount - 7);

  // Timing patterns
  for (let r = 8; r < moduleCount - 8; r++) {
    matrix[r][6] = r % 2 === 0;
  }
  for (let c = 8; c < moduleCount - 8; c++) {
    matrix[6][c] = c % 2 === 0;
  }

  // Dark module
  matrix[4 * typeNumber + 9][8] = true;

  // Fill data with standard mask 0: (row + col) % 2 === 0
  let bitIndex = 0;
  const totalBits = finalData.length * 8;
  const getBit = (idx: number) => {
    const b = Math.floor(idx / 8);
    return ((finalData[b] >>> (7 - (idx % 8))) & 1) === 1;
  };

  for (let right = moduleCount - 1; right > 0; right -= 2) {
    if (right === 6) right--;
    for (let vert = 0; vert < moduleCount; vert++) {
      for (let c = 0; c < 2; c++) {
        const col = right - c;
        const row = ((right + 1) & 2) === 0 ? moduleCount - 1 - vert : vert;
        if (matrix[row][col] === null) {
          let dark = false;
          if (bitIndex < totalBits) {
            dark = getBit(bitIndex++);
          }
          const mask = (row + col) % 2 === 0;
          matrix[row][col] = dark !== mask;
        }
      }
    }
  }

  return matrix.map((row) => row.map((cell) => Boolean(cell)));
}
