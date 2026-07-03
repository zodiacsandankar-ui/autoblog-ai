import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowRight, Zap, Globe, TrendingUp, Shield, BarChart3, Send } from 'lucide-react';

const features = [
  {
    icon: Zap,
    title: 'AI-Powered Writing',
    description: 'Generate SEO-optimized, human-like blog articles with DeepSeek AI. 36+ article elements auto-generated.',
  },
  {
    icon: TrendingUp,
    title: 'Trend Discovery',
    description: 'Automatically discover trending topics from 12+ sources. Never run out of content ideas.',
  },
  {
    icon: Globe,
    title: 'Multi-Platform Publishing',
    description: 'Publish to WordPress, Ghost, Medium, Shopify, and more. Built-in website hosting included.',
  },
  {
    icon: BarChart3,
    title: 'SEO Optimization',
    description: '20-point SEO checklist auto-applied. Schema markup, keyword optimization, readability scoring.',
  },
  {
    icon: Send,
    title: 'Content Scheduling',
    description: 'Intelligent scheduling with optimal time detection. Queue, bulk schedule, and evergreen rotation.',
  },
  {
    icon: Shield,
    title: 'Enterprise Security',
    description: 'OWASP Top 10 protection, encryption at rest/transit, RBAC, SSO, MFA, and audit logging.',
  },
];

const plans = [
  {
    name: 'Free',
    price: '$0',
    description: 'Get started with basic features',
    features: ['5 articles/month', '1 project', '1 user', 'Basic AI models', 'Community support'],
  },
  {
    name: 'Professional',
    price: '$99',
    description: 'For professional bloggers and small teams',
    features: ['200 articles/month', '10 projects', '10 users', 'All AI models', 'Custom domain', 'Priority support', 'API access'],
    highlighted: true,
  },
  {
    name: 'Enterprise',
    price: '$999',
    description: 'For large organizations and agencies',
    features: ['Unlimited articles', 'Unlimited projects', '25+ users', 'All AI models', 'White label', 'SSO + SAML', 'Dedicated support', 'SLA guarantee'],
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b">
        <div className="container mx-auto flex h-16 items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2 font-bold text-xl">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              A
            </div>
            AutoBlog AI
          </Link>
          <nav className="hidden md:flex items-center gap-6">
            <Link href="#features" className="text-sm text-muted-foreground hover:text-foreground">Features</Link>
            <Link href="#pricing" className="text-sm text-muted-foreground hover:text-foreground">Pricing</Link>
            <Link href="#api" className="text-sm text-muted-foreground hover:text-foreground">API</Link>
            <Link href="/docs" className="text-sm text-muted-foreground hover:text-foreground">Docs</Link>
          </nav>
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/auth/login">Sign In</Link>
            </Button>
            <Button size="sm" asChild>
              <Link href="/auth/register">Start Free Trial</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="py-20 lg:py-28">
        <div className="container mx-auto px-4 text-center max-w-4xl">
          <Badge variant="secondary" className="mb-6">
            Powered by DeepSeek AI
          </Badge>
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
            Your AI-Powered{' '}
            <span className="text-primary">Autonomous Blogging</span>{' '}
            Platform
          </h1>
          <p className="mt-6 text-lg text-muted-foreground max-w-2xl mx-auto">
            Generate SEO-optimized articles, discover trending topics, and publish to multiple platforms — all automated with enterprise-grade AI. Built-in website hosting included.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <Button size="lg" asChild>
              <Link href="/auth/register">
                Start Free Trial <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="#features">See How It Works</Link>
            </Button>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Free 14-day trial. No credit card required.
          </p>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-20 bg-muted/30">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold">Everything You Need to Automate Blogging</h2>
            <p className="mt-3 text-muted-foreground">
              From topic discovery to publishing — fully automated with AI
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 max-w-6xl mx-auto">
            {features.map((feature) => {
              const Icon = feature.icon;
              return (
                <Card key={feature.title} className="border-2">
                  <CardContent className="p-6">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 mb-4">
                      <Icon className="h-5 w-5 text-primary" />
                    </div>
                    <h3 className="font-semibold mb-2">{feature.title}</h3>
                    <p className="text-sm text-muted-foreground">{feature.description}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-20">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold">Simple, Transparent Pricing</h2>
            <p className="mt-3 text-muted-foreground">
              Start free, upgrade as you grow
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-3 max-w-5xl mx-auto">
            {plans.map((plan) => (
              <Card
                key={plan.name}
                className={plan.highlighted ? 'border-primary border-2 shadow-lg relative' : ''}
              >
                {plan.highlighted && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge>Most Popular</Badge>
                  </div>
                )}
                <CardContent className="p-6">
                  <h3 className="font-semibold text-lg">{plan.name}</h3>
                  <div className="mt-2 mb-1">
                    <span className="text-4xl font-bold">{plan.price}</span>
                    <span className="text-sm text-muted-foreground">/month</span>
                  </div>
                  <p className="text-sm text-muted-foreground mb-4">{plan.description}</p>
                  <ul className="space-y-2 mb-6">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-center gap-2 text-sm">
                        <svg className="h-4 w-4 text-success flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        {f}
                      </li>
                    ))}
                  </ul>
                  <Button
                    className="w-full"
                    variant={plan.highlighted ? 'default' : 'outline'}
                    asChild
                  >
                    <Link href="/auth/register">
                      {plan.name === 'Free' ? 'Get Started' : 'Start Free Trial'}
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 bg-primary text-primary-foreground">
        <div className="container mx-auto px-4 text-center max-w-3xl">
          <h2 className="text-3xl font-bold">Ready to Automate Your Blog?</h2>
          <p className="mt-4 text-primary-foreground/80">
            Join thousands of content creators who use AutoBlog AI to grow their online presence.
          </p>
          <div className="mt-8">
            <Button size="lg" variant="secondary" asChild>
              <Link href="/auth/register">
                Start Your Free Trial <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t py-12">
        <div className="container mx-auto px-4">
          <div className="grid gap-8 md:grid-cols-4">
            <div>
              <div className="flex items-center gap-2 font-bold mb-3">
                <div className="flex h-7 w-7 items-center justify-center rounded bg-primary text-primary-foreground text-xs">A</div>
                AutoBlog AI
              </div>
              <p className="text-sm text-muted-foreground">
                Enterprise-grade AI autonomous blogging platform.
              </p>
            </div>
            <div>
              <h4 className="font-semibold mb-3 text-sm">Product</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><Link href="#features">Features</Link></li>
                <li><Link href="#pricing">Pricing</Link></li>
                <li><Link href="/api">API</Link></li>
                <li><Link href="/changelog">Changelog</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-3 text-sm">Resources</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><Link href="/docs">Documentation</Link></li>
                <li><Link href="/blog">Blog</Link></li>
                <li><Link href="/guides">Guides</Link></li>
                <li><Link href="/support">Support</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-3 text-sm">Company</h4>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><Link href="/about">About</Link></li>
                <li><Link href="/privacy">Privacy</Link></li>
                <li><Link href="/terms">Terms</Link></li>
                <li><Link href="/contact">Contact</Link></li>
              </ul>
            </div>
          </div>
          <div className="mt-8 pt-8 border-t text-center text-xs text-muted-foreground">
            &copy; {new Date().getFullYear()} AutoBlog AI. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
