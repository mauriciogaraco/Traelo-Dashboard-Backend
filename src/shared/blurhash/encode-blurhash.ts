import { encode } from 'blurhash';
import sharp from 'sharp';

// 4x3 componentes es el equilibrio habitual: string de ~28 caracteres y suficiente detalle
// para un placeholder. La imagen se reduce antes de codificar — el costo de encode() crece
// con el nº de píxeles y para un placeholder borroso no aporta nada más.
const COMPONENTS_X = 4;
const COMPONENTS_Y = 3;
const SAMPLE_SIZE = 32;

// Devuelve null (en vez de lanzar) si la imagen no se puede decodificar: el blurhash es solo
// un adorno de carga, nunca debe hacer fallar la subida de la imagen real.
export async function encodeBlurhash(buffer: Buffer): Promise<string | null> {
  try {
    const { data, info } = await sharp(buffer)
      .rotate()
      .resize(SAMPLE_SIZE, SAMPLE_SIZE, { fit: 'inside' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return encode(new Uint8ClampedArray(data), info.width, info.height, COMPONENTS_X, COMPONENTS_Y);
  } catch {
    return null;
  }
}
