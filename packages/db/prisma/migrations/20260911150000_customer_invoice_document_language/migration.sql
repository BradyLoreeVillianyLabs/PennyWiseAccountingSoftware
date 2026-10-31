ALTER TABLE "Customer"
  ADD COLUMN "documentLanguage" TEXT;

ALTER TABLE "Invoice"
  ADD COLUMN "customerDocumentLanguageSnapshot" TEXT;
