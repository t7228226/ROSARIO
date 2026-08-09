import { TEAM_OPTIONS } from "../../lib/selectors";
import type { Person, TeamName } from "../../types";

export interface NewPersonValidation {
  person: Person;
  error: string;
}

export function createEmptyPersonDraft(): Person {
  return {
    id: "",
    name: "",
    shift: TEAM_OPTIONS[0],
    role: "技術員",
    nationality: "",
    employmentStatus: "在職",
    note: "",
    aDay1: "",
    aDay2: "",
    bDay1: "",
    bDay2: "",
  };
}

export function buildPersonProfilePayload(person: Person): Record<string, unknown> {
  return {
    id: person.id,
    name: person.name,
    shift: person.shift,
    role: person.role,
    nationality: person.nationality,
    employmentStatus: person.employmentStatus,
    note: person.note || "",
    aDay1: person.aDay1 || "",
    aDay2: person.aDay2 || "",
    bDay1: person.bDay1 || "",
    bDay2: person.bDay2 || "",
  };
}

export function prepareNewPerson(draft: Person, existingPeople: Person[]): NewPersonValidation {
  const person: Person = {
    ...draft,
    id: draft.id.trim().toUpperCase(),
    name: draft.name.trim(),
    shift: draft.shift.trim(),
    role: draft.role.trim() || "技術員",
    nationality: draft.nationality.trim(),
    employmentStatus: draft.employmentStatus.trim() || "在職",
    note: draft.note?.trim() || "",
    aDay1: draft.aDay1?.trim() || "",
    aDay2: draft.aDay2?.trim() || "",
    bDay1: draft.bDay1?.trim() || "",
    bDay2: draft.bDay2?.trim() || "",
  };

  if (!person.id || !person.name || !person.shift) {
    return { person, error: "新增人員前，請完整填寫工號、姓名與班別。" };
  }
  if (!TEAM_OPTIONS.includes(person.shift as TeamName)) {
    return { person, error: "班別必須選擇系統既有的四個班別之一。" };
  }
  if (existingPeople.some((item) => item.id.trim().toUpperCase() === person.id)) {
    return { person, error: `工號 ${person.id} 已存在，請改用編輯人員資料。` };
  }

  return { person, error: "" };
}
