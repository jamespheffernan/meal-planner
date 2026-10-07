/** Display only: original quantities remain unchanged in forms and commands. */
export function formatQuantity(quantity: number | null, unit: string): string {
  if (quantity === null || !Number.isFinite(quantity)) return "Check amount";
  if (unit === "to_taste") return quantity === 0 ? "0" : "to taste";
  const digits = Math.abs(quantity) < 10 ? 2 : 1;
  // Avoid displaying a positive requirement as zero after rounding.
  const amount =
    quantity > 0 && quantity < 0.01
      ? "<0.01"
      : new Intl.NumberFormat("en-GB", {
          maximumFractionDigits: digits,
        }).format(quantity);
  return `${amount}${unit ? ` ${unit}` : ""}`;
}
