"use client";

import * as React from "react";
import { Sidebar } from "@/components/sidebar";
import { ActorNameGate } from "@/components/actor-name-gate";
import { Toaster } from "@/components/toaster";

/**
 * 모든 페이지를 감싸는 클라이언트 셸.
 * - 좌측 사이드바
 * - 우측 메인 콘텐츠
 * - 액터 이름 강제 게이트 (최초 진입 시 모달)
 * - 전역 토스트 렌더러
 *
 * RootLayout(서버 컴포넌트)에서 children 을 받아 그대로 렌더한다.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen w-full overflow-hidden">
      <Sidebar />
      <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
      <ActorNameGate />
      <Toaster />
    </div>
  );
}
