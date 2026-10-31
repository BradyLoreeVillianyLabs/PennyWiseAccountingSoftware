# MCFX-20 Etsy completion report

Status: GATED

The native Etsy shadow adapter is implemented, but live receipt/payment/ledger
reconciliation and posting tests are not complete. Marketplace clearing and
payout posting require a live PASS Etsy shadow report plus passing
provider-specific order/refund/fee/tax/payout-to-bank golden tests under the
owner evidence rule. An accountant signature is recommended but is not a
mandatory ClearLedger gate.

No provider posting route is enabled. Imported receipts, transactions,
refunds, fees, taxes, and payment-account ledger entries remain review evidence
only. A payout or bank deposit is never treated as new revenue, and no
unexplained difference may be forced into revenue, tax, fees, or FX.

Before this gate can open, an approved test app/shop must prove deterministic
receipt/refund/ledger replay, complete SKU/tax/customer/account mappings, CAD
and USD worked scenarios, payout-to-ledger component linkage,
provider/currency-specific clearing reconciliation, and actual bank-deposit
linkage. Etsy app/Commercial Access requirements remain external provider
gates where applicable.

Other currencies remain staged with a blocking review issue. Foreign refunds,
settlement corrections, chargebacks, reserves, conversion differences, and
bank transfers remain fail-closed until their linked accounting models and
fixtures pass.
