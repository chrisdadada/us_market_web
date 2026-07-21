type CoverVariant = {
  width: number;
  height: number;
  quality: number;
  suffix: string;
};

const CARD_COVER: CoverVariant = { width: 640, height: 360, quality: 0.78, suffix: "card" };
const DETAIL_COVER: CoverVariant = { width: 1280, height: 720, quality: 0.82, suffix: "detail" };

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("图片读取失败"));
    };
    image.src = url;
  });
}

function renderCover(image: HTMLImageElement, file: File, variant: CoverVariant) {
  const canvas = document.createElement("canvas");
  canvas.width = variant.width;
  canvas.height = variant.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("当前浏览器无法处理图片");

  const sourceRatio = image.naturalWidth / image.naturalHeight;
  const targetRatio = variant.width / variant.height;
  let sourceWidth = image.naturalWidth;
  let sourceHeight = image.naturalHeight;
  let sourceX = 0;
  let sourceY = 0;
  if (sourceRatio > targetRatio) {
    sourceWidth = image.naturalHeight * targetRatio;
    sourceX = (image.naturalWidth - sourceWidth) / 2;
  } else {
    sourceHeight = image.naturalWidth / targetRatio;
    sourceY = (image.naturalHeight - sourceHeight) / 2;
  }
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, variant.width, variant.height);

  return new Promise<File>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("图片压缩失败"));
        return;
      }
      if (blob.type !== "image/webp") {
        reject(new Error("当前浏览器不支持 WebP 图片压缩"));
        return;
      }
      const base = file.name.replace(/\.[^.]+$/, "") || "course-cover";
      resolve(new File([blob], `${base}-${variant.suffix}.webp`, { type: blob.type }));
    }, "image/webp", variant.quality);
  });
}

export async function optimizeCourseCover(file: File) {
  const image = await loadImage(file);
  const [card, detail] = await Promise.all([
    renderCover(image, file, CARD_COVER),
    renderCover(image, file, DETAIL_COVER),
  ]);
  return { card, detail };
}
