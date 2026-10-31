import { AppError } from "@clearledger/shared";
import { roundRatioHalfUp } from "./money.js";

export const quantityScale = 1_000_000n;
export const unitCostScale = 1_000_000n;
export const maximumInventoryQuantityMicros = 9_000_000_000_000_000_000n;
export const maximumInventoryValueMinor = 9_000_000_000_000_000_000n;

export interface InventoryPosition {
  readonly quantityMicros: bigint;
  readonly valueMinor: bigint;
}

export function receiptValueMinor(quantityMicros: bigint, unitCostMinor: bigint): bigint {
  assertPositiveQuantity(quantityMicros);
  if (unitCostMinor < 0n)
    throw inventoryError("INVENTORY_COST_INVALID", "Inventory unit cost cannot be negative.");
  const value = roundRatioHalfUp(quantityMicros * unitCostMinor, quantityScale);
  assertValueRange(value);
  return value;
}

export function averageUnitCostMicros(position: InventoryPosition): bigint {
  assertPosition(position);
  if (position.quantityMicros === 0n) return 0n;
  return roundRatioHalfUp(
    position.valueMinor * quantityScale * unitCostScale,
    position.quantityMicros
  );
}

export function outboundValueMinor(
  position: InventoryPosition,
  requestedQuantityMicros: bigint
): bigint {
  assertPosition(position);
  assertPositiveQuantity(requestedQuantityMicros);
  if (requestedQuantityMicros > position.quantityMicros)
    throw inventoryError("INSUFFICIENT_INVENTORY", "Inventory quantity cannot become negative.");
  if (requestedQuantityMicros === position.quantityMicros) return position.valueMinor;
  return roundRatioHalfUp(position.valueMinor * requestedQuantityMicros, position.quantityMicros);
}

export function applyInbound(
  position: InventoryPosition,
  quantityMicros: bigint,
  valueMinor: bigint
): InventoryPosition {
  assertPosition(position);
  assertPositiveQuantity(quantityMicros);
  if (valueMinor < 0n)
    throw inventoryError("INVENTORY_VALUE_INVALID", "Inbound inventory value cannot be negative.");
  const next = {
    quantityMicros: position.quantityMicros + quantityMicros,
    valueMinor: position.valueMinor + valueMinor
  };
  assertPosition(next);
  return next;
}

export function applyOutbound(
  position: InventoryPosition,
  quantityMicros: bigint
): InventoryPosition & { readonly outboundValueMinor: bigint } {
  const value = outboundValueMinor(position, quantityMicros);
  const next = {
    quantityMicros: position.quantityMicros - quantityMicros,
    valueMinor: position.valueMinor - value
  };
  assertPosition(next);
  return { ...next, outboundValueMinor: value };
}

export function assertPosition(position: InventoryPosition): void {
  if (position.quantityMicros < 0n || position.valueMinor < 0n)
    throw inventoryError("INVENTORY_POSITION_INVALID", "Inventory position cannot be negative.");
  if (position.quantityMicros === 0n && position.valueMinor !== 0n)
    throw inventoryError(
      "INVENTORY_POSITION_INVALID",
      "Zero inventory quantity must have zero carrying value."
    );
  if (position.quantityMicros > maximumInventoryQuantityMicros)
    throw inventoryError(
      "INVENTORY_QUANTITY_OUT_OF_RANGE",
      "Inventory quantity exceeds the supported range."
    );
  assertValueRange(position.valueMinor);
}

function assertPositiveQuantity(quantityMicros: bigint): void {
  if (quantityMicros <= 0n)
    throw inventoryError("INVENTORY_QUANTITY_INVALID", "Inventory quantity must be positive.");
  if (quantityMicros > maximumInventoryQuantityMicros)
    throw inventoryError(
      "INVENTORY_QUANTITY_OUT_OF_RANGE",
      "Inventory quantity exceeds the supported range."
    );
}

function assertValueRange(valueMinor: bigint): void {
  if (valueMinor > maximumInventoryValueMinor)
    throw inventoryError(
      "INVENTORY_VALUE_OUT_OF_RANGE",
      "Inventory value exceeds the supported range."
    );
}

function inventoryError(code: string, message: string): AppError {
  return new AppError(code, message, 422);
}
