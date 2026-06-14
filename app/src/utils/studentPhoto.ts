const PHOTO_SIZE = 512;
const PHOTO_QUALITY = 0.82;

const loadImage = (src: string): Promise<HTMLImageElement> => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('Bild konnte nicht geladen werden.'));
  image.src = src;
});

export const compressStudentPhotoSource = async (src: string): Promise<string> => {
  const image = await loadImage(src);
  const sourceSize = Math.min(image.naturalWidth, image.naturalHeight);
  if (!sourceSize) {
    throw new Error('Bild ist ungültig.');
  }

  const targetSize = Math.min(PHOTO_SIZE, sourceSize);
  const canvas = document.createElement('canvas');
  canvas.width = targetSize;
  canvas.height = targetSize;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Bild konnte nicht verarbeitet werden.');
  }

  const sourceX = Math.floor((image.naturalWidth - sourceSize) / 2);
  const sourceY = Math.floor((image.naturalHeight - sourceSize) / 2);
  context.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, targetSize, targetSize);

  return canvas.toDataURL('image/jpeg', PHOTO_QUALITY);
};

export const readFileAsDataUrl = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => {
    if (typeof reader.result === 'string') {
      resolve(reader.result);
      return;
    }

    reject(new Error('Datei konnte nicht gelesen werden.'));
  };
  reader.onerror = () => reject(new Error('Datei konnte nicht gelesen werden.'));
  reader.readAsDataURL(file);
});
