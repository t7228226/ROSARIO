import type { ReactNode } from "react";

interface LayoutProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
}

export default function Layout({ title, subtitle, children }: LayoutProps) {
  return (
    <section className="page-section">
      {title ? (
        <div className="page-header">
          <div>
            <h2>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
        </div>
      ) : null}
      {children}
    </section>
  );
}
