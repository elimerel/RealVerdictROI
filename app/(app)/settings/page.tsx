"use client"

export default function SettingsPage() {
  return (
    <div
      className="w-full h-full flex flex-col items-start"
      style={{ background: "#0a0a0c", padding: "60px 48px", color: "rgba(245,245,247,0.95)" }}
    >
      <h1
        className="text-[24px] font-semibold tracking-[-0.02em] mb-2"
        style={{ color: "rgba(255,255,255,1.0)" }}
      >
        Settings
      </h1>
      <p
        className="text-[13px]"
        style={{ color: "rgba(235,235,245,0.60)" }}
      >
        Settings UI coming soon.
      </p>
    </div>
  )
}
