export const canonicalMigrationEntities = [
  "accounts",
  "taxCodes",
  "customers",
  "vendors",
  "products",
  "openingBalances",
  "outstandingInvoices",
  "outstandingBills",
  "historicalArchive"
] as const;

export type CanonicalMigrationEntity = (typeof canonicalMigrationEntities)[number];

export const migrationDependencyOrder: readonly CanonicalMigrationEntity[] = [
  "accounts",
  "taxCodes",
  "customers",
  "vendors",
  "products",
  "openingBalances",
  "outstandingInvoices",
  "outstandingBills",
  "historicalArchive"
];

export interface MigrationManifestEntry {
  readonly entity: CanonicalMigrationEntity;
  readonly source: string;
  readonly rowCount: number;
  readonly supported: boolean;
  readonly unsupportedReason?: string | undefined;
}

export function validateMigrationManifest(entries: readonly MigrationManifestEntry[]): void {
  const seen = new Set<CanonicalMigrationEntity>();
  let previous = -1;
  for (const entry of entries) {
    if (seen.has(entry.entity)) throw new Error(`Duplicate migration entity: ${entry.entity}`);
    seen.add(entry.entity);
    const index = migrationDependencyOrder.indexOf(entry.entity);
    if (index < previous) throw new Error(`Migration dependency order violation: ${entry.entity}`);
    previous = index;
    if (!entry.supported && !entry.unsupportedReason?.trim())
      throw new Error(`Unsupported migration entity requires an explicit reason: ${entry.entity}`);
    if (entry.rowCount < 0 || !Number.isInteger(entry.rowCount))
      throw new Error(`Migration row count is invalid: ${entry.entity}`);
  }
}
