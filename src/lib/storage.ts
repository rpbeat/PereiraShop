import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { storage } from './firebase';

type ImgType = 'image/jpeg' | 'image/png';

/** Reduz a imagem (lado maior até `max` px) antes de enviar, para o site carregar rápido. */
export async function resizeImage(file: Blob, max = 1600, type: ImgType = 'image/jpeg'): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext('2d')!;
  if (type === 'image/jpeg') {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Falha a converter imagem'))), type, 0.88),
  );
}

export async function uploadImage(path: string, file: Blob, type: ImgType = 'image/jpeg', max = 1600): Promise<string> {
  const blob = await resizeImage(file, max, type);
  const r = ref(storage, path);
  await uploadBytes(r, blob, { contentType: type, cacheControl: 'public,max-age=31536000' });
  return getDownloadURL(r);
}

/** Remove um ficheiro pelo URL de download. Erros são ignorados (ficheiro já removido, etc.). */
export async function deleteByUrl(url: string): Promise<void> {
  try {
    await deleteObject(ref(storage, url));
  } catch {
    /* ignorar */
  }
}
