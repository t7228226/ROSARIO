import { Component, type ErrorInfo, type ReactNode } from "react";

export default class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("Application render failed", error, info.componentStack); }
  render() {
    return this.state.failed ? <section className="fatal-error-panel" role="alert">
      <h1>畫面暫時無法顯示</h1>
      <p>未送出的編輯不會自動寫入。請重新整理；若持續發生，請提供發生時間與操作步驟。</p>
      <button type="button" onClick={() => window.location.reload()}>重新整理</button>
    </section> : this.props.children;
  }
}
