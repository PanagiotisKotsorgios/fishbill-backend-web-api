/**
 * Calculate totals for an array of invoice line items.
 *
 * Each line should have:
 *   quantity      {number}  quantity
 *   unit_price    {number}  price per unit (before discount)
 *   discount_pct  {number}  discount percentage 0–100 (default 0)
 *   vat_rate      {number}  VAT percentage e.g. 13, 24 (default 13)
 *
 * Returns updated lines (with computed fields) plus aggregate totals.
 *
 * @param {Array} lines
 * @returns {{ lines: Array, netValue: number, vatAmount: number, totalValue: number, discountAmount: number }}
 */
function calculateTotals(lines) {
  let netValue = 0;
  let vatAmount = 0;
  let discountAmount = 0;

  const updatedLines = lines.map((line) => {
    const quantity = parseFloat(line.quantity) || 0;
    const unitPrice = parseFloat(line.unit_price) || 0;
    const discountPct = parseFloat(line.discount_pct) || 0;
    const vatRate = parseFloat(line.vat_rate) || 13;

    // Gross amount before discount
    const grossAmount = round(quantity * unitPrice);

    // Discount amount for this line
    const lineDiscount = round(grossAmount * (discountPct / 100));

    // Net value after discount
    const lineNet = round(grossAmount - lineDiscount);

    // VAT amount
    const lineVat = round(lineNet * (vatRate / 100));

    // Total (net + VAT)
    const lineTotal = round(lineNet + lineVat);

    netValue += lineNet;
    vatAmount += lineVat;
    discountAmount += lineDiscount;

    return {
      ...line,
      gross_amount: grossAmount,
      discount_amount: lineDiscount,
      net_value: lineNet,
      vat_amount: lineVat,
      total_value: lineTotal,
    };
  });

  netValue = round(netValue);
  vatAmount = round(vatAmount);
  discountAmount = round(discountAmount);
  const totalValue = round(netValue + vatAmount);

  return {
    lines: updatedLines,
    netValue,
    vatAmount,
    totalValue,
    discountAmount,
  };
}

/**
 * Round to 2 decimal places.
 * @param {number} value
 * @returns {number}
 */
function round(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

module.exports = { calculateTotals };
