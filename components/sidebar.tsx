"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowRightFromLine,
  Calendar,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  ListChecks,
  Settings,
  UserCog,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  ACTOR_NAME_STORAGE_KEY,
  api,
  ApiError,
  DEFAULT_SERVICE_NAME,
  SERVICE_NAME_STORAGE_KEY,
  TODOS_CHANGED_EVENT,
} from "@/lib/client/api";
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
  { href: "/transfer", label: "이관", icon: ArrowRightFromLine },
  { href: "/todos", label: "할 일", icon: CheckSquare },
  { href: "/calendar", label: "캘린더", icon: Calendar },
  { href: "/settings", label: "설정", icon: Settings },
];

const COLLAPSED_KEY = "cc-simply-tasks:sidebar-collapsed";

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = React.useState(false);
  const [actorName, setActorName] = React.useState<string>("");
  const [serviceName, setServiceName] = React.useState<string>(DEFAULT_SERVICE_NAME);
  const [mounted, setMounted] = React.useState(false);
  const [nameDialogOpen, setNameDialogOpen] = React.useState(false);
  const [nameDraft, setNameDraft] = React.useState("");
  const [openTodoCount, setOpenTodoCount] = React.useState(0);

  const loadOpenTodoCount = React.useCallback(async () => {
    try {
      const res = await api.get<{ count: number }>("/api/todos/count", {
        query: { status: "OPEN" },
      });
      setOpenTodoCount(res.count);
    } catch (err) {
      if (!(err instanceof ApiError)) return;
      setOpenTodoCount(0);
    }
  }, []);

  React.useEffect(() => {
    setMounted(true);
    setCollapsed(window.localStorage.getItem(COLLAPSED_KEY) === "1");

    // 캐시된 서비스명 즉시 반영
    const cached = window.localStorage.getItem(SERVICE_NAME_STORAGE_KEY);
    if (cached) setServiceName(cached);

    // API에서 최신 서비스명 동기화
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        const name = data.service_name ?? DEFAULT_SERVICE_NAME;
        setServiceName(name);
        window.localStorage.setItem(SERVICE_NAME_STORAGE_KEY, name);
      })
      .catch(() => {/* 실패 시 캐시값 유지 */});

    const syncActorName = () => {
      setActorName(window.localStorage.getItem(ACTOR_NAME_STORAGE_KEY) ?? "");
    };
    syncActorName();
    void loadOpenTodoCount();

    const syncServiceName = () => {
      const name = window.localStorage.getItem(SERVICE_NAME_STORAGE_KEY) ?? DEFAULT_SERVICE_NAME;
      setServiceName(name);
    };

    window.addEventListener("storage", syncActorName);
    window.addEventListener("actor-name-changed", syncActorName);
    window.addEventListener("settings-changed", syncServiceName);
    window.addEventListener("focus", loadOpenTodoCount);
    window.addEventListener("visibilitychange", loadOpenTodoCount);
    window.addEventListener(TODOS_CHANGED_EVENT, loadOpenTodoCount);
    return () => {
      window.removeEventListener("storage", syncActorName);
      window.removeEventListener("actor-name-changed", syncActorName);
      window.removeEventListener("settings-changed", syncServiceName);
      window.removeEventListener("focus", loadOpenTodoCount);
      window.removeEventListener("visibilitychange", loadOpenTodoCount);
      window.removeEventListener(TODOS_CHANGED_EVENT, loadOpenTodoCount);
    };
  }, [loadOpenTodoCount]);

  React.useEffect(() => {
    void loadOpenTodoCount();
  }, [pathname, loadOpenTodoCount]);

  function toggleCollapsed() {
    const next = !collapsed;
    setCollapsed(next);
    window.localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
  }

  function openNameDialog() {
    setNameDraft(window.localStorage.getItem(ACTOR_NAME_STORAGE_KEY) ?? "");
    setNameDialogOpen(true);
  }

  function handleNameSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = nameDraft.trim();
    if (!trimmed) return;
    window.localStorage.setItem(ACTOR_NAME_STORAGE_KEY, trimmed);
    window.dispatchEvent(new CustomEvent("actor-name-changed", { detail: trimmed }));
    setActorName(trimmed);
    setNameDialogOpen(false);
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
          <Link href="/" className="truncate text-sm font-semibold tracking-tight">
            {serviceName}
          </Link>
        ) : (
          <span className="sr-only">{serviceName}</span>
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
                "relative flex h-9 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors",
                active
                  ? "bg-secondary text-secondary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                collapsed && "justify-center px-0",
              )}
              title={collapsed ? item.label : undefined}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {!collapsed ? (
                <>
                  <span className="min-w-0 flex-1">{item.label}</span>
                  {item.href === "/todos" && openTodoCount > 0 ? (
                    <span className="inline-flex min-w-[1.5rem] items-center justify-center rounded-full bg-rose-500 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-white tabular-nums">
                      {openTodoCount > 99 ? "99+" : openTodoCount}
                    </span>
                  ) : null}
                </>
              ) : item.href === "/todos" && openTodoCount > 0 ? (
                <span className="absolute right-1.5 top-1.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold leading-none text-white tabular-nums">
                  {openTodoCount > 9 ? "9+" : openTodoCount}
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>

      {/* 하단: 액터 + 테마 */}
      <div className="border-t p-2">
        {!collapsed ? (
          <div className="flex items-center justify-between gap-2">
            <button
              onClick={openNameDialog}
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
              onClick={openNameDialog}
              aria-label="이름 변경"
              title={mounted ? actorName || "이름 미설정" : undefined}
            >
              <UserCog className="h-4 w-4" />
            </Button>
            <ThemeToggle />
          </div>
        )}
      </div>

      <Dialog open={nameDialogOpen} onOpenChange={setNameDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>이름 변경</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleNameSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="sidebar-name-input">표시 이름</Label>
              <Input
                id="sidebar-name-input"
                autoFocus
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                placeholder=""
                maxLength={32}
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setNameDialogOpen(false)}>
                취소
              </Button>
              <Button type="submit" disabled={!nameDraft.trim()}>
                저장
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
