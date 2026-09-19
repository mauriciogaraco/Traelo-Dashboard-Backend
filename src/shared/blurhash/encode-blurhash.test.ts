import { decode } from 'blurhash';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { encodeBlurhash } from './encode-blurhash';

async function solidPng(r: number, g: number, b: number): Promise<Buffer> {
  return sharp({ create: { width: 64, height: 48, channels: 3, background: { r, g, b } } })
    .png()
    .toBuffer();
}

describe('encodeBlurhash', () => {
  it('devuelve un blurhash válido que se decodifica al color dominante de la imagen', async () => {
    const hash = await encodeBlurhash(await solidPng(220, 30, 30));
    expect(hash).toMatch(/^[0-9A-Za-z#$%*+,\-.:;=?@[\]^_{|}~]{6,}$/);

    const pixels = decode(hash!, 8, 8);
    // Rojo dominante: el canal R debe superar claramente a G y B.
    expect(pixels[0]).toBeGreaterThan(180);
    expect(pixels[1]).toBeLessThan(80);
    expect(pixels[2]).toBeLessThan(80);
  });

  it('devuelve null en vez de lanzar si el buffer no es una imagen', async () => {
    expect(await encodeBlurhash(Buffer.from('no soy una imagen'))).toBeNull();
  });
});
