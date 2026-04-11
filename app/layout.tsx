import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "cc-simply-tasks",
  description: "내부용 작업 관리 시스템",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
