export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--f-bg)] text-[var(--f-t1)]">
      {children}
    </div>
  )
}
