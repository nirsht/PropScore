import type { SortKey } from "@/server/api/schemas/filter";

export const SORT_KEY_TO_FIELD: Record<SortKey, string> = {
  valueAdd: "valueAddWeightedAvg",
  price: "price",
  pricePerSqft: "pricePerSqft",
  pricePerUnit: "pricePerUnit",
  daysOnMls: "daysOnMls",
  postDate: "postDate",
  yearBuilt: "yearBuilt",
  density: "densityScore",
  vacancy: "vacancyScore",
  motivation: "motivationScore",
  location: "locationScore",
  rehab: "rehabScore",
  adu: "aduScore",
  valueAddAi: "aiValueAddWeightedAvg",
  densityAi: "aiDensityScore",
  vacancyAi: "aiVacancyScore",
  motivationAi: "aiMotivationScore",
};

export const FIELD_TO_SORT_KEY: Record<string, SortKey> = Object.entries(SORT_KEY_TO_FIELD).reduce(
  (acc, [k, v]) => ({ ...acc, [v]: k as SortKey }),
  {} as Record<string, SortKey>,
);
