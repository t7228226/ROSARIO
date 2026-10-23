export interface PreviewPerson {
  employeeId: string;
  name: string;
  isOfficer?: boolean;
  isTraining?: boolean;
}

export function uniquePreviewPeople(people: PreviewPerson[]): PreviewPerson[] {
  const byId = new Map<string, PreviewPerson>();
  for (const person of people) {
    const previous = byId.get(person.employeeId);
    byId.set(person.employeeId, {
      ...person,
      isOfficer: Boolean(previous?.isOfficer || person.isOfficer),
      isTraining: Boolean(previous?.isTraining || person.isTraining),
    });
  }
  return [...byId.values()];
}

export function previewName(person: { id: string; name: string }, people: Array<{ id: string; name: string }>) {
  return people.some((other) => other.id !== person.id && other.name === person.name)
    ? `${person.name}（${person.id}）`
    : person.name;
}
