# Accounting Core Package Location

Pure or infrastructure-independent accounting domain logic belongs here.

Initial responsibilities:

- money-safe value types;
- debit and credit line validation;
- journal balancing;
- posting command types;
- reversal construction;
- deterministic posting errors;
- accounting invariant unit tests.

This package must not import HTTP controllers or frontend code.

Phase 1 implements integer minor-unit parsing and serialization, balanced journal validation, journal-line shape validation, and exact inverse reversal-line construction.
