"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  ListChecks,
  Users,
  UserCog,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { ACTOR_NAME_STORAGE_KEY } from "@/lib/client/api";
import { cn } from "@/lib/utils";

/**
 * 좌측 사이드바.
 *
 * - 폭 240px (collapsed 64px)
 * - 라우트 기반 활성 항목 하이라이트 (`startsWith` 매칭)
 * - 하단에 액터 이름 표시 + 변경 + 다크 토글
 *
 * 접힘 상태는 localStorage에 저장 → 새로고침 후에도 유지.
 */

type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  exact?: boolean;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "홈", icon: LayoutDashboard, exact: true },
  { href: "/work-items", label: "작업", icon: ListChecks },
  { href: "/calendar", label: "캘린더", icon: Calendar },
  { href: "/members", label: "멤버", icon: Users },
];

const COLLAPSED_KEY = "cc-simply-tasks:sidebar-collapsed";

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = React.useState(false);
  const [actorName, setActorName] = React.useState<string>("");
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
    setCollapsed(window.localStorage.getItem(COLLAPSED_KEY) === "1");
    const sync = () => {
      setActorName(window.localStorage.getItem(ACTOR_NAME_STORAGE_KEY) ?? "");
    };
    sync();
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    window.localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
  }

  function changeActorName() {
    const current = window.localStorage.getItem(ACTOR_NAME_STORAGE_KEY) ?? "";
    const next = window.prompt("표시 이름을 입력하세요", current)?.trim();
    if (next) {
      window.localStorage.setItem(ACTOR_NAME_STORAGE_KEY, next);
      setActorName(next);
    }
  }

  return (
    <aside
      className={cn(
        "sticky top-0 flex h-screen shrink-0 flex-col border-r bg-card transition-[width] duration-200",
        collapsed ? "w-16" : "w-60",
      )}
    >
      {/* 헤더 */}
      <div className="flex h-14 items-center justify-between border-b px-3">
        {!collapsed ? (
          <Link
            href="/"
            className="text-sm font-semibold tracking-tight"
          >
            cc-simply-tasks
          </Link>
        ) : (
          <span className="sr-only">cc-simply-tasks</span>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleCollapsed}
          aria-label={collapsed ? "사이드바 열기" : "사이드바 접기"}
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4" />
          ) : (
            <ChevronLeft className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* 네비게이션 */}
      <nav className="flex-1 space-y-1 p-2">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = item.exact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex h-9 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors",
                active
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                collapsed && "justify-center px-0",
              )}
              title={collapsed ? item.label : undefined}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!collapsed ? <span>{item.label}</span> : null}
            </Link>
          );
        })}
      </nav>

      {/* 하단: 액터 + 테마 */}
      <div className="border-t p-2">
        {!collapsed ? (
          <div className="flex items-center justify-between gap-2">
            <button
              onClick={changeActorName}
              className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
              title="이름 변경"
            >
              <UserCog className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate">
                {mounted ? actorName || "이름 미설정" : "..."}
              </span>
            </button>
            <ThemeToggle />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={changeActorName}
              aria-label="이름 변경"
              title={mounted ? actorName || "이름 미설정" : undefined}
            >
              <UserCog className="h-4 w-4" />
            </Button>
            <ThemeToggle />
          </div>
        )}
      </div>
    </aside>
  );
}
