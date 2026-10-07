import { mealsRequest, operationId, type SelectionItem } from "./pi-meals-api";
export interface WeekAllocation {
  date: string;
  member: "James" | "Manon";
  batchId: string | null;
  portions: number;
  away: boolean;
  freezeConfirmed: boolean;
  uncoveredReason?: string;
}
export interface WeekRoutine {
  id: string;
  meal: "breakfast" | "light_dinner";
  note: string;
  itemId?: string;
}
export interface MealWeek {
  id: string;
  revision: number;
  selectionId: string;
  selectionRevision: number;
  startDate: string;
  sessions: [string, string];
  needsRefresh: boolean;
  batches: Array<{
    id: string;
    itemId: string;
    snapshot: SelectionItem;
    session: 0 | 1;
    status: "planned" | "cooked" | "skipped";
    cookedAt?: string;
    feedback?: "make_again" | "too_much_effort" | "not_this_week";
  }>;
  allocations: WeekAllocation[];
  routines: WeekRoutine[];
  batchesSummary: Array<{
    id: string;
    yield: number;
    allocated: number;
    remaining: number;
  }>;
  lunches: Array<
    WeekAllocation & {
      coverage: string;
      freezeRequired: boolean;
      storageNote: string;
      ingredientWarnings: string[];
    }
  >;
}
export type WeekCommand =
  | { type: "set_sessions"; sessions: [string, string] }
  | { type: "set_batch_session"; batchId: string; session: 0 | 1 }
  | {
      type: "set_status";
      batchId: string;
      status: "planned" | "cooked" | "skipped";
      cookedAt?: string;
    }
  | { type: "set_allocations"; allocations: WeekAllocation[] }
  | { type: "set_routines"; routines: WeekRoutine[] }
  | {
      type: "set_feedback";
      batchId: string;
      feedback: "make_again" | "too_much_effort" | "not_this_week" | null;
    }
  | { type: "refresh_selection" };
export const weekApi = {
  get: (id: string) =>
    mealsRequest<MealWeek>(`/pi-meals/weeks/${encodeURIComponent(id)}`),
  repeat: (sourceWeekId: string, startDate: string) =>
    mealsRequest<MealWeek>("/pi-meals/weeks", "POST", {
      operationId: operationId(),
      sourceWeekId,
      startDate,
    }),
  list: () => mealsRequest<MealWeek[]>("/pi-meals/weeks"),
  create: (selectionId: string, startDate: string) =>
    mealsRequest<MealWeek>("/pi-meals/weeks", "POST", {
      operationId: operationId(),
      selectionId,
      startDate,
    }),
  command: (week: MealWeek, command: WeekCommand) =>
    mealsRequest<MealWeek>(`/pi-meals/weeks/${week.id}/commands`, "POST", {
      operationId: operationId(),
      expectedRevision: week.revision,
      command,
    }),
};
