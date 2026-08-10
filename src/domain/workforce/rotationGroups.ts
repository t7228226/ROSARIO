export type AlternatingRotationGroups<T> = {
  groupA: T[];
  groupB: T[];
};

export function splitAlternatingRotationGroups<T>(
  items: readonly T[],
  startingGroup: "A" | "B" = "A",
): AlternatingRotationGroups<T> {
  return items.reduce<AlternatingRotationGroups<T>>(
    (groups, item, index) => {
      const goesToA = startingGroup === "A" ? index % 2 === 0 : index % 2 !== 0;
      if (goesToA) groups.groupA.push(item);
      else groups.groupB.push(item);
      return groups;
    },
    { groupA: [], groupB: [] },
  );
}

export function splitBalancedRotationRows<T>(rows: readonly (readonly T[])[]): AlternatingRotationGroups<T>[] {
  let groupACount = 0;
  let groupBCount = 0;

  return rows.map((items) => {
    const groups = splitAlternatingRotationGroups(items, groupACount <= groupBCount ? "A" : "B");
    groupACount += groups.groupA.length;
    groupBCount += groups.groupB.length;
    return groups;
  });
}
