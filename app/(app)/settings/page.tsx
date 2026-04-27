"use client"

import { Settings, User, Bell, CreditCard, Key, CheckCircle2 } from "lucide-react"
import { SidebarInset, SidebarTrigger } from "@/components/ui/sidebar"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useState, useEffect } from "react"

function AnthropicKeySection() {
  const [key, setKey] = useState("")
  const [saved, setSaved] = useState(false)
  const [hasSaved, setHasSaved] = useState(false)
  const api = typeof window !== "undefined" ? (window as any).electronAPI : null

  useEffect(() => {
    if (!api) return
    api.getConfig().then((cfg: any) => {
      if (cfg?.anthropicApiKey) { setKey(cfg.anthropicApiKey); setHasSaved(true) }
    })
  }, [])

  if (!api) return null

  const save = async () => {
    await api.setAnthropicKey(key.trim())
    setHasSaved(true)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  return (
    <Card className="bg-card/50 border-violet-500/30">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Key className="h-4 w-4 text-violet-400" />
          <CardTitle className="text-base">Anthropic API Key</CardTitle>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500/20 text-violet-400 font-medium">Recommended</span>
        </div>
        <CardDescription>
          Powers analysis with Claude — Anthropic&apos;s most capable model for financial reasoning. If set, this takes priority over OpenAI.
          {" "}<a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer" className="underline text-foreground">Get a key →</a>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input
            type="password"
            placeholder="sk-ant-..."
            value={key}
            onChange={(e) => setKey(e.target.value)}
            className="font-mono text-sm"
          />
          <Button onClick={save} disabled={!key.trim()} size="sm">
            {saved ? <><CheckCircle2 className="h-4 w-4 mr-1.5" />Saved</> : "Save"}
          </Button>
        </div>
        {hasSaved && !saved && (
          <p className="text-xs text-muted-foreground">Key saved. Restart the app for it to take effect.</p>
        )}
      </CardContent>
    </Card>
  )
}

function OpenAIKeySection() {
  const [key, setKey] = useState("")
  const [saved, setSaved] = useState(false)
  const [hasSaved, setHasSaved] = useState(false)
  const api = typeof window !== "undefined" ? (window as any).electronAPI : null

  useEffect(() => {
    if (!api) return
    api.getConfig().then((cfg: any) => {
      if (cfg?.openaiApiKey) { setKey(cfg.openaiApiKey); setHasSaved(true) }
    })
  }, [])

  if (!api) return null

  const save = async () => {
    await api.setOpenAIKey(key.trim())
    setHasSaved(true)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  return (
    <Card className="bg-card/50 border-amber-500/30">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Key className="h-4 w-4 text-amber-500" />
          <CardTitle className="text-base">OpenAI API Key</CardTitle>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">Fallback</span>
        </div>
        <CardDescription>
          Used for analysis when no Anthropic key is set. Your key is stored locally on this Mac and never sent to our servers.
          {" "}<a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer" className="underline text-foreground">Get a key →</a>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2">
          <Input
            type="password"
            placeholder="sk-..."
            value={key}
            onChange={(e) => setKey(e.target.value)}
            className="font-mono text-sm"
          />
          <Button onClick={save} disabled={!key.trim()} size="sm">
            {saved ? <><CheckCircle2 className="h-4 w-4 mr-1.5" />Saved</> : "Save"}
          </Button>
        </div>
        {hasSaved && !saved && (
          <p className="text-xs text-muted-foreground">Key saved. Restart the app for it to take effect.</p>
        )}
      </CardContent>
    </Card>
  )
}

export default function SettingsPage() {
  return (
    <SidebarInset>
      <header className="h-14 flex items-center gap-4 border-b border-border px-4">
        <SidebarTrigger className="-ml-1" />
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Settings className="h-4 w-4" />
          <span>Settings</span>
        </div>
      </header>

      <div className="p-6 max-w-3xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="text-muted-foreground mt-1">
            Manage your account preferences and integrations.
          </p>
        </div>

        {/* Profile Section */}
        <Card className="bg-card/50">
          <CardHeader>
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">Profile</CardTitle>
            </div>
            <CardDescription>Your account information</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  defaultValue="John Doe"
                  className="bg-background"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  defaultValue="john@example.com"
                  className="bg-background"
                />
              </div>
            </div>
            <Button size="sm">Save Changes</Button>
          </CardContent>
        </Card>

        {/* AI Keys */}
        <AnthropicKeySection />
        <OpenAIKeySection />

        {/* Notifications */}
        <Card className="bg-card/50">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">Notifications</CardTitle>
            </div>
            <CardDescription>Configure your notification preferences</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Email Alerts</p>
                <p className="text-xs text-muted-foreground">
                  Receive deal alerts via email
                </p>
              </div>
              <Switch defaultChecked />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Weekly Digest</p>
                <p className="text-xs text-muted-foreground">
                  Summary of market trends
                </p>
              </div>
              <Switch defaultChecked />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Price Drop Alerts</p>
                <p className="text-xs text-muted-foreground">
                  Notify when tracked properties drop in price
                </p>
              </div>
              <Switch />
            </div>
          </CardContent>
        </Card>

        {/* API Keys */}
        <Card className="bg-card/50">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Key className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">API Integrations</CardTitle>
            </div>
            <CardDescription>Manage your data source connections</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border">
              <div>
                <p className="text-sm font-medium">RentCast API</p>
                <p className="text-xs text-muted-foreground">Connected</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                <span className="text-xs text-emerald-400">Active</span>
              </div>
            </div>
            <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border">
              <div>
                <p className="text-sm font-medium">FRED Economic Data</p>
                <p className="text-xs text-muted-foreground">Public API</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                <span className="text-xs text-emerald-400">Active</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Subscription */}
        <Card className="bg-card/50">
          <CardHeader>
            <div className="flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-base">Subscription</CardTitle>
            </div>
            <CardDescription>Manage your billing and plan</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Pro Plan</p>
                <p className="text-xs text-muted-foreground">
                  $49/month, billed monthly
                </p>
              </div>
              <Button variant="outline" size="sm">
                Manage
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </SidebarInset>
  )
}
