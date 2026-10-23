export function coverageConclusion(required: number, shortage: number, loading = false) {
  if (loading) return { state: "loading" as const, label: "資料載入中" };
  if (!Number.isFinite(required) || required <= 0) return { state: "unconfigured" as const, label: "尚未設定最低需求" };
  if (!Number.isFinite(shortage) || shortage < 0 || shortage > required) return { state: "invalid" as const, label: "分析結果待核對" };
  return shortage > 0 ? { state: "shortage" as const, label: `仍缺 ${shortage} 人` } : { state: "covered" as const, label: "最低需求已覆蓋" };
}
