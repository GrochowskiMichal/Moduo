/**
 * Packs PNG images into one .ico file. Modern ICO allows each entry to be a
 * whole PNG, which every current browser and Windows reads, so no bitmap
 * conversion is needed.
 */

export type IcoImage = { size: number; png: Uint8Array };

export function packIco(images: IcoImage[]): Uint8Array {
  const headerSize = 6;
  const entrySize = 16;
  const dataStart = headerSize + entrySize * images.length;
  const total = dataStart + images.reduce((sum, img) => sum + img.png.byteLength, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);

  view.setUint16(0, 0, true); // reserved
  view.setUint16(2, 1, true); // type: icon
  view.setUint16(4, images.length, true);

  let offset = dataStart;
  images.forEach((img, i) => {
    if (img.size < 1 || img.size > 256) throw new Error(`ico: size ${img.size} is outside 1–256`);
    const e = headerSize + entrySize * i;
    view.setUint8(e, img.size === 256 ? 0 : img.size); // width (0 means 256)
    view.setUint8(e + 1, img.size === 256 ? 0 : img.size); // height
    view.setUint8(e + 2, 0); // palette size
    view.setUint8(e + 3, 0); // reserved
    view.setUint16(e + 4, 1, true); // colour planes
    view.setUint16(e + 6, 32, true); // bits per pixel
    view.setUint32(e + 8, img.png.byteLength, true);
    view.setUint32(e + 12, offset, true);
    out.set(img.png, offset);
    offset += img.png.byteLength;
  });
  return out;
}

/** Width and height from a PNG's IHDR chunk (used by the drift test). */
export function pngSize(png: Uint8Array): { width: number; height: number } {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}
