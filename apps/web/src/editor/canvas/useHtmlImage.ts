import { useEffect, useState } from "react";

/** 画像を読み込み、読み込めたら HTMLImageElement を返す */
export function useHtmlImage(src: string | undefined) {
  const [image, setImage] = useState<HTMLImageElement>();
  useEffect(() => {
    if (!src) {
      setImage(undefined);
      return;
    }
    const img = new window.Image();
    img.onload = () => setImage(img);
    img.src = src;
    return () => {
      img.onload = null;
    };
  }, [src]);
  return image;
}
