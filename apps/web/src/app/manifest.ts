import type { MetadataRoute } from "next";
import { SITE_DESCRIPTION, SITE_NAME } from "@/lib/site";

// Lets a phone "install" Wola to the home screen with the right name and icon
// (staff apply for loans on cheap handsets).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE_NAME} — staff loans`,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    start_url: "/",
    display: "standalone",
    background_color: "#F4F7F5",
    theme_color: "#16A34A",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/apple-icon.png", sizes: "180x180", type: "image/png" },
    ],
  };
}
