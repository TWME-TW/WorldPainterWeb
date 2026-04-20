/**
 * Minimal NBT (Named Binary Tag) encoder for Minecraft Java Edition world data.
 * Only implements the subset of NBT needed for chunk and level.dat generation.
 * Integers are big-endian throughout (per the NBT specification).
 */

const UTF8_ENCODER = new TextEncoder();

// NBT tag type IDs
export const TAG_END = 0;
export const TAG_BYTE = 1;
export const TAG_SHORT = 2;
export const TAG_INT = 3;
export const TAG_LONG = 4;
export const TAG_FLOAT = 5;
export const TAG_DOUBLE = 6;
export const TAG_BYTE_ARRAY = 7;
export const TAG_STRING = 8;
export const TAG_LIST = 9;
export const TAG_COMPOUND = 10;
export const TAG_INT_ARRAY = 11;
export const TAG_LONG_ARRAY = 12;

export type NbtEntry =
  | { t: 1; v: number }         // TAG_BYTE
  | { t: 2; v: number }         // TAG_SHORT
  | { t: 3; v: number }         // TAG_INT
  | { t: 4; v: bigint }         // TAG_LONG
  | { t: 5; v: number }         // TAG_FLOAT
  | { t: 6; v: number }         // TAG_DOUBLE
  | { t: 7; v: Uint8Array }     // TAG_BYTE_ARRAY
  | { t: 8; v: string }         // TAG_STRING
  | { t: 9; e: number; v: NbtEntry[] }             // TAG_LIST (e = element tag type)
  | { t: 10; v: Record<string, NbtEntry> }         // TAG_COMPOUND
  | { t: 11; v: Int32Array }    // TAG_INT_ARRAY
  | { t: 12; v: BigInt64Array }; // TAG_LONG_ARRAY

// ---- Factory functions ----

export function nbtByte(v: number): NbtEntry { return { t: 1, v: v & 0xff }; }
export function nbtShort(v: number): NbtEntry { return { t: 2, v }; }
export function nbtInt(v: number): NbtEntry { return { t: 3, v }; }
export function nbtLong(v: bigint | number): NbtEntry { return { t: 4, v: BigInt(v) }; }
export function nbtFloat(v: number): NbtEntry { return { t: 5, v }; }
export function nbtDouble(v: number): NbtEntry { return { t: 6, v }; }
export function nbtByteArray(v: Uint8Array): NbtEntry { return { t: 7, v }; }
export function nbtString(v: string): NbtEntry { return { t: 8, v }; }
export function nbtList(elementTag: number, v: NbtEntry[]): NbtEntry { return { t: 9, e: elementTag, v }; }
export function nbtCompound(v: Record<string, NbtEntry>): NbtEntry { return { t: 10, v }; }
export function nbtIntArray(v: number[] | Int32Array): NbtEntry {
  return { t: 11, v: v instanceof Int32Array ? v : new Int32Array(v) };
}
export function nbtLongArray(v: bigint[] | BigInt64Array): NbtEntry {
  return { t: 12, v: v instanceof BigInt64Array ? v : BigInt64Array.from(v) };
}

// ---- Byte writer ----

class ByteWriter {
  private readonly parts: Uint8Array[] = [];
  private buf: Uint8Array;
  private view: DataView;
  private pos = 0;

  constructor() {
    this.buf = new Uint8Array(16384);
    this.view = new DataView(this.buf.buffer);
  }

  private flush(): void {
    if (this.pos > 0) {
      this.parts.push(this.buf.slice(0, this.pos));
      this.pos = 0;
    }
  }

  private ensure(n: number): void {
    if (this.pos + n <= this.buf.length) {
      return;
    }

    this.flush();

    if (n > this.buf.length) {
      this.buf = new Uint8Array(Math.max(n * 2, 16384));
      this.view = new DataView(this.buf.buffer);
    }
  }

  writeByte(v: number): void {
    this.ensure(1);
    this.view.setUint8(this.pos, v & 0xff);
    this.pos += 1;
  }

  writeShort(v: number): void {
    this.ensure(2);
    this.view.setInt16(this.pos, v, false);
    this.pos += 2;
  }

  writeUShort(v: number): void {
    this.ensure(2);
    this.view.setUint16(this.pos, v, false);
    this.pos += 2;
  }

  writeInt(v: number): void {
    this.ensure(4);
    this.view.setInt32(this.pos, v, false);
    this.pos += 4;
  }

  writeLong(v: bigint): void {
    this.ensure(8);
    this.view.setBigInt64(this.pos, v, false);
    this.pos += 8;
  }

  writeFloat(v: number): void {
    this.ensure(4);
    this.view.setFloat32(this.pos, v, false);
    this.pos += 4;
  }

  writeDouble(v: number): void {
    this.ensure(8);
    this.view.setFloat64(this.pos, v, false);
    this.pos += 8;
  }

  writeRaw(bytes: Uint8Array): void {
    this.flush();
    this.parts.push(bytes);
  }

  toUint8Array(): Uint8Array {
    this.flush();
    let total = 0;

    for (const p of this.parts) {
      total += p.length;
    }

    const result = new Uint8Array(total);
    let offset = 0;

    for (const p of this.parts) {
      result.set(p, offset);
      offset += p.length;
    }

    return result;
  }
}

// ---- NBT encoder ----

function writeNamedTag(w: ByteWriter, name: string, entry: NbtEntry): void {
  w.writeByte(entry.t);
  const nameBytes = UTF8_ENCODER.encode(name);
  w.writeUShort(nameBytes.length);

  if (nameBytes.length > 0) {
    w.writeRaw(nameBytes);
  }

  writePayload(w, entry);
}

function writePayload(w: ByteWriter, entry: NbtEntry): void {
  switch (entry.t) {
    case 1: {
      w.writeByte(entry.v);
      break;
    }
    case 2: {
      w.writeShort(entry.v);
      break;
    }
    case 3: {
      w.writeInt(entry.v);
      break;
    }
    case 4: {
      w.writeLong(entry.v);
      break;
    }
    case 5: {
      w.writeFloat(entry.v);
      break;
    }
    case 6: {
      w.writeDouble(entry.v);
      break;
    }
    case 7: {
      w.writeInt(entry.v.length);
      w.writeRaw(entry.v);
      break;
    }
    case 8: {
      const bytes = UTF8_ENCODER.encode(entry.v);
      w.writeUShort(bytes.length);
      w.writeRaw(bytes);
      break;
    }
    case 9: {
      w.writeByte(entry.e);
      w.writeInt(entry.v.length);

      for (const item of entry.v) {
        writePayload(w, item);
      }

      break;
    }
    case 10: {
      for (const [name, child] of Object.entries(entry.v)) {
        writeNamedTag(w, name, child);
      }

      w.writeByte(TAG_END);
      break;
    }
    case 11: {
      w.writeInt(entry.v.length);

      for (let i = 0; i < entry.v.length; i += 1) {
        w.writeInt(entry.v[i]);
      }

      break;
    }
    case 12: {
      w.writeInt(entry.v.length);

      for (let i = 0; i < entry.v.length; i += 1) {
        w.writeLong(entry.v[i]);
      }

      break;
    }
    default: {
      break;
    }
  }
}

/**
 * Serialize a root NBT compound with the given name.
 * The result is uncompressed NBT bytes (not gzip-wrapped).
 * For level.dat, the caller should gzip-compress the result.
 */
export function serializeNbtRoot(name: string, compound: Record<string, NbtEntry>): Uint8Array {
  const w = new ByteWriter();
  writeNamedTag(w, name, nbtCompound(compound));
  return w.toUint8Array();
}
