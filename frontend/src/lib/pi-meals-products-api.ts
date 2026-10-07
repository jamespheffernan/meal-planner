import { mealsRequest, operationId, type BasketProposal } from "./pi-meals-api";
export interface MealProduct {
  productId: string;
  name: string;
  price: number | null;
  imageUrl: string | null;
  productUrl: string;
  packLabel?: string;
  packQuantity?: number;
  packUnit?: string;
}
export const productsApi = {
  search: (query: string) =>
    mealsRequest<{ products: MealProduct[] }>(
      `/pi-meals/baskets/products?q=${encodeURIComponent(query)}`,
    ),
  stopAside: (basket: BasketProposal) =>
    mealsRequest<BasketProposal>(
      `/pi-meals/baskets/${encodeURIComponent(basket.id)}/stop-aside`,
      "POST",
      { operationId: operationId(), expectedRevision: basket.revision },
    ),
  completeAside: async (basket: BasketProposal) => {
    const receipt = basket.receipt as
      { sessionId?: string; reviewToken?: string } | undefined;
    if (!receipt?.sessionId || !receipt.reviewToken)
      throw new Error(
        "Stop Aside first, then review the stopped trolley before confirming.",
      );
    return mealsRequest<BasketProposal>(
      `/pi-meals/baskets/${encodeURIComponent(basket.id)}/finish-aside`,
      "POST",
      {
        operationId: operationId(),
        expectedRevision: basket.revision,
        confirmedTrolley: true,
        stoppedSessionId: receipt.sessionId,
        reviewToken: receipt.reviewToken,
      },
    );
  },
  aside: (basket: BasketProposal) =>
    mealsRequest<BasketProposal>(
      `/pi-meals/baskets/${encodeURIComponent(basket.id)}/open-aside`,
      "POST",
      { operationId: operationId(), expectedRevision: basket.revision },
    ),
};
