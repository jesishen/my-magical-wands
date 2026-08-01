import type { Metadata, Viewport } from "next";
import StageMount from "@/components/StageMount";
import "./globals.css";

export const metadata: Metadata = {
  title: "Magical Wand",
  description:
    "Your finger is a wand. Draw in the air with your camera — flowers, constellations, spells, creatures.",
  openGraph: {
    title: "Magical Wand",
    description: "Your finger is a wand. Draw in the air with your camera.",
    type: "website",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#0b0f0c",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* Lives in the layout so switching wands never restarts the camera. */}
        <StageMount />
        {children}
      </body>
    </html>
  );
}
