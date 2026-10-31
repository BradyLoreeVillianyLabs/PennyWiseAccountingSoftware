# MCFX-11 completion report

Status: GATED

Foreign bank account selection is implemented, but foreign statement parsing,
cross-currency transfers, statement-currency reconciliation, and foreign cash
disposal positions require the remaining settlement model and fixtures. The API
fails closed when a currency is not enabled instead of defaulting a statement to
CAD.
