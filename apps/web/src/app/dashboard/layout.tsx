'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useSession, signOut } from 'next-auth/react';
import {
  LayoutDashboard,
  TrendingUp,
  Search,
  Users,
  Pencil,
  Image,
  Calendar,
  Send,
  BarChart3,
  SearchCheck,
  Workflow,
  Globe,
  Settings,
  CreditCard,
  Bell,
  Menu,
  X,
  ChevronDown,
  Plus,
  Command,
  Sun,
  Moon,
  Laptop,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';

const navigation = [
  {
    category: 'Main',
    items: [
      { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
      { name: 'AI Writer', href: '/writer', icon: Pencil, badge: 'New' },
      { name: 'Articles', href: '/articles', icon: Pencil },
      { name: 'Scheduler', href: '/scheduler', icon: Calendar },
    ],
  },
  {
    category: 'Research',
    items: [
      { name: 'Trends', href: '/trends', icon: TrendingUp },
      { name: 'Keywords', href: '/keywords', icon: Search },
      { name: 'Competitors', href: '/competitors', icon: Users },
      { name: 'SEO Audit', href: '/seo', icon: SearchCheck },
    ],
  },
  {
    category: 'Distribution',
    items: [
      { name: 'Publishing', href: '/publishing', icon: Send },
      { name: 'Website Builder', href: '/website', icon: Globe },
      { name: 'Analytics', href: '/analytics', icon: BarChart3 },
      { name: 'Workflows', href: '/workflows', icon: Workflow },
    ],
  },
  {
    category: 'Settings',
    items: [
      { name: 'Images', href: '/images', icon: Image },
      { name: 'Billing', href: '/billing', icon: CreditCard },
      { name: 'Notifications', href: '/notifications', icon: Bell },
      { name: 'Settings', href: '/settings', icon: Settings },
    ],
  },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const { data: session } = useSession();
  const { theme, setTheme } = useTheme();

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r bg-card transition-transform lg:static lg:translate-x-0',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        {/* Logo */}
        <div className="flex h-14 items-center gap-2 border-b px-4">
          <Link href="/dashboard" className="flex items-center gap-2 font-bold text-lg">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              A
            </div>
            <span>AutoBlog AI</span>
          </Link>
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto lg:hidden"
            onClick={() => setSidebarOpen(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Navigation */}
        <ScrollArea className="flex-1 px-3 py-4">
          {navigation.map((group) => (
            <div key={group.category} className="mb-6">
              <h3 className="mb-2 px-4 text-xs font-semibold uppercase text-muted-foreground">
                {group.category}
              </h3>
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const isActive = pathname.startsWith(item.href);
                  const Icon = item.icon;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={cn(
                          'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                          isActive
                            ? 'bg-primary/10 text-primary'
                            : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                        )}
                      >
                        <Icon className="h-4 w-4" />
                        <span>{item.name}</span>
                        {item.badge && (
                          <Badge variant="secondary" className="ml-auto text-[10px] px-1.5">
                            {item.badge}
                          </Badge>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </ScrollArea>

        {/* User */}
        <div className="border-t p-4">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="w-full justify-start gap-2 px-2">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="text-xs bg-primary/10 text-primary">
                    {session?.user?.name ? session.user.name.substring(0, 2).toUpperCase() : 'U'}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 text-left">
                  <p className="text-sm font-medium leading-none">{session?.user?.name || 'User'}</p>
                  <p className="text-xs text-muted-foreground">{session?.user?.email}</p>
                </div>
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56" align="end" side="top">
              <DropdownMenuLabel>My Account</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => router.push('/settings')}>
                Profile Settings
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => router.push('/billing')}>
                Billing
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive"
                onClick={() => signOut({ callbackUrl: '/auth/login' })}
              >
                Sign Out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>

      {/* Backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex h-14 items-center gap-4 border-b px-4 lg:px-6">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>

          <div className="flex-1" />

          {/* Quick command */}
          <Button variant="outline" size="sm" className="hidden md:flex gap-2 text-muted-foreground">
            <Command className="h-4 w-4" />
            <span>Quick Actions...</span>
            <kbd className="ml-4 text-[10px] bg-muted rounded px-1.5 py-0.5">⌘K</kbd>
          </Button>

          {/* Theme toggle */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
                <span className="sr-only">Toggle theme</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setTheme('light')}>
                <Sun className="mr-2 h-4 w-4" /> Light
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme('dark')}>
                <Moon className="mr-2 h-4 w-4" /> Dark
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme('system')}>
                <Laptop className="mr-2 h-4 w-4" /> System
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* New Article */}
          <Button size="sm">
            <Plus className="mr-2 h-4 w-4" /> New Article
          </Button>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
