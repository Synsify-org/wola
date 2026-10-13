import { shareImage } from "./share-image";

export const alt = "Wola — staff loan management";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return shareImage(size);
}
