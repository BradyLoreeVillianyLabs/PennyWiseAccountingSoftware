# Permission Matrix

Legend:

- Y: allowed
- R: read only
- A: allowed with reauthentication
- N: not allowed

| Action                       | Owner | Admin | Accountant | Bookkeeper | Sales | Purchases | Inventory | Read-only |
| ---------------------------- | ----: | ----: | ---------: | ---------: | ----: | --------: | --------: | --------: |
| View dashboard               |     Y |     Y |          Y |          Y |     N |         N |         N |         R |
| View financial reports       |     Y |     Y |          Y |          Y |     N |         N |         N |         R |
| View receivables reports     |     Y |     Y |          Y |          Y |     Y |         N |         N |         R |
| View payables reports        |     Y |     Y |          Y |          Y |     N |         Y |         N |         R |
| View tax reports             |     Y |     Y |          Y |          Y |     N |         N |         N |         R |
| Export report data           |     A |     A |          A |          A |     N |         N |         N |         N |
| Manage organization settings |     A |     A |          R |          N |     N |         N |         N |         N |
| View company setup           |     Y |     Y |          Y |          Y |     N |         N |         N |         R |
| Configure taxes              |     Y |     Y |          Y |          N |     N |         N |         N |         N |
| Apply account preset         |     A |     A |          N |          N |     N |         N |         N |         N |
| Manage opening balances      |     Y |     Y |          Y |          N |     N |         N |         N |         N |
| Manage branding/defaults     |     Y |     Y |          N |          N |     N |         N |         N |         N |
| Complete company setup       |     A |     A |          N |          N |     N |         N |         N |         N |
| Manage users and roles       |     A |     A |          N |          N |     N |         N |         N |         N |
| View chart of accounts       |     Y |     Y |          Y |          Y |     R |         R |         R |         R |
| Edit chart of accounts       |     A |     A |          Y |          Y |     N |         N |         N |         N |
| Create manual-journal draft  |     A |     A |          Y |          Y |     N |         N |         N |         N |
| Post manual journal          |     A |     A |          Y |          N |     N |         N |         N |         N |
| Override control account     |     A |     A |          A |          N |     N |         N |         N |         N |
| Reverse journal              |     A |     A |          Y |          Y |     N |         N |         N |         N |
| Close period                 |     A |     A |          Y |          N |     N |         N |         N |         N |
| Reopen period                |     A |     A |          A |          N |     N |         N |         N |         N |
| View accountant workspace    |     Y |     Y |          Y |          Y |     N |         N |         N |         R |
| View audit explorer          |     Y |     Y |          Y |          Y |     N |         N |         N |         R |
| Export audit history         |     A |     A |          A |          N |     N |         N |         N |         N |
| Resolve review items         |     Y |     Y |          Y |          Y |     N |         N |         N |         N |
| Create customer              |     Y |     Y |          Y |          Y |     Y |         N |         N |         N |
| Create invoice               |     Y |     Y |          Y |          Y |     Y |         N |         N |         N |
| Send invoice                 |     Y |     Y |          Y |          Y |     Y |         N |         N |         N |
| Void posted invoice          |     A |     A |          Y |          Y |     N |         N |         N |         N |
| Issue credit note            |     A |     A |          Y |          Y |     N |         N |         N |         N |
| Refund payment               |     A |     A |          Y |          Y |     N |         N |         N |         N |
| View vendors and bills       |     Y |     Y |          Y |          Y |     N |         Y |         N |         R |
| Create vendor                |     Y |     Y |          Y |          Y |     N |         Y |         N |         N |
| Create bill draft            |     Y |     Y |          Y |          Y |     N |         Y |         N |         N |
| Post bill                    |     A |     A |          A |          A |     N |         A |         N |         N |
| Pay bill                     |     A |     A |          Y |          Y |     N |         Y |         N |         N |
| Record immediate expense     |     A |     A |          A |          A |     N |         A |         N |         N |
| Create/apply vendor credit   |     A |     A |          A |          A |     N |         A |         N |         N |
| View AP detail and aging     |     Y |     Y |          Y |          Y |     N |         Y |         N |         R |
| Import bank activity         |     A |     A |          Y |          Y |     N |         N |         N |         N |
| Review probable duplicates   |     A |     A |          Y |          Y |     N |         N |         N |         N |
| Match/categorize bank rows   |     A |     A |          Y |          Y |     N |         N |         N |         N |
| Create bank transfer         |     A |     A |          Y |          Y |     N |         N |         N |         N |
| Reconcile bank               |     A |     A |          Y |          Y |     N |         N |         N |         N |
| Reopen bank reconciliation   |     A |     A |          A |          N |     N |         N |         N |         N |
| View reconciliation reports  |     Y |     Y |          Y |          Y |     N |         N |         N |         R |
| Create inventory item        |     Y |     Y |          Y |          Y |     R |         R |         Y |         N |
| Adjust inventory             |     A |     A |          Y |          Y |     N |         N |         Y |         N |
| View inventory and reports   |     Y |     Y |          Y |          Y |     R |         R |         Y |         R |
| Configure locations/items    |     A |     A |          Y |          N |     N |         N |         A |         N |
| Receive purchased inventory  |     A |     A |          Y |          Y |     N |         A |         A |         N |
| Transfer inventory           |     A |     A |          Y |          Y |     N |         N |         A |         N |
| Record inventory returns     |     A |     A |          Y |          Y |     Y |         Y |         A |         N |
| Import master data           |     Y |     Y |          Y |          Y |     N |         N |         N |         N |
| Import financial data        |     A |     A |          A |          N |     N |         N |         N |         N |
| Approve migration commit     |     A |     A |          A |          N |     N |         N |         N |         N |
| Export full organization     |     A |     A |          A |          N |     N |         N |         N |         N |
| Request organization closure |     A |     N |          N |          N |     N |         N |         N |         N |
