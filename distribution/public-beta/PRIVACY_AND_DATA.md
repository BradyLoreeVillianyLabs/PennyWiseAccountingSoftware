# ClearLedger Public Beta Privacy and Data Summary

This package is a local-first beta, not a hosted accounting service. Its web and API
ports bind to this computer only by default. The PostgreSQL database, uploaded logos,
generated documents, imports, and connector records remain in Docker volumes on the
computer where the beta is installed unless the operator deliberately backs them up,
exports them, shares the installation, or enables an external provider.

## What leaves the computer

- A configured WooCommerce or Etsy connector sends only the requests needed for that
  provider workflow to the store or marketplace selected by the operator. Those
  providers apply their own terms and privacy practices.
- Opening a third-party help link, payment page, email client, or support website is an
  explicit user action and is handled by that service.
- ClearLedger's in-product support-details and bug-report tools prepare information
  locally. They do not silently upload a report. Review and remove sensitive content
  before choosing how to send it.
- The beta does not include hidden advertising trackers or a central ClearLedger cloud
  database. Product events used by the local interface remain part of the local
  installation unless a future, separately disclosed opt-in service is configured.

## Sensitive records

Accounting data can contain personal, commercial, banking, tax, payroll, customer, and
supplier information. Give access only to authorized people. Do not put live provider
credentials in screenshots, bug reports, spreadsheets, email, or a redistributed beta
package. Connector secrets are encrypted with an installation-specific secret, but the
computer, Docker access, backups, and recovery secrets must still be protected.

## Control and retention

The organization export is the portable copy of business records. Backups contain the
database, files, and recovery material and therefore require the same protection as the
live books. Stopping or uninstalling services does not delete Docker volumes unless the
operator explicitly requests data deletion. Before deletion or migration, create and
verify both a backup and a readable organization export, subject to applicable
record-retention requirements.

This summary describes the packaged local beta. A later hosted service, production
identity provider, support portal, or optional integration requires its own current
privacy notice before use.
