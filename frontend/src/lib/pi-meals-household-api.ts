import {
  mealsRequest,
  operationId,
  type SelectionItem,
  type RecipeSelection,
} from "./pi-meals-api";
import type { MealWeek } from "./pi-meals-week-api";
export interface HouseholdProfile {
  version: 1;
  confirmed: boolean;
  rotationRecipeIds: string[];
  people: Array<{
    member: "James" | "Manon";
    homeLunchDays: number[];
    portions: number;
  }>;
  exclusions: Array<{
    subject: "James" | "Manon" | "household";
    ingredient: string;
  }>;
  preferences: Array<{
    subject: "James" | "Manon" | "household";
    note: string;
  }>;
  routines: Array<{
    id: string;
    meal: "breakfast" | "light_dinner";
    note: string;
    weeklyRequirements: Array<{ name: string; quantity: number; unit: string }>;
    bakeRecipeId?: string;
    bakeServings?: number;
  }>;
}
export interface HouseholdDocument {
  id: string;
  revision: number;
  data: { profile: HouseholdProfile; author: string };
  updatedAt: string;
}
export interface InterviewNotes {
  confirmed: false;
  source: string;
  notes: string[];
  gaps: string[];
}
export const householdApi = {
  read: () =>
    mealsRequest<{
      household: HouseholdDocument | null;
      interviewNotes: InterviewNotes;
    }>("/pi-meals/household"),
  candidates: (options: { expanded?: boolean; search?: string } = {}) =>
    mealsRequest<{
      cards: Array<{
        recipe: SelectionItem;
        reason: string;
        confirmedRotation: boolean;
      }>;
      gaps: string[];
    }>(
      `/pi-meals/household/candidates?${new URLSearchParams({ expanded: String(options.expanded ?? false), ...(options.search ? { search: options.search } : {}) })}`,
    ),
  save: (revision: number, profile: HouseholdProfile, op = operationId()) =>
    mealsRequest<HouseholdDocument>("/pi-meals/household/commands", "POST", {
      operationId: op,
      expectedRevision: revision,
      profile,
    }),
  prepare: (
    revision: number,
    startDate: string,
    away: Array<{ date: string; member: "James" | "Manon" }>,
    temporaryExclusions: string[],
    op: string,
  ) =>
    mealsRequest<{
      week: MealWeek;
      selection: RecipeSelection;
      warnings: string[];
    }>("/pi-meals/household/prepare", "POST", {
      operationId: op,
      expectedRevision: revision,
      startDate,
      away,
      temporaryExclusions,
    }),
};
