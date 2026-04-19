import type { AppBootstrap } from "../types";
import people from "../data/people.json";
import stations from "../data/stations.json";
import qualifications from "../data/qualifications.json";

export const mockBootstrap: AppBootstrap = {
  people,
  stations,
  qualifications,
};
