/**
 * Zhang-Suen 法による細線化。0 以外を前景とする二値画像を受け取り、前景を 1 画素幅の中心線にする。
 * 走査は前景の画素だけに絞り、壁以外がほとんどの図面でも速く終わるようにする。
 */
export function thinZhangSuen(src: Uint8Array, width: number, height: number): Uint8Array {
  const img = new Uint8Array(width * height);
  let candidates: number[] = [];
  for (let i = 0; i < src.length; i++) {
    if (src[i] !== 0) {
      img[i] = 1;
      candidates.push(i);
    }
  }

  const at = (x: number, y: number) =>
    x < 0 || y < 0 || x >= width || y >= height ? 0 : img[y * width + x]!;

  const toDelete: number[] = [];
  let changed = true;
  while (changed) {
    changed = false;
    for (let step = 0; step < 2; step++) {
      toDelete.length = 0;
      for (const idx of candidates) {
        if (img[idx] === 0) continue;
        const x = idx % width;
        const y = (idx - x) / width;
        const p2 = at(x, y - 1);
        const p3 = at(x + 1, y - 1);
        const p4 = at(x + 1, y);
        const p5 = at(x + 1, y + 1);
        const p6 = at(x, y + 1);
        const p7 = at(x - 1, y + 1);
        const p8 = at(x - 1, y);
        const p9 = at(x - 1, y - 1);
        const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
        if (b < 2 || b > 6) continue;
        const a =
          +(p2 === 0 && p3 === 1) +
          +(p3 === 0 && p4 === 1) +
          +(p4 === 0 && p5 === 1) +
          +(p5 === 0 && p6 === 1) +
          +(p6 === 0 && p7 === 1) +
          +(p7 === 0 && p8 === 1) +
          +(p8 === 0 && p9 === 1) +
          +(p9 === 0 && p2 === 1);
        if (a !== 1) continue;
        if (step === 0) {
          if (p2 * p4 * p6 !== 0 || p4 * p6 * p8 !== 0) continue;
        } else if (p2 * p4 * p8 !== 0 || p2 * p6 * p8 !== 0) {
          continue;
        }
        toDelete.push(idx);
      }
      for (const idx of toDelete) img[idx] = 0;
      if (toDelete.length > 0) changed = true;
    }
    candidates = candidates.filter((idx) => img[idx] !== 0);
  }

  for (let i = 0; i < img.length; i++) img[i] = img[i] ? 255 : 0;
  return img;
}
