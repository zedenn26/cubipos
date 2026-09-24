import type { MetadataRoute } from "next";
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CubiPOS by Cubixtop",
    short_name: "CubiPOS",
    description: "Secure retail point of sale and inventory management",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f7f9",
    theme_color: "#17ad6b",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
