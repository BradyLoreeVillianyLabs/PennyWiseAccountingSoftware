# MCFX-20 WooCommerce completion report

Status: GATED

The native WooCommerce shadow adapter is implemented, but live provider
reconciliation and posting tests are not complete. Marketplace clearing and
payout posting require a live PASS WooCommerce shadow report plus passing
provider-specific order/refund/fee/tax/payout-to-bank golden tests under the
owner evidence rule. An accountant signature is recommended but is not a
mandatory ClearLedger gate.

No provider posting route is enabled. Imported orders, refunds, fees, taxes,
shipping, discounts, and payment facts remain review evidence only. A bank
deposit or payout is never treated as new revenue, and no unexplained
difference may be forced into revenue, tax, fees, or FX.

Before this gate can open, the selected test store must prove deterministic
order/refund replay, complete SKU/tax/customer/account mappings, CAD and USD
worked scenarios, provider/currency-specific clearing reconciliation, and
bank-deposit linkage. WooCommerce core does not expose universal processor fee
or payout detail, so the selected payment gateway or settlement source must be
explicitly modeled and verified rather than inferred from an order.

Other currencies remain staged with a blocking review issue. Foreign refunds,
settlement corrections, chargebacks, reserves, conversion differences, and
bank transfers remain fail-closed until their linked accounting models and
fixtures pass.
