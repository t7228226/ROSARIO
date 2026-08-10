import {
  UI_THEME_OPTIONS,
  type UiThemeKey,
} from "../domain/preferences/uiTheme";

interface ThemePickerProps {
  value: UiThemeKey;
  onChange: (theme: UiThemeKey) => void;
  compact?: boolean;
}

export default function ThemePicker({ value, onChange, compact = false }: ThemePickerProps) {
  return (
    <section className={`theme-picker${compact ? " is-compact" : ""}`} aria-labelledby={compact ? undefined : "theme-picker-title"}>
      {!compact ? (
        <div className="theme-picker-heading">
          <strong id="theme-picker-title">介面主題</strong>
          <span>全站套用並自動保留</span>
        </div>
      ) : null}
      <div className="theme-option-grid" role="group" aria-label="選擇全站介面主題">
        {UI_THEME_OPTIONS.map((option) => (
          <button
            key={option.key}
            type="button"
            className="theme-option"
            data-theme-option={option.key}
            aria-pressed={value === option.key}
            onClick={() => onChange(option.key)}
            title={option.description}
          >
            <span className="theme-option-swatch" aria-hidden="true" />
            <span className="theme-option-copy">
              <strong>{option.label}</strong>
              {!compact ? <small>{option.description}</small> : null}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
