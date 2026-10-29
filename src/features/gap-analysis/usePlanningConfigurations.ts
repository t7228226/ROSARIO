import { useState } from "react";
import { changeConfiguration, emptyConfigurationSession, resetConfiguration, undoConfiguration, type ConfigurationSession, type PlanningConfiguration } from "../../domain/workforce/configurationSession";
import type { ShiftMode, TeamName } from "../../types";

export function usePlanningConfigurations(userId: string) {
  const [state, setState] = useState<{ owner: string; sessions: Record<string, ConfigurationSession> }>({ owner: userId, sessions: {} });
  const key = (team: TeamName, day: ShiftMode) => `${team}|${day}`;
  const get = (team: TeamName, day: ShiftMode) => state.owner === userId ? state.sessions[key(team, day)] || emptyConfigurationSession : emptyConfigurationSession;
  function update(team: TeamName, day: ShiftMode, reducer: (session: ConfigurationSession) => ConfigurationSession) {
    setState((current) => {
      const sessions = current.owner === userId ? current.sessions : {};
      const scope = key(team, day);
      return { owner: userId, sessions: { ...sessions, [scope]: reducer(sessions[scope] || emptyConfigurationSession) } };
    });
  }
  return {
    get,
    change: (team: TeamName, day: ShiftMode, next: PlanningConfiguration | ((current: PlanningConfiguration) => PlanningConfiguration)) => update(team, day, (session) => changeConfiguration(session, typeof next === "function" ? next(session.configuration) : next)),
    reset: (team: TeamName, day: ShiftMode) => update(team, day, resetConfiguration),
    undo: (team: TeamName, day: ShiftMode) => update(team, day, undoConfiguration),
    enable: (team: TeamName, day: ShiftMode, enabled: boolean) => update(team, day, (session) => ({ ...session, enabled, touched: true })),
    applyDefault: (team: TeamName, day: ShiftMode, configuration: PlanningConfiguration) => update(team, day, (session) => session.touched ? session : changeConfiguration(session, configuration)),
  };
}
