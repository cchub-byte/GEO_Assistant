import { percentage } from "@/lib/utils";

export function StatCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="card stat-card">
      <div className="muted">{label}</div>
      <div className="stat-value">{value}</div>
      {hint ? <div className="hint">{hint}</div> : null}
    </div>
  );
}

export function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="section">
      <div className="section-head">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "good" | "warn" | "bad" | "info" }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Bar({ value, label }: { value: number; label?: string }) {
  const safe = Math.max(0, Math.min(1, value || 0));
  return (
    <div className="bar-wrap" title={label || percentage(safe)}>
      <div className="bar-fill" style={{ width: `${safe * 100}%` }} />
      <span>{label || percentage(safe)}</span>
    </div>
  );
}

export function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      <p>{body}</p>
    </div>
  );
}

export function Nav() {
  const items = [
    ["总览", "/"],
    ["采样", "/sampling"],
    ["Query集", "/sampling/query-clusters"],
    ["引用查询", "/references"],
    ["内容资产", "/content"],
    ["内容写作", "/writing"],
    ["设置", "/settings"]
  ];
  return (
    <nav className="nav">
      <div className="brand">GEO System</div>
      {items.map(([label, href]) => (
        <a key={href} href={href}>
          {label}
        </a>
      ))}
    </nav>
  );
}
