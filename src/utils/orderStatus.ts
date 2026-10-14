// Order statuses are stored as free-text Arabic strings in sales.order_status. The reservation
// status keeps its ORIGINAL stored value so every existing order (and every stock, cash and
// report rule keyed on it) keeps working unchanged; only what users SEE is renamed.
//
//   stored value 'تم الحجز'  →  shown as «يتم التجهيز»  (goods prepared / reserved, still in the warehouse)
//
// Always send / compare the stored value; always display statusLabel(value).

export const RESERVED_STATUS = 'تم الحجز';

const DISPLAY_LABELS: Record<string, string> = {
  [RESERVED_STATUS]: 'يتم التجهيز',
};

/** Arabic label to show users for a stored order status (unknown values are shown as-is). */
export const statusLabel = (status: string): string => DISPLAY_LABELS[status] ?? status;
