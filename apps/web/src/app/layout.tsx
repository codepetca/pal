import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "CodePetPal",
  description: "A gamified learning companion",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
